import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { ALERT_TYPES } from "../lib/alert-kinds.js";
import { ALERT_OCCURRENCES_KEPT, getAlertType, maskEmails } from "../lib/alert-rules.js";
import { activate, as, catchNotFound, signIn, startTestApp } from "./helpers/app.mjs";

// The admin page's "Needs a look": each alert's occurrences, the dialog's details, and dismissing, for admins only.
const ROOT = fileURLToPath(new URL("../", import.meta.url));
let app;
let m;
let admin;
let customer;
let other;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ids = (list) => list.map(({ id }) => id);

before(async () => {
	app = await startTestApp({ ADMIN_EMAILS: "ops@example.com" });
	m = {
		actions: await import("../app/admin/actions.js"),
		alerts: await import("../lib/alerts.js"),
		stats: await import("../lib/admin-stats.js"),
		Alert: (await import("../models/Alert.js")).default,
		Dismissal: (await import("../models/AttentionDismissal.js")).default,
	};
	admin = await signIn("ops@example.com");
	customer = await signIn("customer@example.com");
	other = await signIn("other@example.com");
	await activate(customer, { plan: "growth" });
});

after(() => app?.stop());

async function complain(email = "jane.doe@example.com") {
	await m.alerts.sendAlert({
		accountId: customer.accountId,
		key: "complaints",
		title: "Spam complaint",
		detail: `${email} marked an email as spam. Contacts are suppressed.`,
	});
	return m.Alert.findOne({ accountId: customer.accountId, key: "complaints" }).lean();
}

test("an alert keeps its last 20 occurrences, each address masked, and counts them all", async () => {
	for (let index = 0; index < ALERT_OCCURRENCES_KEPT + 5; index++) await complain(`reader${index}@example.com`);
	const alert = await m.Alert.findOne({ accountId: customer.accountId, key: "complaints" }).lean();
	assert.equal(alert.count, ALERT_OCCURRENCES_KEPT + 5);
	assert.equal(alert.occurrences.length, ALERT_OCCURRENCES_KEPT);
	assert.equal(alert.occurrences.at(-1).detail, `r…@example.com marked an email as spam. Contacts are suppressed.`);
	assert.doesNotMatch(JSON.stringify(alert.occurrences), /reader\d+@/);
	assert.equal(alert.occurrences.filter(({ emailed }) => emailed).length, 0, "the first ones were emailed, then the cooldown held");
	assert.ok(alert.lastSeenAt >= alert.lastSentAt);
	assert.equal(maskEmails("ops@mail.example.co.uk and a.b+c@x.io"), "o…@mail.example.co.uk and a…@x.io");
});

test("only admins can open or dismiss an item: anyone else gets a 404 and changes nothing", async () => {
	const alert = await complain();
	const id = String(alert._id);
	for (const user of [customer, other]) {
		assert.equal(await as(user, () => catchNotFound(m.actions.loadAttention("alert", id))), true);
		assert.equal(await as(user, () => catchNotFound(m.actions.dismissAttentionAction("alert", id))), true);
		assert.equal(await as(user, () => catchNotFound(m.actions.dismissAlertTypeAction(id))), true);
	}
	assert.equal(await m.Dismissal.countDocuments(), 0);
});

test("the dialog says what happened, who was told, which account and what happened around it", async () => {
	const alert = await complain();
	const { details } = await as(admin, () => m.actions.loadAttention("alert", String(alert._id)));
	assert.equal(details.title, "Spam complaint");
	assert.match(details.what, /^j…@example\.com marked an email as spam/);
	assert.equal(details.done, ALERT_TYPES.complaints.done);
	assert.equal(details.hasDetails, true);
	assert.equal(details.account.ownerEmail, "customer@example.com");
	assert.equal(details.account.href, `/admin?account=${customer.accountId}`);
	assert.ok(details.told.some(({ label }) => label === "Emailed to the owner"));
	assert.ok(details.trail.length > 0 && details.trail.length <= 15);
	assert.equal(details.trail.filter(({ isItem }) => isItem).length, 5, "its first occurrence, how many between, and its latest ones");
	assert.ok(details.trail.some(({ text }) => /^Spam complaint: \d+ more times$/.test(text)));
	assert.ok(details.trail.some(({ text }) => text === "Account created"));
	assert.deepEqual(
		details.trail.map(({ at }) => new Date(at).getTime()),
		details.trail.map(({ at }) => new Date(at).getTime()).toSorted((a, b) => a - b),
		"oldest first"
	);
	assert.doesNotMatch(JSON.stringify(details), /jane\.doe@/);
});

