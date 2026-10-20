import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";
import { activate, anonymous, as, callApi, catchRedirect, form, platformEmails, signIn, startTestApp, withEnv } from "./helpers/app.mjs";
import { published } from "./stubs/qstash.mjs";

// The summary email from the hourly cron to the inbox: which accounts get a job, the job sending once (again when a
// send fails), a quiet day skipped, and the ways to change it or stop it without signing in.
let app;
let m;
let reader = 0;

// 8:30 AM UTC on a Monday: the weekly summary and the daily one are due for an account in UTC.
const MONDAY = new Date("2026-10-26T08:30:00Z");
const WEEKLY_KEY = "weekly:2026-10-26";
const DAY_MS = 86_400_000;

before(async () => {
	app = await startTestApp();
	m = {
		send: await import("../lib/summary-send.js"),
		summary: await import("../lib/summary.js"),
		token: await import("../lib/summary-token.js"),
		unsubscribeRoute: await import("../app/api/summary/unsubscribe/route.js"),
		settings: await import("../app/summary/[token]/actions.js"),
		account: await import("../app/(account)/account/actions.js"),
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		Account: (await import("../models/Account.js")).default,
		Contact: (await import("../models/Contact.js")).default,
	};
});

after(() => app?.stop());

async function customer(email, { hasPlan = true, frequency } = {}) {
	const user = await signIn(email);
	if (hasPlan) await activate(user);
	user.slug = email.split("@")[0];
	const url = await as(user, () =>
		catchRedirect(m.newsletters.saveNewsletter(null, form({ name: `${user.slug} news`, slug: user.slug, postalAddress: "1 Main St, Paris" })))
	);
	user.newsletterId = url.split("/").at(-1);
	if (frequency) await m.send.saveSummaryFrequency(user.accountId, frequency);
	return user;
}

// Readers who joined at that time, written as they are so their signup date stays in the past.
async function addReaders(user, count, joinedAt) {
	const docs = Array.from({ length: count }, () => ({
		accountId: user.accountId,
		newsletterId: new mongoose.Types.ObjectId(user.newsletterId),
		email: `reader${++reader}@example.org`,
		status: "active",
		subscribedAt: joinedAt,
		createdAt: joinedAt,
		updatedAt: joinedAt,
	}));
	await m.Contact.collection.insertMany(docs);
}

async function readSummary(user) {
	return (await m.Account.findById(user.accountId).lean()).summary ?? {};
}

// Summaries only: sign-in codes go to the same address.
function emailsTo(user) {
	return platformEmails.filter(({ to, headers }) => to.includes(user.email) && headers?.["List-Unsubscribe-Post"]);
}

test("the hourly run queues one job per paying account whose summary is due, in its timezone", async () => {
	const weekly = await customer("queue-weekly@example.com");
	const daily = await customer("queue-daily@example.com", { frequency: "daily" });
	const off = await customer("queue-off@example.com", { frequency: "off" });
	const free = await customer("queue-free@example.com", { hasPlan: false });
	const tokyo = await customer("queue-tokyo@example.com");
	await m.Account.updateOne({ _id: tokyo.accountId }, { $set: { "summary.timeZone": "Asia/Tokyo" } });

	const before = published.length;
	await m.send.queueDueSummaries({ now: MONDAY });
	const jobs = published.slice(before).filter(({ url }) => url.endsWith("/api/jobs/send-summary"));
	const keys = Object.fromEntries(jobs.map(({ body }) => [body.accountId, body.key]));
	assert.equal(keys[String(weekly.accountId)], WEEKLY_KEY);
	assert.equal(keys[String(daily.accountId)], "daily:2026-10-26");
	assert.equal(keys[String(off.accountId)], undefined, "turned off");
	assert.equal(keys[String(free.accountId)], undefined, "no paid plan");
	assert.equal(keys[String(tokyo.accountId)], undefined, "5:30 PM in Tokyo");
	const job = jobs.find(({ body }) => body.accountId === String(weekly.accountId));
	assert.equal(job.deduplicationId, `summary-${weekly.accountId}-weekly-2026-10-26`);

	const early = published.length;
	await m.send.queueDueSummaries({ now: new Date("2026-10-26T07:30:00Z") });
	assert.equal(published.slice(early).filter(({ body }) => body?.accountId === String(weekly.accountId)).length, 0, "before 8 AM");
	await withEnv({ MAILCHEAP_CLOUD: "" }, async () => assert.deepEqual(await m.send.queueDueSummaries({ now: MONDAY }), { queued: 0 }));
});

