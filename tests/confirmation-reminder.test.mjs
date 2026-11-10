import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { CONFIRM_LINK_MAX_AGE_MS, getConfirmUrl, verifyConfirmToken } from "../lib/confirmation.js";
import { CONFIRM_URL_PLACEHOLDER, getConfirmationContent } from "../lib/confirmation-content.js";
import { getConfirmationReminderContent } from "../lib/confirmation-reminder-content.js";
import {
	CONFIRMATION_REMINDER_AFTER_MS,
	CONFIRMATION_REMINDER_CLAIM_MS,
	CONFIRMATION_REMINDER_GRACE_MS,
	backfillAgeBucket,
	backfillHaltReason,
	backfillIsExpired,
	backfillSendProblem,
	classifyBackfillContact,
	earliestReminderSignup,
	getReminderWindow,
	readConfirmationReminderBackfill,
	readConfirmationReminders,
	reminderClaimBlocks,
} from "../lib/confirmation-reminder-rules.js";
import { renderEmail } from "../lib/render-email.js";
import { withEnv } from "./helpers/app.mjs";

process.env.BETTER_AUTH_SECRET ||= "test-secret-for-confirmation-links";
process.env.APP_URL ||= "https://mailcheap.test";

const NOW = new Date("2026-11-06T12:00:00.000Z");
const SINCE = new Date("2026-01-01T00:00:00.000Z");
const REFERENCE = { contactId: "64f1a2b3c4d5e6f7a8b9c0a1", newsletterId: "64f1a2b3c4d5e6f7a8b9c0b1" };

function at(ms) {
	return new Date(NOW.getTime() - ms);
}

test("reminders stay off unless the variable is a map of slug to a date", () => {
	assert.equal(readConfirmationReminders({}).size, 0);
	assert.equal(readConfirmationReminders({ CONFIRMATION_REMINDERS: "" }).size, 0);
	assert.equal(readConfirmationReminders({ CONFIRMATION_REMINDERS: "  " }).size, 0);
	assert.equal(readConfirmationReminders({ CONFIRMATION_REMINDERS: "{" }).size, 0);
	assert.equal(readConfirmationReminders({ CONFIRMATION_REMINDERS: "[]" }).size, 0);
	assert.equal(readConfirmationReminders({ CONFIRMATION_REMINDERS: "null" }).size, 0);
	assert.equal(readConfirmationReminders({ CONFIRMATION_REMINDERS: JSON.stringify({ "Not a slug": SINCE.toISOString() }) }).size, 0);
	assert.equal(readConfirmationReminders({ CONFIRMATION_REMINDERS: JSON.stringify({ weekly: "yesterday" }) }).size, 0);
	assert.equal(readConfirmationReminders({ CONFIRMATION_REMINDERS: JSON.stringify({ weekly: { $gt: "" } }) }).size, 0);
	for (const loose of ["1", "2026", "2026-11-06", "2026-11-06T15:00:00", "November 6, 2026", "2026-99-99T00:00:00.000Z"]) {
		assert.equal(readConfirmationReminders({ CONFIRMATION_REMINDERS: JSON.stringify({ weekly: loose }) }).size, 0, loose);
	}
	assert.equal(readConfirmationReminders({ CONFIRMATION_REMINDERS: JSON.stringify({ weekly: "2026-11-06T15:00:00-06:00" }) }).size, 1);

	const rules = readConfirmationReminders({
		CONFIRMATION_REMINDERS: JSON.stringify({ Weekly: SINCE.toISOString(), "also-off": 1700000000000 }),
	});
	assert.deepEqual([...rules.keys()], ["weekly"]);
	assert.equal(rules.get("weekly").toISOString(), SINCE.toISOString());
});

