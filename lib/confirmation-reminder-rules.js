import { NEWSLETTER_SLUG_PATTERN } from "./newsletter-settings.js";

// One automatic reminder for a pending double opt-in, then stop. Off unless CONFIRMATION_REMINDERS names the
// newsletter. The hourly cron (app/api/cron/hourly) is the only sender.
//
// Activation, all of it, on a later deployment (nothing here turns it on):
// 1. CONFIRMATION_REMINDERS is a JSON object of newsletter slug to an ISO-8601 time with a timezone, the moment it was
//    turned on: {"taco-and-tell":"2026-11-06T15:00:00.000Z"}
//    Unset, empty, invalid JSON, or a value that is not such a time: that newsletter stays off.
// 2. Set the time to when you turn it on, not earlier. Contacts whose current signup (subscribedAt) is before it
//    are not reminded by this path. A future time simply waits.
// 3. SENDING_ENABLED must be "true". While sending is off the cron records nothing and sends nothing.
// 4. The newsletter asks new subscribers to confirm (requireConfirmation). Others are ignored.
// 5. The existing hourly cron must be running with CRON_SECRET. No second scheduler.
//
// A reminder is sent only while it is due (24 hours after the later of that signup and the latest confirmation email
// that went out or is still young in the queue) and for the following 48 hours. After that it is skipped, not saved
// up. The lookback below wins over that window: a resend late in a signup's life leaves it a shorter one, or none.
// Someone who never got a confirmation email gets no reminder: it would be the first email the address ever saw.
//
// People already pending are only reached by the separate, finite pass CONFIRMATION_REMINDER_BACKFILL
// (readConfirmationReminderBackfill below), which only counts them unless it says exactly "send".
export const CONFIRMATION_REMINDER_KIND = "confirmation-reminder";
export const CONFIRMATION_REMINDER_AFTER_HOURS = 24;
export const CONFIRMATION_REMINDER_GRACE_HOURS = 48;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const CONFIRMATION_REMINDER_AFTER_MS = CONFIRMATION_REMINDER_AFTER_HOURS * HOUR_MS;
export const CONFIRMATION_REMINDER_GRACE_MS = CONFIRMATION_REMINDER_GRACE_HOURS * HOUR_MS;
// A resend of the confirmation email restarts the wait. The signup itself can be this much older than the wait
// and still be found; older signups are left, so a late resend cannot drag a backlog with it.
export const CONFIRMATION_REMINDER_LOOKBACK_MS =
	CONFIRMATION_REMINDER_AFTER_MS + CONFIRMATION_REMINDER_GRACE_MS + CONFIRMATION_REMINDER_AFTER_MS;
// A run that dies after claiming a contact can be taken over once this passes. The send itself claims the
// message, so a second run cannot deliver it twice.
export const CONFIRMATION_REMINDER_CLAIM_MS = 15 * 60 * 1000;
// Failed sends of one reminder before it is skipped for good.
export const CONFIRMATION_REMINDER_MAX_ATTEMPTS = 3;

// A confirmation that never went out does not delay the reminder. A queued one still does while it is young: it may
// be on its way. Older than this, it counts as never sent.
export const CONFIRMATION_UNSENT_STATUSES = ["failed", "suppressed", "skipped"];
export const CONFIRMATION_QUEUED_YOUNG_MS = HOUR_MS;

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function time(value) {
	if (value == null) return null;
	const at = new Date(value).getTime();
	return Number.isFinite(at) ? at : null;
}

// A value that merely passes new Date(), like "1", is a date in 2001.
function strictTime(value) {
	return typeof value === "string" && ISO_WITH_ZONE.test(value) ? time(value) : null;
}

function readSlugMap(raw, name) {
	if (raw == null || String(raw).trim() === "") return [];
	let parsed;
	try {
		parsed = JSON.parse(String(raw));
	} catch {
		console.error(`[confirmation-reminder] ${name} is not valid JSON; it stays off`);
		return [];
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		console.error(`[confirmation-reminder] ${name} must be a JSON object keyed by newsletter slug; it stays off`);
		return [];
	}
	const entries = [];
	for (const [key, value] of Object.entries(parsed)) {
		const slug = String(key).trim().toLowerCase();
		if (!NEWSLETTER_SLUG_PATTERN.test(slug)) {
			console.error(`[confirmation-reminder] ${name}: ignoring a key that is not a newsletter slug`);
			continue;
		}
		entries.push([slug, value]);
	}
	return entries;
}

