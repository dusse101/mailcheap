import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { AUDIENCE_SORT, buildAudienceQuery, selectAudience } from "../lib/audience.js";
import { startTestApp } from "./helpers/app.mjs";

const accountId = "64f1a2b3c4d5e6f7a8b9c0d1";
const newsletterId = "74f1a2b3c4d5e6f7a8b9c0d2";

function contact(id, fields = {}) {
	return {
		_id: id,
		email: `${id}@example.com`,
		status: "active",
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		...fields,
	};
}

const contacts = [
	contact("never-engaged"),
	contact("early-signup", { createdAt: new Date("2025-01-01T00:00:00.000Z") }),
	contact("imported-opener", { imported: { openRate: 0.6 } }),
	contact("imported-clicker", { imported: { clickRate: 0.1, openRate: 0.2 } }),
	contact("imported-top-clicker", { imported: { clickRate: 0.3, openRate: 0.1 } }),
	contact("opened-recently", { lastOpenAt: new Date("2026-09-30T00:00:00.000Z") }),
	contact("opened-in-march", { lastOpenAt: new Date("2026-03-01T00:00:00.000Z") }),
	contact("clicked-in-february", {
		lastClickAt: new Date("2026-02-01T00:00:00.000Z"),
		lastOpenAt: new Date("2026-02-01T00:00:00.000Z"),
	}),
	contact("clicked-recently", { lastClickAt: new Date("2026-09-01T00:00:00.000Z") }),
	contact("unsubscribed", { status: "unsubscribed", lastClickAt: new Date("2026-10-01") }),
	contact("bounced", { status: "bounced" }),
	contact("dormant", { status: "dormant" }),
	contact("suppressed", { lastClickAt: new Date("2026-10-02T00:00:00.000Z") }),
];
const suppressedEmails = ["suppressed@example.com"];

test("the audience is active, unsuppressed contacts, most engaged first", () => {
	const audience = selectAudience(contacts, { suppressedEmails });
	assert.deepEqual(
		audience.map(({ _id }) => _id),
		[
			"clicked-recently",
			"clicked-in-february",
			"opened-recently",
			"opened-in-march",
			"imported-top-clicker",
			"imported-clicker",
			"imported-opener",
			"early-signup",
			"never-engaged",
		]
	);
});

test("audienceLimit keeps the most engaged contacts", () => {
	const audience = selectAudience(contacts, { suppressedEmails, audienceLimit: 3 });
	assert.deepEqual(
		audience.map(({ _id }) => _id),
		["clicked-recently", "clicked-in-february", "opened-recently"]
	);
	for (const audienceLimit of [undefined, null, 0, -1, 2.5, "abc"]) {
		assert.equal(selectAudience(contacts, { suppressedEmails, audienceLimit }).length, 9);
	}
});

test("contacts with equal engagement keep a stable order", () => {
	const twins = [contact("b"), contact("a"), contact("c")];
	assert.deepEqual(
		selectAudience(twins).map(({ _id }) => _id),
		["a", "b", "c"]
	);
	assert.deepEqual(
		twins.map(({ _id }) => _id),
		["b", "a", "c"]
	);
});

test("the Mongo query selects the same audience in the same order", () => {
	const query = buildAudienceQuery({ accountId, newsletterId, suppressedEmails, audienceLimit: 500 });
	assert.deepEqual(query.filter, {
		accountId,
		newsletterId,
		status: "active",
		email: { $nin: suppressedEmails },
	});
	assert.deepEqual(Object.entries(query.sort), [
		["lastClickAt", -1],
		["lastOpenAt", -1],
		["imported.clickRate", -1],
		["imported.openRate", -1],
		["createdAt", 1],
		["_id", 1],
	]);
	assert.equal(query.limit, 500);
});

test("the Mongo query skips empty suppression lists and invalid limits", () => {
	assert.deepEqual(buildAudienceQuery({ accountId, newsletterId }).filter, { accountId, newsletterId, status: "active" });
	for (const audienceLimit of [undefined, null, 0, -1, 2.5, "abc"]) {
		assert.equal(buildAudienceQuery({ accountId, newsletterId, audienceLimit }).limit, null);
	}
	assert.equal(buildAudienceQuery({ accountId, newsletterId, audienceLimit: "250" }).limit, 250);
});

// Every stage of a query plan, the SBE engine's included.
function listStages(plan) {
	if (!plan || typeof plan !== "object") return [];
	const children = [plan.inputStage, ...(plan.inputStages ?? []), plan.queryPlan].filter(Boolean);
	return [...(plan.stage ? [plan] : []), ...children.flatMap(listStages)];
}

describe("a send's audience in MongoDB", () => {
	let app;
	let Contact;

	before(async () => {
		app = await startTestApp();
		Contact = (await import("../models/Contact.js")).default;
		await Contact.init();
	});

	after(() => app?.stop());

	// A segment that picks a few contacts can sort them in memory: the index matters for the ones that pick many.
	test("comes from an index in its order, so a big list never sorts in memory", async () => {
		const ids = { accountId: new mongoose.Types.ObjectId(), newsletterId: new mongoose.Types.ObjectId() };
		const daysAgo = (days) => new Date(Date.now() - days * 86_400_000);
		await Contact.insertMany(
			Array.from({ length: 300 }, (_, index) => ({
				...ids,
				email: `reader${index}@example.com`,
				status: index % 10 === 0 ? "unsubscribed" : "active",
				tags: index % 50 === 0 ? ["vip", "reader"] : ["reader"],
				...(index % 3 === 0 && { lastOpenAt: daysAgo(index) }),
				...(index % 7 === 0 && { lastClickAt: daysAgo(index) }),
				...(index % 5 === 0 && { imported: { openRate: index / 300, clickRate: index / 900 } }),
			}))
		);
		for (const segmentFilter of [null, { tags: "reader" }]) {
			const { filter, sort } = buildAudienceQuery({ ...ids, suppressedEmails: ["reader1@example.com"], segmentFilter });
			const [explain] = [await Contact.find(filter).sort(sort).explain("queryPlanner")].flat();
			const stages = listStages(explain.queryPlanner.winningPlan);
			assert.ok(!stages.some(({ stage }) => stage === "SORT"), `${JSON.stringify(segmentFilter)}: ${JSON.stringify(stages)}`);
			assert.deepEqual(stages.find(({ stage }) => stage === "IXSCAN")?.keyPattern, { newsletterId: 1, status: 1, ...AUDIENCE_SORT });
		}
	});
});
