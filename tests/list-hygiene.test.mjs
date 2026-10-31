import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import mongoose from "mongoose";
import { startTestApp, withEnv } from "./helpers/app.mjs";

// The daily list hygiene (lib/list-hygiene.js): contacts on a domain that can't receive email stop after two answers a
// day apart and come back once it can; spam domains stop at once when that list is on; nothing is ever deleted.
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
let app;
let m;

before(async () => {
	app = await startTestApp();
	m = {
		hygiene: await import("../lib/list-hygiene.js"),
		lists: await import("../lib/domain-lists.js"),
		contacts: await import("../lib/contacts.js"),
		Contact: (await import("../models/Contact.js")).default,
		MailDomain: (await import("../models/MailDomain.js")).default,
		DomainList: (await import("../models/DomainList.js")).default,
	};
});

after(async () => {
	await app.stop();
});

beforeEach(async () => {
	await Promise.all([m.Contact.deleteMany({}).setOptions({ crossAccount: true }), m.MailDomain.deleteMany({}), m.DomainList.deleteMany({})]);
	m.lists.clearDomainListCache();
});

async function addContacts(entries) {
	const accountId = new mongoose.Types.ObjectId();
	const newsletterId = new mongoose.Types.ObjectId();
	await m.Contact.insertMany(entries.map(([email, status = "active"]) => ({ accountId, newsletterId, email, status })));
	return { accountId, newsletterId };
}

function contact(email) {
	return m.Contact.findOne({ email }).setOptions({ crossAccount: true }).lean();
}

function dns(answers) {
	const asked = [];
	const checkDomain = async (domain) => {
		asked.push(domain);
		return answers[domain] ?? "ok";
	};
	return { asked, checkDomain };
}

const run = (options) => m.hygiene.runListHygiene({ lists: {}, ...options });

test("a domain without mail stops its contacts after two answers a day apart, and they come back once it can receive email", async () => {
	await addContacts([["a@dead.example"], ["b@dead.example", "dormant"], ["c@alive.example"], ["d@gmail.com"], ["e@flaky.example"]]);
	const answers = { "dead.example": "none", "flaky.example": "unknown" };
	const { asked, checkDomain } = dns(answers);
	const start = new Date("2026-10-20T04:20:00Z");

	const first = await run({ now: start, checkDomain });
	assert.deepEqual([...asked].sort(), ["alive.example", "dead.example", "flaky.example"], "Gmail is never looked up");
	assert.deepEqual(first.stopped, { noMailServer: 0, spamDomain: 0 }, "one answer never stops anyone");
	assert.equal((await contact("a@dead.example")).status, "active");

	await run({ now: new Date(+start + 12 * HOUR_MS), checkDomain });
	assert.equal((await contact("a@dead.example")).status, "active", "not before the second answer");

	const third = await run({ now: new Date(+start + DAY_MS), checkDomain });
	assert.equal(third.stopped.noMailServer, 2);
	const stopped = await contact("b@dead.example");
	assert.equal(stopped.status, "bounced");
	assert.equal(stopped.undeliverableReason, "no-mail-server");
	assert.equal(stopped.undeliverableFrom, "dormant");
	assert.deepEqual(
		stopped.statusChanges.map(({ from, to, via }) => ({ from, to, via })),
		[{ from: "dormant", to: "bounced", via: "hygiene" }]
	);
	for (const email of ["c@alive.example", "d@gmail.com", "e@flaky.example"]) assert.equal((await contact(email)).status, "active", email);

	const again = await run({ now: new Date(+start + DAY_MS + HOUR_MS), checkDomain });
	assert.equal(again.stopped.noMailServer, 0, "a second run changes nothing");

	answers["dead.example"] = "ok";
	const back = await run({ now: new Date(+start + 9 * DAY_MS), checkDomain });
	assert.equal(back.restored.noMailServer, 2);
	const returned = await contact("b@dead.example");
	assert.equal(returned.status, "dormant", "back to the status it had");
	assert.equal(returned.undeliverableReason, undefined);
	assert.equal((await contact("a@dead.example")).status, "active");
	assert.equal(returned.statusChanges.at(-1).to, "dormant");
});