// slug -> Date. A newsletter missing from the map is off, including every newsletter when the variable is unset.
export function readConfirmationReminders(env = process.env) {
	const rules = new Map();
	for (const [slug, value] of readSlugMap(env.CONFIRMATION_REMINDERS, "CONFIRMATION_REMINDERS")) {
		const since = strictTime(value);
		if (since == null) {
			console.error(`[confirmation-reminder] ignoring ${slug}: since must be an ISO-8601 time with a timezone`);
			continue;
		}
		rules.set(slug, new Date(since));
	}
	return rules;
}

// Whether this pending cycle should be reminded at now. latestConfirmationAt is the newest confirmation email that
// went out or is young in the queue (latestConfirmationMatch); null when there is none, and then nothing is sent.
export function getReminderWindow({ status, subscribedAt, since, now, latestConfirmationAt = null }) {
	if (status !== "pending") return { open: false, reason: "not pending" };
	const cycleMs = time(subscribedAt);
	const sinceMs = time(since);
	const nowMs = time(now);
	if (cycleMs == null || sinceMs == null || nowMs == null) return { open: false, reason: "invalid" };
	if (cycleMs < sinceMs) return { open: false, reason: "before activation" };
	if (latestConfirmationAt == null) return { open: false, reason: "no confirmation sent" };
	const lastMs = time(latestConfirmationAt);
	if (lastMs == null) return { open: false, reason: "invalid" };
	const dueAt = Math.max(cycleMs, lastMs) + CONFIRMATION_REMINDER_AFTER_MS;
	if (nowMs < dueAt) return { open: false, reason: "too soon" };
	if (nowMs >= dueAt + CONFIRMATION_REMINDER_GRACE_MS) return { open: false, reason: "too late" };
	return { open: true, cycleAt: new Date(cycleMs) };
}