test("the window opens at 24 hours and closes 48 hours later, and a resend restarts it", () => {
	const base = { status: "pending", since: SINCE, now: NOW, latestConfirmationAt: SINCE };
	assert.equal(getReminderWindow({ ...base, status: "active", subscribedAt: at(CONFIRMATION_REMINDER_AFTER_MS) }).reason, "not pending");
	assert.equal(getReminderWindow({ ...base, status: "unsubscribed", subscribedAt: at(CONFIRMATION_REMINDER_AFTER_MS) }).reason, "not pending");
	assert.equal(getReminderWindow({ ...base, status: "bounced", subscribedAt: at(CONFIRMATION_REMINDER_AFTER_MS) }).reason, "not pending");
	assert.equal(getReminderWindow({ ...base, status: "complained", subscribedAt: at(CONFIRMATION_REMINDER_AFTER_MS) }).reason, "not pending");
	assert.equal(getReminderWindow({ ...base, subscribedAt: at(CONFIRMATION_REMINDER_AFTER_MS), since: NOW }).reason, "before activation");

	assert.equal(getReminderWindow({ ...base, subscribedAt: at(CONFIRMATION_REMINDER_AFTER_MS - 1) }).reason, "too soon");
	const due = getReminderWindow({ ...base, subscribedAt: at(CONFIRMATION_REMINDER_AFTER_MS) });
	assert.equal(due.open, true);
	assert.equal(due.cycleAt.toISOString(), at(CONFIRMATION_REMINDER_AFTER_MS).toISOString());

	const graceEnd = CONFIRMATION_REMINDER_AFTER_MS + CONFIRMATION_REMINDER_GRACE_MS;
	assert.equal(getReminderWindow({ ...base, subscribedAt: at(graceEnd) }).reason, "too late");
	assert.equal(getReminderWindow({ ...base, subscribedAt: at(graceEnd - 1) }).open, true);

	const signedUp = at(40 * 60 * 60 * 1000);
	assert.equal(getReminderWindow({ ...base, subscribedAt: signedUp, latestConfirmationAt: at(60 * 60 * 1000) }).reason, "too soon");
	assert.equal(getReminderWindow({ ...base, subscribedAt: signedUp, latestConfirmationAt: at(CONFIRMATION_REMINDER_AFTER_MS) }).open, true);
	assert.equal(getReminderWindow({ ...base, subscribedAt: signedUp, latestConfirmationAt: null }).reason, "no confirmation sent", "a reminder is never the first email");
	assert.equal(getReminderWindow({ status: "pending", since: SINCE, now: NOW, subscribedAt: signedUp }).reason, "no confirmation sent");
});

test("a sent or skipped cycle blocks another reminder; a failed one and a stale claim do not", () => {
	const cycleAt = at(CONFIRMATION_REMINDER_AFTER_MS);
	assert.equal(reminderClaimBlocks(null, cycleAt, NOW), false);
	assert.equal(reminderClaimBlocks({ cycleAt, state: "sent" }, cycleAt, NOW), true);
	assert.equal(reminderClaimBlocks({ cycleAt, state: "skipped" }, cycleAt, NOW), true);
	assert.equal(reminderClaimBlocks({ cycleAt: NOW, state: "sent" }, cycleAt, NOW), false, "a new signup is a new cycle");
	assert.equal(reminderClaimBlocks({ cycleAt, state: "retry" }, cycleAt, NOW), false);
	assert.equal(reminderClaimBlocks({ cycleAt, state: "claimed", claimedAt: NOW }, cycleAt, NOW), true);
	assert.equal(
		reminderClaimBlocks({ cycleAt, state: "claimed", claimedAt: at(CONFIRMATION_REMINDER_CLAIM_MS) }, cycleAt, NOW),
		false
	);
	const earliest = earliestReminderSignup(SINCE, NOW);
	assert.ok(earliest > SINCE);
});