test("an admin alert about an account finds it from its key, and never names the email provider", async () => {
	const accountId = String(customer.accountId);
	await m.alerts.sendAlert({ key: `tenant-failed:${accountId}`, title: "PostShiba tenant not created", detail: `Account ${accountId}: timeout. The account's first send will try again.` });
	const alert = await m.Alert.findOne({ key: `tenant-failed:${accountId}` }).lean();
	const { details } = await as(admin, () => m.actions.loadAttention("alert", String(alert._id)));
	assert.equal(details.account.id, accountId);
	assert.equal(details.title, "Email provider tenant not created");
	assert.ok(details.told.some(({ label }) => label === "Emailed to the admins"));
	assert.doesNotMatch(JSON.stringify(details), /PostShiba|\bSES\b/);
});

test("an alert from before details were kept gets the general explanation", async () => {
	const now = new Date();
	const { insertedId } = await mongoose.connection.db
		.collection("alerts")
		.insertOne({ accountId: customer.accountId, key: "rates-warning", title: "Bounces or complaints are high", lastSentAt: now, createdAt: now, updatedAt: now });
	const { details } = await as(admin, () => m.actions.loadAttention("alert", String(insertedId)));
	assert.equal(details.hasDetails, false);
	assert.equal(details.what, ALERT_TYPES["rates-warning"].what);
	assert.ok(details.trail.some(({ text, isItem }) => isItem && /first raised/.test(text)));
});

test("a dismissed alert leaves Needs a look until it happens again", async () => {
	const alert = await complain();
	const id = String(alert._id);
	assert.ok(ids((await m.stats.listAttention()).alerts).includes(id));

	assert.deepEqual(await as(admin, () => m.actions.dismissAttentionAction("alert", id)), { ok: true });
	let attention = await m.stats.listAttention();
	assert.equal(ids(attention.alerts).includes(id), false);
	const dismissed = attention.dismissed.find((item) => item.id === id);
	assert.equal(dismissed.dismissedBy, "ops@example.com");
	const { details } = await as(admin, () => m.actions.loadAttention("alert", id));
	assert.equal(details.dismissal.isActive, true);
	assert.ok(details.trail.some(({ text }) => text === "Dismissed by ops@example.com"));

	await wait(5);
	await complain();
	attention = await m.stats.listAttention();
	assert.ok(ids(attention.alerts).includes(id), "back with its new occurrence");
	assert.equal(ids(attention.dismissed).includes(id), false);

	await as(admin, () => m.actions.dismissAttentionAction("alert", id));
	const dismissal = await m.Dismissal.findOne({ kind: "alert", targetId: alert._id }).lean();
	assert.equal(dismissal.history.length, 2, "each dismissal is kept");
});

test("a paused campaign's dialog links to its admin page, and an alert about a campaign finds it", async () => {
	const { insertedId } = await mongoose.connection.db.collection("campaigns").insertOne({
		accountId: customer.accountId,
		newsletterId: new mongoose.Types.ObjectId(),
		subject: "Paused for the dialog",
		status: "paused",
		pauseReason: "Too many bounces",
		updatedAt: new Date(),
	});
	const campaignId = String(insertedId);
	await m.alerts.sendAlert({ accountId: customer.accountId, key: `campaign-paused-${campaignId}`, title: "Campaign paused", detail: "Too many bounces." });
	const alert = await m.Alert.findOne({ key: `campaign-paused-${campaignId}` }).lean();

	const fromAlert = (await as(admin, () => m.actions.loadAttention("alert", String(alert._id)))).details;
	assert.equal(fromAlert.campaign.href, `/admin/campaigns/${campaignId}`);
	const fromCampaign = (await as(admin, () => m.actions.loadAttention("campaign", campaignId))).details;
	assert.equal(fromCampaign.what, "It paused itself: Too many bounces.");
	assert.equal(fromCampaign.campaign.href, `/admin/campaigns/${campaignId}`);
	assert.ok(fromCampaign.told.some(({ label }) => label === "Emailed to the owner"));
});

