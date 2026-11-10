import "server-only";
import { isSendingEnabled } from "@/lib/config";
import {
	BACKFILL_AGE_BUCKETS,
	BACKFILL_COUNTERS,
	CONFIRMATION_REMINDER_KIND,
	backfillAgeBucket,
	backfillHaltReason,
	backfillIsExpired,
	backfillSendProblem,
	classifyBackfillContact,
} from "@/lib/confirmation-reminder-rules";
import { latestConfirmations, remindContacts } from "@/lib/confirmation-reminder-send";
import { findGloballySuppressed } from "@/lib/global-suppressions";
import { readSignupAccount } from "@/lib/sending";
import Contact from "@/models/Contact";
import Message from "@/models/Message";
import Suppression from "@/models/Suppression";

// The finite pass for people already pending (the rules are in lib/confirmation-reminder-rules.js). A dry run only reads:
// it claims nothing, creates nothing, works with sending off and answers totals, never addresses.
const DAY_MS = 24 * 60 * 60 * 1000;
const SCAN_LIMIT = 5000;
const REMINDER_RETRYING = ["queued", "failed"];

function pendingInGroup(newsletter, rule) {
	return { accountId: newsletter.accountId, newsletterId: newsletter._id, status: "pending", subscribedAt: { $lt: rule.before } };
}

async function readRemindersByContact(accountId, contactIds) {
	const messages = await Message.find({ accountId, kind: CONFIRMATION_REMINDER_KIND, contactId: { $in: contactIds } })
		.select({ contactId: 1, cycleAt: 1, status: 1, sentAt: 1, createdAt: 1 })
		.lean();
	const byContact = new Map();
	for (const message of messages) {
		const key = String(message.contactId);
		byContact.set(key, [...(byContact.get(key) ?? []), message]);
	}
	return byContact;
}

function readReminderHistory(contact, messages = []) {
	const cycleMs = new Date(contact.subscribedAt).getTime();
	const reminder = contact.confirmationReminder;
	const stateFinished =
		reminder && new Date(reminder.cycleAt).getTime() === cycleMs && (reminder.state === "sent" || reminder.state === "skipped");
	const messageFinished = messages.some(
		({ cycleAt, status, sentAt }) => new Date(cycleAt).getTime() === cycleMs && (sentAt || !REMINDER_RETRYING.includes(status))
	);
	const wentOut = messages.filter(({ sentAt }) => sentAt).map(({ createdAt }) => new Date(createdAt).getTime());
	return { cycleFinished: Boolean(stateFinished || messageFinished), lastReminderAt: wentOut.length > 0 ? new Date(Math.max(...wentOut)) : null };
}

// Every pending contact in the group, sorted into who could be reminded and why the others can't. Reads only.
async function surveyGroup(newsletter, rule, now) {
	const { accountId } = newsletter;
	const oldest = new Date(now.getTime() - rule.maxAgeDays * DAY_MS);
	const group = pendingInGroup(newsletter, rule);
	const [tooOld, contacts] = await Promise.all([
		Contact.countDocuments({ ...group, subscribedAt: { $lt: rule.before < oldest ? rule.before : oldest } }),
		Contact.find({ ...group, subscribedAt: { $lt: rule.before, $gte: oldest } })
			.sort({ subscribedAt: -1 })
			.limit(SCAN_LIMIT + 1)
			.select({ accountId: 1, email: 1, status: 1, subscribedAt: 1, confirmationReminder: 1 })
			.lean(),
	]);
	const truncated = contacts.length > SCAN_LIMIT;
	const scanned = contacts.slice(0, SCAN_LIMIT);
	const ids = scanned.map(({ _id }) => _id);
	const emails = scanned.map(({ email }) => email);
	const [confirmations, reminders, suppressed, neverEmail] = await Promise.all([
		latestConfirmations(accountId, ids, now),
		readRemindersByContact(accountId, ids),
		Suppression.distinct("email", { accountId, email: { $in: emails } }),
		findGloballySuppressed(emails),
	]);
	const accountSuppressed = new Set(suppressed);

	const excluded = Object.fromEntries(BACKFILL_COUNTERS.map((counter) => [counter, 0]));
	excluded.tooOld = tooOld;
	const ageBuckets = Object.fromEntries(BACKFILL_AGE_BUCKETS.map(([label]) => [label, 0]));
	const eligible = [];
	for (const contact of scanned) {
		const confirmation = confirmations.get(String(contact._id));
		const verdict = classifyBackfillContact({
			subscribedAt: contact.subscribedAt,
			rule,
			now,
			latestSentAt: confirmation?.latestSentAt,
			latestConfirmationAt: confirmation?.latestAt,
			accountSuppressed: accountSuppressed.has(contact.email),
			neverEmail: neverEmail.has(contact.email),
			...readReminderHistory(contact, reminders.get(String(contact._id))),
		});
		if (verdict === "eligible") {
			eligible.push(contact);
			ageBuckets[backfillAgeBucket(contact.subscribedAt, now)]++;
		} else if (verdict in excluded) excluded[verdict]++;
	}
	return { eligible, ageBuckets, excluded, truncated };
}

