import { NEWSLETTER_SLUG_PATTERN } from "./newsletter-settings.js";

// One automatic reminder for a pending double opt-in, then stop. Off unless CONFIRMATION_REMINDERS names the
// newsletter. The hourly cron (app/api/cron/hourly) is the only sender. There is no backfill job.
//
// Activation, all of it, on a later deployment (nothing here turns it on):
// 1. CONFIRMATION_REMINDERS is a JSON object of newsletter slug to an ISO-8601 time, the moment it was turned on:
//    {"taco-and-tell":"2026-11-06T15:00:00.000Z"}
//    Unset, empty, invalid JSON, or a value that is not a date: that newsletter stays off.
// 2. Set the time to when you turn it on, not earlier. Contacts whose current signup (subscribedAt) is before it
//    are never reminded. A future time simply waits.
// 3. SENDING_ENABLED must be "true". While sending is off the cron records nothing and sends nothing.
// 4. The newsletter asks new subscribers to confirm (requireConfirmation). Others are ignored.
// 5. The existing hourly cron must be running with CRON_SECRET. No second scheduler.
//
// People already pending at activation get nothing. A since set in the past still does not mail the old list:
// a reminder is sent only while it is due (24 hours after the later of that signup and the latest confirmation
// email that actually went out or is still queued) and for the following 48 hours. After that it is skipped,
// not saved up. There is no switch that catches up history.
export const CONFIRMATION_REMINDER_KIND = "confirmation-reminder";
export const CONFIRMATION_REMINDER_AFTER_HOURS = 24;
export const CONFIRMATION_REMINDER_GRACE_HOURS = 48;
const HOUR_MS = 60 * 60 * 1000;
export const CONFIRMATION_REMINDER_AFTER_MS = CONFIRMATION_REMINDER_AFTER_HOURS * HOUR_MS;
export const CONFIRMATION_REMINDER_GRACE_MS = CONFIRMATION_REMINDER_GRACE_HOURS * HOUR_MS;
// A resend of the confirmation email restarts the wait. The signup itself can be this much older than the wait
// and still be found; older signups are left, so a late resend cannot drag a backlog with it.
export const CONFIRMATION_REMINDER_LOOKBACK_MS =
	CONFIRMATION_REMINDER_AFTER_MS + CONFIRMATION_REMINDER_GRACE_MS + CONFIRMATION_REMINDER_AFTER_MS;
// A run that dies after claiming a contact can be taken over once this passes. The send itself claims the
// message, so a second run cannot deliver it twice.
export const CONFIRMATION_REMINDER_CLAIM_MS = 15 * 60 * 1000;

// A confirmation that never went out does not delay the reminder. A queued one still does: it may be on its way.
export const CONFIRMATION_UNSENT_STATUSES = ["failed", "suppressed", "skipped"];

function time(value) {
	if (value == null) return null;
	const at = new Date(value).getTime();
	return Number.isFinite(at) ? at : null;
}

// slug -> Date. A newsletter missing from the map is off, including every newsletter when the variable is unset.
export function readConfirmationReminders(env = process.env) {
	const raw = env.CONFIRMATION_REMINDERS;
	if (raw == null || String(raw).trim() === "") return new Map();
	let parsed;
	try {
		parsed = JSON.parse(String(raw));
	} catch {
		console.error("[confirmation-reminder] CONFIRMATION_REMINDERS is not valid JSON; reminders stay off");
		return new Map();
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		console.error("[confirmation-reminder] CONFIRMATION_REMINDERS must be a JSON object of slug to since; reminders stay off");
		return new Map();
	}
	const rules = new Map();
	for (const [key, value] of Object.entries(parsed)) {
		const slug = String(key).trim().toLowerCase();
		if (!NEWSLETTER_SLUG_PATTERN.test(slug)) {
			console.error("[confirmation-reminder] ignoring a key that is not a newsletter slug");
			continue;
		}
		if (typeof value !== "string") {
			console.error(`[confirmation-reminder] ignoring ${slug}: since must be an ISO date`);
			continue;
		}
		const since = time(value);
		if (since == null) {
			console.error(`[confirmation-reminder] ignoring ${slug}: since is not a date`);
			continue;
		}
		rules.set(slug, new Date(since));
	}
	return rules;
}

// Whether this pending cycle should be reminded at now. latestConfirmationAt is the newest confirmation email
// that went out or is still queued; one that failed, was suppressed or was skipped does not count, so a dead
// link does not push the reminder back. Null when they never got one.
export function getReminderWindow({ status, subscribedAt, since, now, latestConfirmationAt = null }) {
	if (status !== "pending") return { open: false, reason: "not pending" };
	const cycleMs = time(subscribedAt);
	const sinceMs = time(since);
	const nowMs = time(now);
	if (cycleMs == null || sinceMs == null || nowMs == null) return { open: false, reason: "invalid" };
	if (cycleMs < sinceMs) return { open: false, reason: "before activation" };
	const lastMs = latestConfirmationAt == null ? null : time(latestConfirmationAt);
	if (latestConfirmationAt != null && lastMs == null) return { open: false, reason: "invalid" };
	const dueAt = Math.max(cycleMs, lastMs ?? 0) + CONFIRMATION_REMINDER_AFTER_MS;
	if (nowMs < dueAt) return { open: false, reason: "too soon" };
	if (nowMs >= dueAt + CONFIRMATION_REMINDER_GRACE_MS) return { open: false, reason: "too late" };
	return { open: true, cycleAt: new Date(cycleMs) };
}

// True when this cycle already has its reminder, or another run claimed it moments ago.
export function reminderClaimBlocks(reminder, cycleAt, now) {
	const cycleMs = time(cycleAt);
	if (!reminder || time(reminder.cycleAt) !== cycleMs) return false;
	if (reminder.state === "sent" || reminder.state === "skipped") return true;
	if (reminder.state === "claimed") {
		const claimed = time(reminder.claimedAt);
		if (claimed == null) return true;
		return time(now) - claimed < CONFIRMATION_REMINDER_CLAIM_MS;
	}
	return false;
}

export function earliestReminderSignup(since, now) {
	return new Date(Math.max(time(since), time(now) - CONFIRMATION_REMINDER_LOOKBACK_MS));
}