test("a blocked account can be dismissed too, and a new block brings it back", async () => {
	const third = await signIn("third@example.com");
	const accountId = String(third.accountId);
	assert.deepEqual(await as(admin, () => m.actions.blockAccountAction(accountId, "Spam")), { ok: true });
	assert.ok(ids((await m.stats.listAttention()).blockedAccounts).includes(accountId));

	const { details } = await as(admin, () => m.actions.loadAttention("account", accountId));
	assert.equal(details.title, "third@example.com");
	assert.equal(details.what, "Blocked by an admin: Spam.");
	assert.ok(details.trail.some(({ text, isItem }) => isItem && text === "Blocked by an admin: Spam"));

	assert.deepEqual(await as(admin, () => m.actions.dismissAttentionAction("account", accountId)), { ok: true });
	assert.equal(ids((await m.stats.listAttention()).blockedAccounts).includes(accountId), false);

	await as(admin, () => m.actions.unblockAccountAction(accountId));
	await wait(5);
	await as(admin, () => m.actions.blockAccountAction(accountId, "Spam again"));
	assert.ok(ids((await m.stats.listAttention()).blockedAccounts).includes(accountId), "a new block is a new item");
});

test("dismiss all like this sets aside every alert of the kind and nothing else", async () => {
	for (const slug of ["first-list", "second-list", "third-list"]) {
		await m.alerts.sendAlert({ accountId: customer.accountId, key: `welcome-cap:${slug}`, title: "Signup emails capped", detail: `Over 300 welcome emails for ${slug}.` });
	}
	const complaint = await complain();
	const first = await m.Alert.findOne({ key: "welcome-cap:first-list" }).lean();
	const { details } = await as(admin, () => m.actions.loadAttention("alert", String(first._id)));
	assert.deepEqual(details.sameType, { count: 2 });

	assert.deepEqual(await as(admin, () => m.actions.dismissAlertTypeAction(String(first._id))), { ok: true, count: 3 });
	const attention = await m.stats.listAttention();
	assert.equal(attention.alerts.some(({ title }) => title === "Signup emails capped"), false);
	assert.ok(ids(attention.alerts).includes(String(complaint._id)), "other kinds stay");
});

test("odd input finds nothing and writes nothing", async () => {
	const before = await m.Dismissal.countDocuments();
	assert.deepEqual(await as(admin, () => m.actions.loadAttention("nope", "123")), { error: "Not found" });
	assert.deepEqual(await as(admin, () => m.actions.loadAttention("alert", { $gt: "" })), { error: "Not found" });
	assert.deepEqual(await as(admin, () => m.actions.dismissAttentionAction("alert", "not-an-id")), { error: "Not found" });
	assert.deepEqual(await as(admin, () => m.actions.dismissAttentionAction("alert", String(new mongoose.Types.ObjectId()))), { error: "Not found" });
	assert.deepEqual(await as(admin, () => m.actions.dismissAttentionAction("constructor", String(new mongoose.Types.ObjectId()))), { error: "Not found" });
	assert.deepEqual(await as(admin, () => m.actions.dismissAlertTypeAction(String(new mongoose.Types.ObjectId()))), { error: "Not found" });
	assert.equal(await m.Dismissal.countDocuments(), before);
});

// Every kind of alert the code raises has a plain explanation for the dialog (lib/alert-kinds.js).
test("every alert kind in the code has an explanation", async () => {
	const sources = [];
	for (const dir of ["lib", "app"]) {
		for (const name of await readdir(join(ROOT, dir), { recursive: true })) {
			if (/\.(m?js|jsx)$/.test(name)) sources.push(await readFile(join(ROOT, dir, name), "utf8"));
		}
	}
	const kinds = new Set();
	for (const source of sources) {
		for (const [, expression] of source.matchAll(/sendAlert(?:IfRepeated)?\([^)]*?\bkey:\s*([^,\n]+)/gs)) {
			const start = /^[`"]([a-z][a-z0-9-]*)/.exec(expression.trim())?.[1];
			// The kinds a ternary picks from: words like "admin" in its condition aren't kinds.
			const picked = [...expression.matchAll(/"([a-z][a-z0-9]*-[a-z0-9-]+)"/g)].map(([, kind]) => kind);
			for (const kind of [start, ...picked].filter(Boolean)) kinds.add(getAlertType(kind.replace(/[-:]+$/, "")));
		}
	}
	assert.ok(kinds.size > 20, "found the alerts");
	const types = Object.keys(ALERT_TYPES);
	const missing = [...kinds].filter((kind) => !types.some((type) => type === kind || type.startsWith(`${kind}-`)));
	assert.deepEqual(missing, []);
});