test("a summary goes out once, to the owner, with the account's numbers and a one-click unsubscribe", async () => {
	const user = await customer("send-once@example.com");
	await addReaders(user, 2, new Date("2026-09-01T10:00:00Z"));
	await addReaders(user, 3, new Date("2026-10-14T10:00:00Z"));
	await addReaders(user, 5, new Date("2026-10-21T10:00:00Z"));

	assert.deepEqual(await m.send.sendSummary({ accountId: user.accountId, key: WEEKLY_KEY, now: MONDAY }), { sent: true });
	const [email] = emailsTo(user);
	assert.equal(email.subject, "send-once news: +5 subscribers this week");
	assert.equal(email.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
	assert.match(email.headers["List-Unsubscribe"], /^<http:\/\/localhost:3000\/api\/summary\/unsubscribe\?token=[\w-]+\.[\w-]+>$/);
	assert.match(email.text, /Subscribers: 10 \(\+100%\)/);
	assert.match(email.text, /New: 5 \(\+2 vs last week\)/);
	assert.ok(email.html.includes("http://localhost:3000/share/"), "someone joined: there's something to share");
	assert.equal((await readSummary(user)).lastSentKey, WEEKLY_KEY);

	assert.deepEqual(await m.send.sendSummary({ accountId: user.accountId, key: WEEKLY_KEY, now: MONDAY }), { skipped: "sent" });
	assert.equal(emailsTo(user).length, 1, "a second delivery of the job sends nothing");
});

test("a failed send is given back, so the job's retry sends it", async () => {
	const user = await customer("send-retry@example.com");
	const fetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		if (String(input) === "https://api.resend.com/emails") throw new Error("Resend is down");
		return fetch(input, init);
	};
	try {
		await assert.rejects(m.send.sendSummary({ accountId: user.accountId, key: WEEKLY_KEY, now: MONDAY }), /Resend is down/);
	} finally {
		globalThis.fetch = fetch;
	}
	assert.equal((await readSummary(user)).lastSentKey, undefined);
	assert.deepEqual(await m.send.sendSummary({ accountId: user.accountId, key: WEEKLY_KEY, now: MONDAY }), { sent: true });
	assert.equal(emailsTo(user).length, 1);
});

test("a daily summary skips a day with no news; a weekly one says it was quiet", async () => {
	const daily = await customer("quiet-daily@example.com", { frequency: "daily" });
	assert.deepEqual(await m.send.sendSummary({ accountId: daily.accountId, key: "daily:2026-10-26", now: MONDAY }), { skipped: "quiet" });
	assert.equal(emailsTo(daily).length, 0);

	const weekly = await customer("quiet-weekly@example.com");
	assert.deepEqual(await m.send.sendSummary({ accountId: weekly.accountId, key: WEEKLY_KEY, now: MONDAY }), { sent: true });
	const [email] = emailsTo(weekly);
	assert.equal(email.subject, "quiet-weekly news: no new subscribers this week");
	assert.ok(!email.html.includes("/share/"), "nothing to share");
});

test("a job that comes too late, for another frequency, or for an account that stopped paying sends nothing", async () => {
	const user = await customer("stale-job@example.com");
	assert.deepEqual(await m.send.sendSummary({ accountId: user.accountId, key: WEEKLY_KEY, now: new Date(MONDAY.getTime() + DAY_MS) }), { skipped: "stale" });
	assert.deepEqual(await m.send.sendSummary({ accountId: user.accountId, key: "daily:2026-10-26", now: MONDAY }), { skipped: "frequency_changed" });
	assert.deepEqual(await m.send.sendSummary({ accountId: user.accountId, key: "weekly:yesterday", now: MONDAY }), { skipped: "invalid" });
	await m.Account.updateOne({ _id: user.accountId }, { $set: { subscriptionStatus: "canceled" } });
	assert.deepEqual(await m.send.sendSummary({ accountId: user.accountId, key: WEEKLY_KEY, now: MONDAY }), { skipped: "not_eligible" });
	assert.equal(emailsTo(user).length, 0);
});

