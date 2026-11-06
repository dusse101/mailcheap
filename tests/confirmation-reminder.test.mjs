import assert from "node:assert/strict";
import { test } from "node:test";
import { CONFIRM_LINK_MAX_AGE_MS, getConfirmUrl, verifyConfirmToken } from "../lib/confirmation.js";
import { CONFIRM_URL_PLACEHOLDER } from "../lib/confirmation-content.js";
import { getConfirmationReminderContent } from "../lib/confirmation-reminder-content.js";
import {
	CONFIRMATION_REMINDER_AFTER_MS,
	CONFIRMATION_REMINDER_CLAIM_MS,
	CONFIRMATION_REMINDER_GRACE_MS,
	earliestReminderSignup,
	getReminderWindow,
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

	const rules = readConfirmationReminders({
		CONFIRMATION_REMINDERS: JSON.stringify({ Weekly: SINCE.toISOString(), "also-off": 1700000000000 }),
	});
	assert.deepEqual([...rules.keys()], ["weekly"]);
	assert.equal(rules.get("weekly").toISOString(), SINCE.toISOString());
});

test("the window opens at 24 hours and closes 48 hours later, and a resend restarts it", () => {
	const base = { status: "pending", since: SINCE, now: NOW };
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
	assert.equal(getReminderWindow({ ...base, subscribedAt: signedUp, latestConfirmationAt: null }).open, true);
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

test("the reminder asks them to confirm, with a fresh link, and does not describe the newsletter", () => {
	const content = getConfirmationReminderContent({ name: "Taco & Tell", description: "Tacos every Thursday" });
	assert.equal(content.subject, "Reminder: confirm your subscription to Taco & Tell");
	assert.match(content.previewText, /only reminder/);
	assert.match(content.markdown, /Please confirm your subscription/);
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

	withEnv({ EMAIL_BRAND: "tacoandtell" }, () => {
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