test("each run stops at most its share of contacts, and the next run goes on", async () => {
	await addContacts([["one@dead.example"], ["two@dead.example"], ["three@dead.example"]]);
	const { checkDomain } = dns({ "dead.example": "none" });
	const start = new Date("2026-10-20T04:20:00Z");
	const limits = { ...m.hygiene.HYGIENE_LIMITS, contactsPerRun: 2 };
	await run({ now: start, checkDomain, limits });
	const second = await run({ now: new Date(+start + DAY_MS), checkDomain, limits });
	assert.equal(second.stopped.noMailServer, 2);
	assert.equal(second.capped, true);
	const third = await run({ now: new Date(+start + DAY_MS + HOUR_MS), checkDomain, limits });
	assert.equal(third.stopped.noMailServer, 1);
	assert.equal(await m.Contact.countDocuments({ status: "bounced" }).setOptions({ crossAccount: true }), 3);
});

test("a run where most domains seem to have no mail server is DNS trouble, and changes nothing", async () => {
	await addContacts(Array.from({ length: 60 }, (_, index) => [`reader@company${index}.example`]));
	const answers = Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`company${index}.example`, index < 40 ? "none" : "ok"]));
	const { checkDomain } = dns(answers);
	const report = await run({ checkDomain });
	assert.equal(report.suspicious, true);
	assert.equal(await m.MailDomain.countDocuments({}), 0, "no answer of that run is kept");
	assert.equal(await m.Contact.countDocuments({ status: "active" }).setOptions({ crossAccount: true }), 60);
});

test("a dry run looks domains up and counts what a second answer would stop, writing nothing", async () => {
	await addContacts([["one@dead.example"], ["two@dead.example"], ["three@alive.example"]]);
	const { checkDomain } = dns({ "dead.example": "none" });
	const report = await run({ dryRun: true, checkDomain });
	assert.equal(report.checked, 2);
	assert.equal(report.stopped.noMailServer, 2);
	assert.equal(await m.MailDomain.countDocuments({}), 0);
	assert.equal(await m.Contact.countDocuments({ status: "active" }).setOptions({ crossAccount: true }), 3);
});

test("spam domains stop at once when that list is on, and come back when the list drops them", async () => {
	await addContacts([["bot@spammy.example"], ["reader@company.example"]]);
	const { asked, checkDomain } = dns({});
	const report = await run({ lists: { spam: new Set(["spammy.example"]) }, checkDomain });
	assert.equal(report.stopped.spamDomain, 1);
	assert.equal((await contact("bot@spammy.example")).undeliverableReason, "spam-domain");
	assert.deepEqual(asked, ["company.example"], "spam domains aren't looked up");

	await run({ lists: {}, checkDomain });
	assert.equal((await contact("bot@spammy.example")).status, "bounced", "a list that didn't load brings no one back");

	const delisted = await run({ lists: { spam: new Set(["other-spam.example"]) }, checkDomain });
	assert.equal(delisted.restored.spamDomain, 1);
	assert.equal((await contact("bot@spammy.example")).status, "active");
});

test("a spam domain never stops a contact who opened, clicked, or read on the platform they came from", async () => {
	const { accountId } = await addContacts([["bot@spammy.example"], ["opener@spammy.example"], ["clicker@spammy.example"], ["imported@spammy.example"]]);
	const scope = { accountId };
	await m.Contact.updateOne({ ...scope, email: "opener@spammy.example" }, { $set: { lastOpenAt: new Date() } });
	await m.Contact.updateOne({ ...scope, email: "clicker@spammy.example" }, { $set: { lastClickAt: new Date() } });
	await m.Contact.updateOne({ ...scope, email: "imported@spammy.example" }, { $set: { "imported.openRate": 0.4 } });
	const { checkDomain } = dns({});
	const lists = { spam: new Set(["spammy.example"]) };

	const dry = await run({ dryRun: true, lists, checkDomain });
	assert.equal(dry.stopped.spamDomain, 1, "a dry run counts the same contacts");
	const report = await run({ lists, checkDomain });
	assert.equal(report.stopped.spamDomain, 1);
	assert.equal((await contact("bot@spammy.example")).undeliverableReason, "spam-domain");
	for (const email of ["opener@spammy.example", "clicker@spammy.example", "imported@spammy.example"]) {
		assert.equal((await contact(email)).status, "active", email);
	}
});