function unsubscribeRequest(method, token) {
	const url = `http://localhost:3000/api/summary/unsubscribe?token=${encodeURIComponent(token)}`;
	return method === "POST"
		? new Request(url, { method, headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" })
		: new Request(url, { method });
}

test("a mail app's one-click unsubscribe turns summaries off; opening the link only shows the choice", async () => {
	const user = await customer("one-click@example.com");
	const token = m.token.createSummarySettingsToken(user.accountId);

	const opened = await m.unsubscribeRoute.GET(unsubscribeRequest("GET", token));
	assert.equal(new URL(opened.headers.get("location")).pathname, `/summary/${token}`);
	assert.equal((await readSummary(user)).frequency, undefined, "a link scanner's visit changes nothing");

	const response = await m.unsubscribeRoute.POST(unsubscribeRequest("POST", token));
	assert.equal(response.status, 200);
	assert.equal((await readSummary(user)).frequency, "off");

	const forged = await m.unsubscribeRoute.POST(unsubscribeRequest("POST", `${token.split(".")[0]}.${"A".repeat(43)}`));
	assert.equal(forged.status, 400);
});

test("the summary's own page changes how often it comes with the link alone", async () => {
	const user = await customer("settings-link@example.com");
	const token = m.token.createSummarySettingsToken(user.accountId);
	const save = (fields) => anonymous(() => catchRedirect(m.settings.saveSummaryChoice(form(fields))));

	assert.equal(await save({ token, frequency: "daily" }), `/summary/${token}?saved=daily`);
	assert.equal((await readSummary(user)).frequency, "daily");
	assert.equal(await save({ token, frequency: "hourly" }), `/summary/${token}`);
	assert.equal((await readSummary(user)).frequency, "daily");
	const other = await customer("settings-other@example.com");
	const forged = `${m.token.createSummarySettingsToken(other.accountId).split(".")[0]}.${token.split(".")[1]}`;
	await save({ token: forged, frequency: "off" });
	assert.equal((await readSummary(other)).frequency, undefined, "another account's ID under this link's signature");
});

test("the Account page saves the choice in the browser's timezone and previews the account's own numbers", async () => {
	const user = await customer("account-page@example.com");
	await addReaders(user, 4, new Date(Date.now() - 2 * DAY_MS));
	user.jar.set("tz", "Europe/Paris");

	assert.deepEqual(await as(user, () => m.account.updateSummaryFrequency("daily")), { ok: true });
	assert.deepEqual(await readSummary(user), { frequency: "daily", timeZone: "Europe/Paris" });
	assert.deepEqual(await as(user, () => m.account.updateSummaryFrequency("hourly")), { error: "Pick daily, weekly or off" });

	const preview = await as(user, () => m.account.previewSummaryEmail());
	assert.match(preview.subject, /^account-page news: /);
	assert.ok(preview.html.includes("account-page news"));

	await m.send.rememberTimeZone(await m.Account.findById(user.accountId).lean(), "Mars/Olympus_Mons");
	assert.equal((await readSummary(user)).timeZone, "Europe/Paris", "an unknown zone isn't kept");
	await m.send.rememberTimeZone(await m.Account.findById(user.accountId).lean(), "Asia/Tokyo");
	assert.equal((await readSummary(user)).timeZone, "Asia/Tokyo");
});

test("get_summary gives the same numbers through the API, for the last whole week", async () => {
	const user = await customer("summary-api@example.com");
	const period = m.summary.getLatestSummaryPeriod({ frequency: "weekly", timeZone: "UTC" });
	await addReaders(user, 6, new Date(period.start.getTime() + DAY_MS));
	await addReaders(user, 1, new Date(period.start.getTime() - DAY_MS));
	const { key } = await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Summary", level: "full" })));

	const response = await callApi("GET", "/api/v1/summary?period=week&timeZone=UTC", { key });
	assert.equal(response.status, 200, JSON.stringify(response.body));
	assert.deepEqual(response.body.period, { from: period.startKey, to: period.lastKey, timeZone: "UTC" });
	assert.equal(response.body.summary.subscribers.joined, 6);
	assert.equal(response.body.summary.subscribers.previousJoined, 1);
	assert.equal(response.body.summary.subscribers.total, 7);
	assert.equal(response.body.summary.subscribers.bars.length, 8);
	assert.equal(typeof response.body.summary.line, "string");
});