test("the reminder asks them to confirm, with a fresh link, and does not describe the newsletter", async () => {
	const content = getConfirmationReminderContent({ name: "Taco & Tell", description: "Tacos every Thursday" });
	assert.equal(content.subject, "Reminder: confirm your subscription to Taco & Tell");
	assert.match(content.previewText, /only reminder/);
	assert.match(content.markdown, /Please confirm your subscription/);
	assert.match(content.markdown, /You stay off the list/);
	assert.equal(/one click/i.test(`${content.previewText} ${content.markdown}`), false, "the confirm page has its own button");
	assert.equal(/porch|380|nudge/i.test(`${content.subject} ${content.markdown}`), false, "the brand's jokes stay in the brand");
	assert.match(content.markdown, /won't receive Taco & Tell until you confirm/);
	assert.match(content.markdown, /only reminder/);
	assert.ok(content.markdown.includes(CONFIRM_URL_PLACEHOLDER));
	assert.equal(content.markdown.includes("Tacos every Thursday"), false);
	assert.equal(/thursday morning/i.test(content.markdown), false);

	const fresh = getConfirmUrl(REFERENCE, "https://mailcheap.test", NOW.getTime());
	const stale = getConfirmUrl(REFERENCE, "https://mailcheap.test", NOW.getTime() - CONFIRM_LINK_MAX_AGE_MS - 1000);
	assert.deepEqual(verifyConfirmToken(new URL(fresh).searchParams.get("token"), NOW.getTime()), REFERENCE);
	assert.equal(verifyConfirmToken(new URL(stale).searchParams.get("token"), NOW.getTime()), null);
	assert.notEqual(fresh, stale);

	await withEnv({ EMAIL_BRAND: "tacoandtell" }, () => {
		const email = renderEmail({
			...content,
			kind: "confirmation-reminder",
			newsletter: { name: "Taco & Tell", postalAddress: "1 Main St" },
			unsubscribeUrl: "https://mailcheap.test/unsubscribe?token=example",
		});
		assert.match(email.html, /not on the list until you confirm/);
		assert.match(email.text, /not on the list until you confirm/);
		assert.equal(email.html.includes("Past issues"), false);
		assert.equal(/every Thursday morning/.test(email.html), false);
		assert.match(email.html, /Confirm my subscription/);
	});
});

test("the brand's reminder is its own copy, exactly, and repaints the button", async () => {
	await withEnv({ EMAIL_BRAND: "tacoandtell" }, () => {
		const content = getConfirmationReminderContent({ name: "Anything else" });
		assert.equal(content.subject, "Your Taco & Tell signup is still on the porch");
		assert.equal(content.previewText, "You're not on the list until you confirm. This is the only reminder.");
		assert.equal(
			content.markdown,
			`**So close.**

Your Taco & Tell signup isn’t confirmed yet. Tap the button below to open your confirmation page, then tap “Yes, subscribe me” in your browser. It takes less time than a red light on 380.

<a href="${CONFIRM_URL_PLACEHOLDER}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px;">Open my confirmation page</a>

Didn’t sign up? Ignore this. You stay off the list, and this is the last nudge you’ll get from us.`
		);
		const email = renderEmail({
			...content,
			kind: "confirmation-reminder",
			newsletter: { name: "Taco & Tell", postalAddress: "1 Main St" },
			unsubscribeUrl: "https://mailcheap.test/unsubscribe?token=example",
		});
		const visible = `So close.

Your Taco & Tell signup isn’t confirmed yet. Tap the button below to open your confirmation page, then tap “Yes, subscribe me” in your browser. It takes less time than a red light on 380.

Open my confirmation page (${CONFIRM_URL_PLACEHOLDER})

Didn’t sign up? Ignore this. You stay off the list, and this is the last nudge you’ll get from us.`;
		assert.ok(email.text.startsWith(`${visible}\n\n`), email.text);
		assert.match(email.text, /You're not on the list until you confirm\./, "the footer is unchanged");
		assert.match(email.html, /<p><strong>So close\.<\/strong><\/p>/);
		assert.match(
			email.html,
			/<p>Your Taco &amp; Tell signup isn’t confirmed yet\. Tap the button below to open your confirmation page, then tap “Yes, subscribe me” in your browser\. It takes less time than a red light on 380\.<\/p>/
		);
		assert.match(email.html, /<a href="\{\{confirm_url\}\}"[^>]*>Open my confirmation page<\/a>/);
		assert.match(email.html, /<p>Didn’t sign up\? Ignore this\. You stay off the list, and this is the last nudge you’ll get from us\.<\/p>/);
		assert.match(email.html, /<title>Your Taco &amp; Tell signup is still on the porch<\/title>/);
		assert.match(email.html, /data-preheader>You&#39;re not on the list until you confirm\. This is the only reminder\./);
		assert.match(email.html, /bgcolor="#d63a55"/, "the brand's button color");
		assert.equal(email.html.includes("#18181b"), false, "not the stock one");
		for (const part of [content.markdown, email.html, email.text]) {
			assert.equal(/one button short/i.test(part), false);
			assert.equal(part.includes("Confirm my subscription"), false);
		}
	});
});

test("the built-in confirmation keeps its stock line, and the brand's doesn't promise silence", async () => {
	const stock = await withEnv({ EMAIL_BRAND: "" }, () => getConfirmationContent({ name: "Field notes" }));
	assert.match(stock.markdown, /you won't hear from us again/);
	const branded = await withEnv({ EMAIL_BRAND: "tacoandtell" }, () => getConfirmationContent({ name: "Taco & Tell" }));
	assert.match(branded.markdown, /Ignore this email and you stay off the list\.$/);
	assert.equal(/won't hear from us/.test(branded.markdown), false);
});

const RULE_NOW = new Date("2026-11-20T12:00:00.000Z");
const RULE = { before: new Date("2026-11-06T00:00:00.000Z"), maxAgeDays: 30, maxTotal: 10, perRun: 5, expiresAt: new Date("2026-11-27T00:00:00.000Z") };
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days) => new Date(RULE_NOW.getTime() - days * DAY);

test("the backfill setting is off unless valid, and a dry run unless it says exactly send", () => {
	const read = (value) => readConfirmationReminderBackfill({ CONFIRMATION_REMINDER_BACKFILL: JSON.stringify({ weekly: value }) }).get("weekly");
	assert.equal(readConfirmationReminderBackfill({}).size, 0);
	assert.equal(readConfirmationReminderBackfill({ CONFIRMATION_REMINDER_BACKFILL: "{" }).size, 0);
	const before = "2026-11-06T00:00:00.000Z";
	assert.deepEqual(read({ before }), { mode: "dry-run", before: new Date(before), maxAgeDays: 30, maxTotal: 0, perRun: 10, expiresAt: null });
	for (const mode of [undefined, "dry-run", "SEND", "send ", "true", true, 1, null]) assert.equal(read({ before, mode }).mode, "dry-run", String(mode));
	assert.equal(read({ before, mode: "send" }).mode, "send");
	for (const bad of [{}, { before: "2026-11-06" }, { before, maxAgeDays: 0 }, { before, maxAgeDays: 91 }, { before, maxTotal: -1 }, { before, perRun: 0 }, { before, perRun: 26 }, { before, expiresAt: "soon" }, "x", null]) {
		assert.equal(read(bad), undefined, JSON.stringify(bad));
	}
});

test("a backfill that sends needs a past line, an end date and a total", () => {
	assert.equal(backfillSendProblem(RULE, RULE_NOW), null);
	assert.match(backfillSendProblem({ ...RULE, before: new Date(RULE_NOW.getTime() + 1) }, RULE_NOW), /grow/);
	assert.match(backfillSendProblem({ ...RULE, expiresAt: null }, RULE_NOW), /expiresAt/);
	assert.match(backfillSendProblem({ ...RULE, maxTotal: 0 }, RULE_NOW), /maxTotal/);
	assert.equal(backfillIsExpired(RULE, RULE_NOW), false);
	assert.equal(backfillIsExpired(RULE, RULE.expiresAt), true);
});

test("a complaint halts the backfill, and so do bounces over 5% with at least 3", () => {
	assert.equal(backfillHaltReason({ sent: 100, complained: 1 }), "complaint");
	assert.equal(backfillHaltReason({ sent: 3, bounced: 2 }), null, "too few to mean anything");
	assert.equal(backfillHaltReason({ sent: 100, bounced: 5 }), null, "exactly 5%");
	assert.equal(backfillHaltReason({ sent: 100, bounced: 6 }), "bounces");
	assert.equal(backfillHaltReason({ sent: 10, bounced: 3 }), "bounces");
});

test("who the backfill can reach", () => {
	const eligible = { subscribedAt: daysAgo(20), rule: RULE, now: RULE_NOW, latestSentAt: daysAgo(20), latestConfirmationAt: daysAgo(20) };
	assert.equal(classifyBackfillContact(eligible), "eligible");
	assert.equal(classifyBackfillContact({ ...eligible, subscribedAt: RULE.before }), "notInGroup", "at the line is a new signup");
	assert.equal(classifyBackfillContact({ ...eligible, subscribedAt: daysAgo(31) }), "tooOld");
	assert.equal(classifyBackfillContact({ ...eligible, latestSentAt: null, latestConfirmationAt: null }), "noConfirmationSent");
	assert.equal(classifyBackfillContact({ ...eligible, latestSentAt: null, latestConfirmationAt: daysAgo(0.01) }), "noConfirmationSent", "a queued one alone earns nothing");
	assert.equal(classifyBackfillContact({ ...eligible, latestConfirmationAt: daysAgo(0.5) }), "tooRecent", "a resend restarts the wait");
	assert.equal(classifyBackfillContact({ ...eligible, accountSuppressed: true }), "accountSuppressed");
	assert.equal(classifyBackfillContact({ ...eligible, neverEmail: true }), "neverEmail");
	assert.equal(classifyBackfillContact({ ...eligible, cycleFinished: true }), "alreadyReminded");
	assert.equal(classifyBackfillContact({ ...eligible, lastReminderAt: daysAgo(89) }), "alreadyReminded", "any reminder in 90 days");
	assert.equal(classifyBackfillContact({ ...eligible, lastReminderAt: daysAgo(91) }), "eligible");
	assert.deepEqual(
		[1, 3.9, 4, 7, 8, 14, 15, 30, 31].map((days) => backfillAgeBucket(daysAgo(days), RULE_NOW)),
		["1-3d", "1-3d", "4-7d", "4-7d", "8-14d", "8-14d", "15-30d", "15-30d", "31d+"]
	);
});

test("vercel.json runs only the isolated reminder route, daily at 7:00 in Chicago", () => {
	const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
	assert.equal(config.crons, undefined, "a crons entry would run in UTC, and run the route a second time");
	assert.deepEqual(config.schedules, {
		"confirmation-reminders": {
			schedule: "0 7 * * *",
			timezone: "America/Chicago",
			path: "/api/cron/confirmation-reminders",
			// Schedules default to POST, and withCronSecret only exports GET.
			requestMethod: "GET",
		},
	});
	assert.ok(existsSync(new URL("../app/api/cron/confirmation-reminders/route.js", import.meta.url)));
});

test("the daily route's only imports are the reminder and the secret check", () => {
	const source = readFileSync(new URL("../app/api/cron/confirmation-reminders/route.js", import.meta.url), "utf8");
	assert.deepEqual([...source.matchAll(/from "([^"]+)"/g)].map(([, from]) => from).sort(), ["@/lib/confirmation-reminder", "@/lib/cron"]);
});

test("a run at about 7:00 in Chicago always falls inside the reminder window, across daylight saving", () => {
	const HOUR_MS = 60 * 60 * 1000;
	const chicagoHour = (at) =>
		new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(at);
	// 7:00 in Chicago is 12:00 UTC in summer and 13:00 UTC in winter. Each run starts as late or as early as the 15 minute jitter allows.
	const runs = [];
	for (let day = 0; day < 400; day++) {
		const midnight = Date.UTC(2026, 0, 1 + day);
		const start = [12, 13].map((hour) => midnight + hour * HOUR_MS).find((at) => chicagoHour(at) === "7");
		runs.push(start + (day % 2 ? 15 * 60 * 1000 : 0));
	}
	const fewest = (start) => runs.filter((at) => at >= start && at < start + CONFIRMATION_REMINDER_GRACE_MS).length;
	let least = Infinity;
	const end = runs.at(-1) - CONFIRMATION_REMINDER_AFTER_MS - CONFIRMATION_REMINDER_GRACE_MS;
	for (let signup = runs[0]; signup < end; signup += 11 * 60 * 1000) {
		const count = fewest(signup + CONFIRMATION_REMINDER_AFTER_MS);
		least = Math.min(least, count);
		const firstRun = runs.find((at) => at >= signup + CONFIRMATION_REMINDER_AFTER_MS);
		const window = getReminderWindow({
			status: "pending",
			subscribedAt: new Date(signup),
			since: new Date(runs[0]),
			now: new Date(firstRun),
			latestConfirmationAt: new Date(signup),
		});
		assert.equal(window.open, true);
		assert.ok(firstRun - signup < 50 * HOUR_MS, "the first chance comes within about two days");
	}
	assert.ok(least >= 1, "no signup's window closes between two runs");
});