test("a stopped contact's status can't be changed by hand, with its reason", async () => {
	const { accountId } = await addContacts([["a@dead.example"]]);
	await m.Contact.updateOne(
		{ accountId, email: "a@dead.example" },
		{ $set: { status: "bounced", undeliverableAt: new Date(), undeliverableReason: "no-mail-server", undeliverableFrom: "active" } }
	);
	const result = await m.contacts.changeContactStatus({
		account: { _id: accountId },
		contact: await contact("a@dead.example"),
		status: "active",
		actor: { via: "dashboard" },
	});
	assert.match(result.problem.message, /domain can't receive email/);
});

// A fake download per URL: its lines, or an HTTP status to answer with.
function fakeFetch(files) {
	const fetched = [];
	const fetchImpl = async (url) => {
		fetched.push(url);
		const file = Object.entries(files).find(([part]) => url.includes(part))?.[1];
		if (typeof file === "number") return new Response("", { status: file });
		return new Response((file ?? []).join("\n"));
	};
	return { fetched, fetchImpl };
}

const domains = (count, name) => Array.from({ length: count }, (_, index) => `${name}${index}.example`);

test("a download replaces the list only when it passes its checks, and StopForumSpam is never fetched without its waiver", async () => {
	await withEnv({ STOPFORUMSPAM_COMMERCIAL_OK: "" }, async () => {
		const good = fakeFetch({ "disposable-email-domains": ["# list", ...domains(4_000, "throwaway"), "gmail.com"] });
		assert.deepEqual(await m.lists.refreshDomainLists({ fetchImpl: good.fetchImpl }), { disposable: { count: 4_000 } });
		assert.equal(good.fetched.some((url) => url.includes("stopforumspam")), false);
		assert.equal((await m.lists.getDomainLists()).disposable.has("throwaway7.example"), true);
		assert.equal((await m.lists.getDomainLists()).disposable.has("gmail.com"), false);

		const short = fakeFetch({ "disposable-email-domains": domains(2_500, "throwaway") });
		const fresh = await m.lists.refreshDomainLists({ fetchImpl: short.fetchImpl });
		assert.equal(fresh.disposable.fresh, true, "a list downloaded today isn't downloaded again");
		const kept = await m.lists.refreshDomainLists({ fetchImpl: short.fetchImpl, force: true });
		assert.equal(kept.disposable.kept, true);
		assert.match(kept.disposable.error, /down from 4000/);
		assert.equal((await m.DomainList.findById("disposable").lean()).count, 4_000);

		const broken = fakeFetch({ "disposable-email-domains": 500 });
		assert.match((await m.lists.refreshDomainLists({ fetchImpl: broken.fetchImpl, force: true })).disposable.error, /HTTP 500/);
		assert.equal((await m.DomainList.findById("disposable").lean()).count, 4_000);
	});

	await withEnv({ STOPFORUMSPAM_COMMERCIAL_OK: "1" }, async () => {
		const both = fakeFetch({ "disposable-email-domains": domains(4_000, "throwaway"), stopforumspam: domains(25_000, "spam") });
		const result = await m.lists.refreshDomainLists({ fetchImpl: both.fetchImpl, force: true });
		assert.equal(result.spam.count, 25_000);
		assert.equal((await m.lists.getDomainLists()).spam.has("spam42.example"), true);
	});
});

test("a signup on a spam domain gets the same words as any address that can't receive email", async () => {
	await m.DomainList.create({ _id: "spam", domains: ["spammy.example"], count: 1 });
	await withEnv({ STOPFORUMSPAM_COMMERCIAL_OK: "1" }, async () => {
		m.lists.clearDomainListCache();
		assert.equal(await m.contacts.getSignupProblem("bot@spammy.example"), "This address can't receive email");
		assert.equal(await m.contacts.getSignupProblem("reader@mailinator.com"), null, "throwaway inboxes still sign up");
	});
	await withEnv({ STOPFORUMSPAM_COMMERCIAL_OK: "" }, async () => {
		m.lists.clearDomainListCache();
		assert.equal(await m.contacts.getSignupProblem("bot@spammy.example"), null, "the list isn't used without its waiver");
	});
});