// A reminder counts as this pass's when its signup is from before the group's line, so no new field is needed, and a
// finished pass stays finished after a restart.
async function readPassTotals(newsletter, rule) {
	const rows = await Message.aggregate([
		{
			$match: {
				accountId: newsletter.accountId,
				newsletterId: newsletter._id,
				kind: CONFIRMATION_REMINDER_KIND,
				cycleAt: { $lt: rule.before },
			},
		},
		{
			$group: {
				_id: null,
				sent: { $sum: { $cond: [{ $gt: ["$sentAt", null] }, 1, 0] } },
				claimedWithoutSentAt: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "sent"] }, { $lte: ["$sentAt", null] }] }, 1, 0] } },
				bounced: { $sum: { $cond: [{ $eq: ["$status", "bounced"] }, 1, 0] } },
				complained: { $sum: { $cond: [{ $eq: ["$status", "complained"] }, 1, 0] } },
			},
		},
	]);
	const totals = rows[0] ?? { sent: 0, claimedWithoutSentAt: 0, bounced: 0, complained: 0 };
	// A claim whose process died may have gone out: it uses up the budget either way.
	return { ...totals, spent: totals.sent + totals.claimedWithoutSentAt };
}

async function runDry(newsletter, rule, now) {
	const [{ eligible, ageBuckets, excluded, truncated }, { problem }] = await Promise.all([surveyGroup(newsletter, rule, now), readSignupAccount(newsletter)]);
	return { mode: "dry-run", eligible: eligible.length, ageBuckets, excluded, ...(truncated && { truncated: true }), ...(problem && { accountProblem: problem }) };
}

async function runSend({ newsletter, rule, now, run, sendLimit }) {
	const refuse = (state, reason, extra = {}) => {
		console.warn(`[confirmation-reminder] backfill for ${newsletter.slug}: ${state}, ${reason}`);
		return { mode: "send", state, reason, ...extra };
	};
	const problem = backfillSendProblem(rule, now);
	if (problem) return refuse("refused", problem);
	if (!isSendingEnabled()) return { mode: "send", state: "inactive", reason: "sending off" };

	const pass = await readPassTotals(newsletter, rule);
	const progress = { sentSoFar: pass.sent, maxTotal: rule.maxTotal };
	if (backfillIsExpired(rule, now)) return refuse("complete", "expired", progress);
	if (pass.spent >= rule.maxTotal) return refuse("complete", "maxTotal reached", progress);
	const halt = backfillHaltReason(pass);
	if (halt) return refuse("halted", halt, progress);

	const { eligible, ageBuckets, excluded, truncated } = await surveyGroup(newsletter, rule, now);
	const counted = { eligible: eligible.length, ageBuckets, excluded, ...progress };
	if (truncated) return refuse("refused", "too many pending contacts to count", counted);
	// Both numbers are what someone reviewed: more than that means the group isn't what was approved.
	if (pass.spent + eligible.length > rule.maxTotal) return refuse("refused", "more eligible than maxTotal", counted);
	if (eligible.length === 0) return { mode: "send", state: excluded.tooRecent > 0 ? "waiting" : "complete", ...counted };

	const counts = { sent: 0, skipped: 0, failed: 0, deferred: 0, alreadySent: 0 };
	await remindContacts({
		newsletter,
		contacts: eligible,
		limit: Math.min(rule.perRun, sendLimit, rule.maxTotal - pass.spent),
		now,
		run,
		counts,
		recheck: ({ contact, confirmation }) => {
			if (contact.status !== "pending") return "not pending";
			const verdict = classifyBackfillContact({
				subscribedAt: contact.subscribedAt,
				rule,
				now,
				latestSentAt: confirmation?.latestSentAt,
				latestConfirmationAt: confirmation?.latestAt,
			});
			if (verdict === "eligible") return null;
			return verdict === "tooRecent" || verdict === "noConfirmationSent" ? "not yet" : verdict;
		},
	});
	return { mode: "send", state: "running", ...counted, ...counts };
}

export function runBackfill({ newsletter, rule, now, run, sendLimit }) {
	return rule.mode === "send" ? runSend({ newsletter, rule, now, run, sendLimit }) : runDry(newsletter, rule, now);
}