// The confirmation emails that count, for a query: sent, or queued and young. A queued one alone never makes a contact
// eligible, since it is under an hour old and the wait is a day.
export function latestConfirmationMatch(now) {
	return {
		kind: "confirmation",
		status: { $nin: CONFIRMATION_UNSENT_STATUSES },
		$or: [{ sentAt: { $ne: null } }, { status: "queued", createdAt: { $gte: new Date(time(now) - CONFIRMATION_QUEUED_YOUNG_MS) } }],
	};
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

// The finite pass for people already pending: CONFIRMATION_REMINDER_BACKFILL, a JSON object of newsletter slug to
//   { "mode": "dry-run", "before": "<ISO time>", "maxAgeDays": 30, "maxTotal": 0, "perRun": 10, "expiresAt": "<ISO time>" }
// mode is a dry run unless it is exactly "send". A dry run only counts: no claims, no messages, no writes, with sending
// on or off, and it reports totals, never addresses. A pass that sends takes a past before, so the group can't grow,
// an expiresAt and a maxTotal it stops at for good. Nothing here turns it on.
//
// What it can't see: before the unsubscribe fix, a pending reader who clicked Unsubscribe left no trace, so nothing can
// exclude them. maxAgeDays limits that exposure. Weigh it before ever setting "send".
export const BACKFILL_DEFAULTS = { maxAgeDays: 30, maxTotal: 0, perRun: 10 };
export const BACKFILL_MAX_AGE_DAYS = 90;
export const BACKFILL_MAX_PER_RUN = 25;
// Reminded this recently, in any cycle: left alone.
export const BACKFILL_REMINDED_WITHIN_MS = 90 * DAY_MS;
// Halts: one complaint, or this share of bounces once there are enough to mean something.
export const BACKFILL_MAX_BOUNCE_RATE = 0.05;
export const BACKFILL_MIN_BOUNCES = 3;
export const BACKFILL_COUNTERS = ["tooOld", "tooRecent", "noConfirmationSent", "accountSuppressed", "neverEmail", "alreadyReminded"];
export const BACKFILL_AGE_BUCKETS = [
	["1-3d", 3],
	["4-7d", 7],
	["8-14d", 14],
	["15-30d", 30],
	["31d+", Infinity],
];

function wholeNumber(value, fallback, { min, max }) {
	if (value === undefined) return fallback;
	return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function readBackfillRule(slug, value) {
	const problem = (what) => {
		console.error(`[confirmation-reminder] ignoring the backfill for ${slug}: ${what}`);
		return null;
	};
	if (!value || typeof value !== "object" || Array.isArray(value)) return problem("it must be an object");
	const before = strictTime(value.before);
	if (before == null) return problem("before must be an ISO-8601 time with a timezone");
	const maxAgeDays = wholeNumber(value.maxAgeDays, BACKFILL_DEFAULTS.maxAgeDays, { min: 1, max: BACKFILL_MAX_AGE_DAYS });
	if (maxAgeDays == null) return problem(`maxAgeDays must be a whole number from 1 to ${BACKFILL_MAX_AGE_DAYS}`);
	const maxTotal = wholeNumber(value.maxTotal, BACKFILL_DEFAULTS.maxTotal, { min: 0, max: Number.MAX_SAFE_INTEGER });
	if (maxTotal == null) return problem("maxTotal must be a whole number");
	const perRun = wholeNumber(value.perRun, BACKFILL_DEFAULTS.perRun, { min: 1, max: BACKFILL_MAX_PER_RUN });
	if (perRun == null) return problem(`perRun must be a whole number from 1 to ${BACKFILL_MAX_PER_RUN}`);
	const expiresAt = value.expiresAt === undefined ? null : strictTime(value.expiresAt);
	if (value.expiresAt !== undefined && expiresAt == null) return problem("expiresAt must be an ISO-8601 time with a timezone");
	return {
		mode: value.mode === "send" ? "send" : "dry-run",
		before: new Date(before),
		maxAgeDays,
		maxTotal,
		perRun,
		expiresAt: expiresAt == null ? null : new Date(expiresAt),
	};
}

// slug -> rule. Unset, empty or invalid: no backfill.
export function readConfirmationReminderBackfill(env = process.env) {
	const rules = new Map();
	for (const [slug, value] of readSlugMap(env.CONFIRMATION_REMINDER_BACKFILL, "CONFIRMATION_REMINDER_BACKFILL")) {
		const rule = readBackfillRule(slug, value);
		if (rule) rules.set(slug, rule);
	}
	return rules;
}

// Why a pass may not send at all, whatever the contacts look like. Null when it may.
export function backfillSendProblem(rule, now) {
	if (time(rule.before) > time(now)) return "before is in the future, so the group could still grow";
	if (!rule.expiresAt) return "send needs an expiresAt";
	if (rule.maxTotal < 1) return "send needs a maxTotal";
	return null;
}

export function backfillIsExpired(rule, now) {
	return Boolean(rule.expiresAt) && time(now) >= time(rule.expiresAt);
}

// The reminders this pass has already sent told it to stop: a complaint, or too many bounces.
export function backfillHaltReason({ sent = 0, bounced = 0, complained = 0 }) {
	if (complained > 0) return "complaint";
	if (bounced >= BACKFILL_MIN_BOUNCES && bounced > sent * BACKFILL_MAX_BOUNCE_RATE) return "bounces";
	return null;
}

// "eligible", or the BACKFILL_COUNTERS entry that excludes this contact. latestSentAt is the newest confirmation with
// sentAt; latestConfirmationAt also takes a young queued one, which delays a reminder without earning one. cycleFinished:
// this signup already has a reminder that went out or was given up on. lastReminderAt: the newest reminder that went
// out, in any cycle.
export function classifyBackfillContact({
	subscribedAt,
	rule,
	now,
	latestSentAt = null,
	latestConfirmationAt = null,
	cycleFinished = false,
	lastReminderAt = null,
	accountSuppressed = false,
	neverEmail = false,
}) {
	const nowMs = time(now);
	const cycleMs = time(subscribedAt);
	if (cycleMs == null || cycleMs >= time(rule.before)) return "notInGroup";
	if (nowMs - cycleMs > rule.maxAgeDays * DAY_MS) return "tooOld";
	if (cycleFinished || (lastReminderAt != null && nowMs - time(lastReminderAt) < BACKFILL_REMINDED_WITHIN_MS)) return "alreadyReminded";
	if (accountSuppressed) return "accountSuppressed";
	if (neverEmail) return "neverEmail";
	if (latestSentAt == null) return "noConfirmationSent";
	if (nowMs < Math.max(cycleMs, time(latestConfirmationAt ?? latestSentAt)) + CONFIRMATION_REMINDER_AFTER_MS) return "tooRecent";
	return "eligible";
}

export function backfillAgeBucket(subscribedAt, now) {
	const days = Math.floor((time(now) - time(subscribedAt)) / DAY_MS);
	return BACKFILL_AGE_BUCKETS.find(([, upTo]) => days <= upTo)[0];
}
