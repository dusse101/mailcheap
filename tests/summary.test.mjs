import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import {
	getDueSummary,
	getLatestSummaryPeriod,
	getSummaryFrequency,
	getSummaryLine,
	getSummaryPeriod,
	isQuietSummary,
	isSummaryEligible,
	parseSummaryKey,
	summarizeSubscribers,
} from "../lib/summary.js";
import { formatPeriodLabel, renderSummaryEmail } from "../lib/summary-email.js";
import { createSummaryEmailLinks } from "../lib/summary-links.js";
import {
	SETTINGS_TOKEN_MAX_AGE_MS,
	createSummarySettingsToken,
	createSummaryShareToken,
	verifySummarySettingsToken,
	verifySummaryShareToken,
} from "../lib/summary-token.js";

process.env.BETTER_AUTH_SECRET = "test-session-secret-with-at-least-32-characters";
process.env.APP_URL = "https://mail.example.com";

const CLOUD = { MAILCHEAP_CLOUD: "true" };
const ACCOUNT_ID = "74f1a2b3c4d5e6f7a8b9c0d1";
const NEWSLETTER_ID = "74f1a2b3c4d5e6f7a8b9c0d2";
const HOUR_MS = 3_600_000;

function at(iso) {
	return new Date(iso);
}

async function withEnv(values, run) {
	const previous = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
	Object.assign(process.env, values);
	try {
		return await run();
	} finally {
		for (const [name, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
}

test("a week ending on the night clocks go back is 7 days and an hour long, from midnight to midnight in its zone", () => {
	// Paris leaves summer time on Sunday Oct 25, 2026.
	const period = getSummaryPeriod({ frequency: "weekly", todayKey: "2026-10-26", timeZone: "Europe/Paris" });
	assert.equal(period.key, "weekly:2026-10-26");
	assert.equal(period.startKey, "2026-10-19");
	assert.equal(period.lastKey, "2026-10-25");
	assert.equal(period.start.toISOString(), "2026-10-18T22:00:00.000Z");
	assert.equal(period.end.toISOString(), "2026-10-25T23:00:00.000Z");
	assert.equal(period.end - period.start, 7 * 24 * HOUR_MS + HOUR_MS);
	assert.equal(period.previousStart.toISOString(), "2026-10-11T22:00:00.000Z");
});

test("the day clocks go forward is 23 hours long", () => {
	const period = getSummaryPeriod({ frequency: "daily", todayKey: "2026-03-30", timeZone: "Europe/Paris" });
	assert.equal(period.start.toISOString(), "2026-03-28T23:00:00.000Z");
	assert.equal(period.end.toISOString(), "2026-03-29T22:00:00.000Z");
	assert.equal(period.end - period.start, 23 * HOUR_MS);
});

test("a summary is due from 8 AM to noon in its owner's timezone, weekly ones on Mondays only", () => {
	const paris = { frequency: "weekly", timeZone: "Europe/Paris" };
	// 8 AM in Paris on the Monday after summer time ended is 7 AM UTC.
	assert.equal(getDueSummary({ ...paris, now: at("2026-10-26T07:00:00Z") })?.key, "weekly:2026-10-26");
	assert.equal(getDueSummary({ ...paris, now: at("2026-10-26T06:59:00Z") }), null);
	assert.equal(getDueSummary({ ...paris, now: at("2026-10-26T10:59:00Z") })?.key, "weekly:2026-10-26");
	assert.equal(getDueSummary({ ...paris, now: at("2026-10-26T11:00:00Z") }), null);
	assert.equal(getDueSummary({ ...paris, now: at("2026-10-27T07:00:00Z") }), null, "Tuesday");

	assert.equal(getDueSummary({ frequency: "daily", timeZone: "America/New_York", now: at("2026-11-02T13:00:00Z") })?.key, "daily:2026-11-02");
	assert.equal(getDueSummary({ frequency: "daily", timeZone: "Asia/Kolkata", now: at("2026-10-20T02:30:00Z") })?.key, "daily:2026-10-20");
	assert.equal(getDueSummary({ frequency: "off", timeZone: "UTC", now: at("2026-10-26T09:00:00Z") }), null);
});

test("a preview shows the last whole day, or the week before the latest Monday", () => {
	const wednesday = at("2026-10-21T12:00:00Z");
	const weekly = getLatestSummaryPeriod({ frequency: "weekly", timeZone: "UTC", now: wednesday });
	assert.deepEqual([weekly.startKey, weekly.lastKey], ["2026-10-12", "2026-10-18"]);
	const monday = getLatestSummaryPeriod({ frequency: "weekly", timeZone: "UTC", now: at("2026-10-19T05:00:00Z") });
	assert.deepEqual([monday.startKey, monday.lastKey], ["2026-10-12", "2026-10-18"]);
	const daily = getLatestSummaryPeriod({ frequency: "daily", timeZone: "UTC", now: wednesday });
	assert.deepEqual([daily.startKey, daily.lastKey], ["2026-10-20", "2026-10-20"]);
});

test("only the keys the cron writes are read back", () => {
	assert.deepEqual(parseSummaryKey("weekly:2026-10-26"), { frequency: "weekly", todayKey: "2026-10-26" });
	for (const key of ["monthly:2026-10-26", "weekly:2026-10-26:x", "weekly:26-10-2026", "", null]) assert.equal(parseSummaryKey(key), null);
});

test("weekly bars add up seven days each, the last one being the period", () => {
	const days = Array.from({ length: 56 }, (_, index) => ({ key: `d${index}`, joined: index % 7 === 6 ? 3 : 1, left: index === 55 ? 2 : 0, total: 100 + index }));
	const subscribers = summarizeSubscribers(days, "weekly");
	assert.equal(subscribers.bars.length, 8);
	assert.deepEqual(subscribers.bars.at(-1), { startKey: "d49", endKey: "d55", joined: 9, left: 2 });
	assert.equal(subscribers.joined, 9);
	assert.equal(subscribers.left, 2);
	assert.equal(subscribers.total, 155);
	assert.equal(subscribers.previousTotal, 148);
	assert.equal(subscribers.previousJoined, 9);

	const daily = summarizeSubscribers(days.slice(-10), "daily");
	assert.equal(daily.bars.length, 10, "a short history gives the bars it has");
	assert.equal(daily.joined, 3);
	assert.equal(daily.previousJoined, 1);
});

function subscribersOf({ joined = 0, left = 0, total = 500, previousJoined = null, bars }) {
	return {
		joined,
		left,
		total,
		previousTotal: total - joined + left,
		previousJoined,
		bars: bars ?? [{ joined: 0, left: 0 }, { joined: 0, left: 0 }, { joined: 0, left: 0 }, { joined, left }],
	};
}

test("the opening line says the one thing worth saying, from facts only", () => {
	const line = (frequency, subscribers, issue = null) => getSummaryLine({ frequency, subscribers, issue });
	const busyEarlier = [{ joined: 30, left: 0 }, { joined: 0, left: 1 }];

	assert.equal(line("weekly", subscribersOf({ joined: 20, total: 1_010 })), "You passed 1,000 subscribers this week.");
	assert.equal(line("weekly", subscribersOf({ joined: 3, total: 3 })), "Every list starts here: 3 people joined this week.");
	assert.equal(
		line("weekly", subscribersOf({ joined: 10, total: 210, bars: [{ joined: 2, left: 0 }, { joined: 3, left: 0 }, { joined: 1, left: 0 }, { joined: 10, left: 0 }] })),
		"More people joined this week than in any week of the last two months."
	);
	assert.equal(
		line("weekly", subscribersOf({ joined: 4, left: 1, total: 210, bars: [{ joined: 5, left: 1 }, { joined: 6, left: 1 }, { joined: 4, left: 1 }] })),
		"Your list grew 3 weeks in a row."
	);
	assert.equal(
		line("weekly", subscribersOf({ joined: 1, total: 600, bars: [...busyEarlier, { joined: 1, left: 0 }] }), { isSettled: true, comparison: { opened: 0.031 } }),
		"Your last issue opened 3.1% above your average."
	);
	assert.equal(
		line("weekly", subscribersOf({ joined: 1, total: 600, bars: [...busyEarlier, { joined: 1, left: 0 }] }), { isSettled: false, comparison: { opened: 0.031 } }),
		"1 person joined this week. Keep going.",
		"an issue still collecting opens isn't compared yet"
	);
	assert.equal(line("weekly", subscribersOf({ joined: 6, total: 106, bars: [...busyEarlier, { joined: 6, left: 0 }] })), "Your list grew 6% this week.");
	assert.equal(
		line("weekly", subscribersOf({ joined: 7, total: 507, previousJoined: 4, bars: [{ joined: 20, left: 0 }, { joined: 4, left: 5 }, { joined: 7, left: 0 }] })),
		"7 people joined this week, 3 more than the week before."
	);
	assert.equal(line("daily", subscribersOf({ joined: 1, left: 3, bars: [...busyEarlier, { joined: 1, left: 3 }] })), "More people left than joined yesterday. That happens after an issue goes out.");
	assert.equal(line("weekly", subscribersOf({ joined: 0 })), "A link to your website in your next post brings readers in.");
});

test("a day with no one joining or leaving and no issue is quiet", () => {
	const quiet = { subscribers: { joined: 0, left: 0 }, unsubscribed: 0, issue: { isInPeriod: false } };
	assert.equal(isQuietSummary(quiet), true);
	assert.equal(isQuietSummary({ ...quiet, issue: null }), true);
	assert.equal(isQuietSummary({ ...quiet, issue: { isInPeriod: true } }), false);
	assert.equal(isQuietSummary({ ...quiet, subscribers: { joined: 1, left: 0 } }), false);
	assert.equal(isQuietSummary({ ...quiet, subscribers: { joined: 0, left: 1 } }), false);
	assert.equal(isQuietSummary({ ...quiet, unsubscribed: 1 }), false);
});

test("summaries are for paying MailCheap Cloud accounts, each newsletter weekly unless its owner chose", () => {
	const paying = { subscriptionStatus: "active" };
	assert.equal(isSummaryEligible(paying, CLOUD), true);
	assert.equal(isSummaryEligible({ subscriptionStatus: "past_due" }, CLOUD), true);
	assert.equal(isSummaryEligible({ subscriptionStatus: "canceled" }, CLOUD), false);
	assert.equal(isSummaryEligible({}, CLOUD), false, "a free plan");
	assert.equal(isSummaryEligible({ ...paying, status: "paused" }, CLOUD), false);
	assert.equal(isSummaryEligible({ ...paying, deletion: { requestedAt: new Date() } }, CLOUD), false);
	assert.equal(isSummaryEligible(paying, {}), false, "a self-hosted server");

	assert.equal(getSummaryFrequency({}), "weekly");
	assert.equal(getSummaryFrequency(null), "weekly");
	assert.equal(getSummaryFrequency({ notifications: { summary: "daily" } }), "daily");
	assert.equal(getSummaryFrequency({ notifications: { summary: "off" } }), "off");
	assert.equal(getSummaryFrequency({ notifications: { summary: "hourly" } }), "weekly");
	assert.equal(getSummaryFrequency({ summary: { frequency: "off" } }), "weekly", "an account's old choice isn't a newsletter's");
});

test("a summary's settings link names one newsletter of one account and expires; its share link carries only the totals", () => {
	const now = Date.UTC(2026, 9, 26, 7);
	const reference = { accountId: ACCOUNT_ID, newsletterId: NEWSLETTER_ID };
	const token = createSummarySettingsToken(reference, now);
	assert.deepEqual(verifySummarySettingsToken(token, now + 30 * 24 * HOUR_MS), reference);
	assert.equal(verifySummarySettingsToken(token, now + SETTINGS_TOKEN_MAX_AGE_MS + 1_000), null, "expired");
	assert.equal(verifySummarySettingsToken(createSummarySettingsToken(reference, now + 5 * 60_000), now), null, "from the future");
	const [payload, signature] = token.split(".");
	const forge = (data) => `${Buffer.from(JSON.stringify({ t: Math.floor(now / 1000), ...data })).toString("base64url")}.${signature}`;
	assert.equal(verifySummarySettingsToken(forge({ a: "74f1a2b3c4d5e6f7a8b9c0d9", n: NEWSLETTER_ID }), now), null, "another account under the same signature");
	assert.equal(verifySummarySettingsToken(forge({ a: ACCOUNT_ID, n: "74f1a2b3c4d5e6f7a8b9c0d9" }), now), null, "another newsletter under the same signature");
	assert.equal(verifySummarySettingsToken(`${payload}.${signature.slice(0, -2)}AA`, now), null);
	assert.throws(() => createSummarySettingsToken({ accountId: "not-an-id", newsletterId: NEWSLETTER_ID }, now));
	assert.throws(() => createSummarySettingsToken({ accountId: ACCOUNT_ID }, now), "a link always names its newsletter");
	const key = Buffer.from(crypto.hkdfSync("sha256", process.env.BETTER_AUTH_SECRET, "", "mailcheap-summary-settings", 32));
	const accountOnly = Buffer.from(JSON.stringify({ a: ACCOUNT_ID, t: Math.floor(now / 1000) })).toString("base64url");
	const signed = `${accountOnly}.${crypto.createHmac("sha256", key).update(accountOnly).digest("base64url")}`;
	assert.equal(verifySummarySettingsToken(signed, now), null, "a signed link for the whole account, as summaries were, changes nothing");

	const share = createSummaryShareToken({ name: `  ${"N".repeat(90)} `, joined: 12.4, total: 1_510, frequency: "weekly", lastKey: "2026-10-25" });
	assert.deepEqual(verifySummaryShareToken(share), { name: "N".repeat(80), joined: 12, total: 1_510, frequency: "weekly", lastKey: "2026-10-25" });
	assert.equal(verifySummaryShareToken(token), null, "a settings link isn't a share link");
	assert.equal(verifySummarySettingsToken(share, now), null, "a share link isn't a settings link");
	assert.equal(verifySummaryShareToken(createSummaryShareToken({ name: "Hens", joined: 1, total: 1, frequency: "weekly", lastKey: "Oct 25" })), null);
});

test("share links exist on MailCheap Cloud for a period someone joined in, and every link opens the right newsletter", async () => {
	const period = getSummaryPeriod({ frequency: "weekly", todayKey: "2026-10-26", timeZone: "UTC" });
	const newsletter = (joined) => ({ id: NEWSLETTER_ID, name: "Hens", subscribers: { joined, total: 40 }, issue: { id: "74f1a2b3c4d5e6f7a8b9c0d3" } });
	const account = { _id: ACCOUNT_ID };
	await withEnv(CLOUD, () => {
		const links = createSummaryEmailLinks({ account, newsletter: newsletter(4), period });
		assert.equal(links.dashboardUrl, "https://mail.example.com/newsletters/74f1a2b3c4d5e6f7a8b9c0d2?next=%2F");
		assert.equal(links.campaignUrl, "https://mail.example.com/campaigns/74f1a2b3c4d5e6f7a8b9c0d3");
		assert.match(links.shareUrl, /^https:\/\/mail\.example\.com\/share\/[\w-]+\.[\w-]+$/);
		assert.match(links.oneClickUrl, /^https:\/\/mail\.example\.com\/api\/summary\/unsubscribe\?token=/);
		const token = links.settingsUrl.split("/summary/")[1];
		assert.equal(links.oneClickUrl.split("token=")[1], token, "the footer and the mail app's button act on the same newsletter");
		assert.deepEqual(verifySummarySettingsToken(token), { accountId: ACCOUNT_ID, newsletterId: NEWSLETTER_ID });
		assert.equal(createSummaryEmailLinks({ account, newsletter: newsletter(0), period }).shareUrl, null);
	});
	await withEnv({ MAILCHEAP_CLOUD: "" }, () => assert.equal(createSummaryEmailLinks({ account, newsletter: newsletter(4), period }).shareUrl, null));
});

const LINKS = {
	appUrl: "https://mail.example.com",
	logoUrl: "https://mail.example.com/icon-192.png",
	dashboardUrl: "https://mail.example.com/newsletters/74f1a2b3c4d5e6f7a8b9c0d2?next=%2F",
	campaignUrl: "https://mail.example.com/campaigns/74f1a2b3c4d5e6f7a8b9c0d3",
	settingsUrl: "https://mail.example.com/summary/token",
	oneClickUrl: "https://mail.example.com/api/summary/unsubscribe?token=token",
	shareUrl: "https://mail.example.com/share/share-token",
};

function renderEmail(overrides = {}) {
	const period = getSummaryPeriod({ frequency: "weekly", todayKey: "2026-10-26", timeZone: "UTC" });
	const main = {
		id: "74f1a2b3c4d5e6f7a8b9c0d2",
		name: "<b>Hens</b> & co",
		url: "https://mail.example.com/newsletters/74f1a2b3c4d5e6f7a8b9c0d2?next=%2F",
		subscribers: { joined: 12, left: 1, total: 1_210, previousTotal: 1_199, previousJoined: 8, bars: [{ startKey: "2026-10-19", endKey: "2026-10-25", joined: 12, left: 1 }] },
		unsubscribed: 1,
		previousUnsubscribed: 3,
		issue: {
			id: "74f1a2b3c4d5e6f7a8b9c0d3",
			subject: "<script>alert(1)</script>",
			startedAt: new Date("2026-10-22T09:00:00Z"),
			isInPeriod: true,
			reached: 1_000,
			opened: 520,
			clicked: 80,
			isSettled: true,
			comparison: { opened: 0.05, clicked: -0.01, issues: 6 },
			topLink: { url: "javascript:alert(1)", clickers: 30 },
		},
		line: "12 people joined this week, 4 more than the week before.",
	};
	return renderSummaryEmail({ frequency: "weekly", period, newsletter: main, links: LINKS, postalAddress: "1 Main St, Singapore", ...overrides });
}

test("the summary email escapes what customers write and carries a one-click unsubscribe", () => {
	const email = renderEmail();
	assert.equal(email.subject, "<b>Hens</b> & co: +12 subscribers this week");
	assert.ok(!email.html.includes("<script>alert(1)"));
	assert.ok(email.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
	assert.ok(!email.html.includes("<b>Hens</b>"));
	assert.ok(email.html.includes("summaries are on for &lt;b&gt;Hens&lt;/b&gt; &amp; co in MailCheap"), "the footer names the newsletter it's about");
	assert.match(email.text, /summaries are on for <b>Hens<\/b> & co in MailCheap\./);
	assert.ok(!email.html.includes("Your other newsletters"), "one newsletter per email");
	assert.ok(!/href="javascript:/i.test(email.html), "only web links become the most clicked link");
	assert.deepEqual(email.headers, {
		"List-Unsubscribe": "<https://mail.example.com/api/summary/unsubscribe?token=token>",
		"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
	});
	assert.ok(email.html.includes('href="https://mail.example.com/summary/token"'), "the footer changes or stops it");
	assert.ok(email.html.includes("1 Main St, Singapore"));
	assert.ok(email.html.includes("+5.0% vs your average"));
	assert.ok(email.html.includes("−1.0% vs your average"));
	assert.ok(!/\bpts\b/.test(email.html), "changes read in percent, never in points");
	assert.ok(email.html.includes("Share this week"));
	assert.match(email.text, /Subscribers: 1,210 \(\+0\.9%\)/);
	assert.match(email.text, /New: 12 \(\+4 vs last week\)/);
	assert.match(email.previewText, /^1,210 subscribers\. 12 people joined/);
});

test("a daily summary says yesterday, and has no share link without one", () => {
	const period = getSummaryPeriod({ frequency: "daily", todayKey: "2026-10-26", timeZone: "UTC" });
	const email = renderEmail({ frequency: "daily", period });
	assert.ok(email.html.includes("Share yesterday"));
	assert.equal(email.subject, "<b>Hens</b> & co: +12 subscribers yesterday");
	assert.equal(formatPeriodLabel({ frequency: "daily", ...period }), "Sun, Oct 25");
	assert.equal(formatPeriodLabel({ frequency: "weekly", startKey: "2026-09-28", lastKey: "2026-10-04" }), "Sep 28 – Oct 4");

	const withoutShare = renderEmail({ links: { ...LINKS, shareUrl: null } });
	assert.ok(!withoutShare.html.includes("Share this week"));
	assert.ok(!withoutShare.text.includes("Share this week"));
});
