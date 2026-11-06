import "server-only";
import { isSendingEnabled } from "@/lib/config";
import {
	CONFIRMATION_REMINDER_AFTER_MS,
	CONFIRMATION_REMINDER_CLAIM_MS,
	CONFIRMATION_UNSENT_STATUSES,
	earliestReminderSignup,
	getReminderWindow,
	readConfirmationReminders,
	reminderClaimBlocks,
} from "@/lib/confirmation-reminder-rules";
import { connectDb } from "@/lib/db";
import { sendConfirmationReminder } from "@/lib/sending";
import Contact from "@/models/Contact";
import Message from "@/models/Message";
import Newsletter from "@/models/Newsletter";

// One pass of the hourly cron. Contacts are claimed before a message is created, and the message is unique per
// pending cycle, so two overlapping runs send once. A failed send is tried again on a later hour; a contact who
// confirmed, unsubscribed, bounced, complained or was deleted is not.
const SCAN_LIMIT = 500;
const SEND_LIMIT = 100;
const BOOKKEEPING = { timestamps: false };

function sameTime(left, right) {
	const a = new Date(left).getTime();
	const b = new Date(right).getTime();
	return Number.isFinite(a) && a === b;
}

async function latestConfirmations(accountId, contactIds) {
	const rows = await Message.aggregate([
		{
			$match: {
				accountId,
				kind: "confirmation",
				contactId: { $in: contactIds },
				status: { $nin: CONFIRMATION_UNSENT_STATUSES },
			},
		},
		{ $group: { _id: "$contactId", at: { $max: "$createdAt" } } },
	]);
	return new Map(rows.map(({ _id, at }) => [String(_id), at]));
}

async function latestConfirmationAt(accountId, contactId) {
	const message = await Message.findOne({
		accountId,
		contactId,
		kind: "confirmation",
		status: { $nin: CONFIRMATION_UNSENT_STATUSES },
	})
		.sort({ createdAt: -1 })
		.select({ createdAt: 1 })
		.lean();
	return message?.createdAt ?? null;
}

async function claim(contact, cycleAt, now) {
	const staleBefore = new Date(now.getTime() - CONFIRMATION_REMINDER_CLAIM_MS);
	const { modifiedCount } = await Contact.updateOne(
		{
			accountId: contact.accountId,
			_id: contact._id,
			status: "pending",
			subscribedAt: cycleAt,
			$or: [
				{ "confirmationReminder.cycleAt": { $ne: cycleAt } },
				{ "confirmationReminder.cycleAt": cycleAt, "confirmationReminder.state": "retry" },
				{
					"confirmationReminder.cycleAt": cycleAt,
					"confirmationReminder.state": "claimed",
					"confirmationReminder.claimedAt": { $lt: staleBefore },
				},
			],
		},
		{
			$set: {
				"confirmationReminder.cycleAt": cycleAt,
				"confirmationReminder.state": "claimed",
				"confirmationReminder.claimedAt": now,
			},
			$unset: { "confirmationReminder.messageId": "" },
		},
		BOOKKEEPING
	);
	return modifiedCount > 0;
}

// Only a claim that has not created a message yet. A sent or skipped cycle is left alone.
async function releaseClaim(contact, cycleAt) {
	await Contact.updateOne(
		{
			accountId: contact.accountId,
			_id: contact._id,
			"confirmationReminder.cycleAt": cycleAt,
			"confirmationReminder.state": "claimed",
			"confirmationReminder.messageId": { $exists: false },
		},
		{ $unset: { confirmationReminder: "" } },
		BOOKKEEPING
	);
}

async function settle(contact, cycleAt, state, messageId) {
	await Contact.updateOne(
		{
			accountId: contact.accountId,
			_id: contact._id,
			"confirmationReminder.cycleAt": cycleAt,
			"confirmationReminder.state": "claimed",
		},
		{
			$set: {
				"confirmationReminder.state": state,
				"confirmationReminder.claimedAt": new Date(),
				...(messageId && { "confirmationReminder.messageId": messageId }),
			},
		},
		BOOKKEEPING
	);
}

async function remindOne({ newsletter, contact, since, now }) {
	const cycleAt = contact.subscribedAt;
	if (!(await claim(contact, cycleAt, now))) return "busy";
	const fresh = await Contact.findOne({ accountId: contact.accountId, _id: contact._id })
		.select({ status: 1, subscribedAt: 1 })
		.lean();
	const again = getReminderWindow({
		status: fresh?.status,
		subscribedAt: fresh?.subscribedAt,
		since,
		now,
		latestConfirmationAt: await latestConfirmationAt(contact.accountId, contact._id),
	});
	if (!fresh || !sameTime(fresh.subscribedAt, cycleAt) || !again.open) {
		if (again.reason === "too soon") await releaseClaim(contact, cycleAt);
		else await settle(contact, cycleAt, "skipped");
		return again.reason === "too soon" ? "early" : "skipped";
	}
	const outcome = await sendConfirmationReminder({ newsletter, contact, cycleAt });
	if (outcome.result === "sent") {
		await settle(contact, cycleAt, "sent", outcome.messageId);
		return "sent";
	}
	if (outcome.result === "retry") {
		await settle(contact, cycleAt, outcome.reason === "queued" ? "claimed" : "retry", outcome.messageId);
		return outcome.reason === "rate limited" || outcome.reason === "account" ? "deferred" : "failed";
	}
	await settle(contact, cycleAt, "skipped", outcome.messageId);
	return "skipped";
}

async function remindNewsletter(newsletter, since, now) {
	const counts = { sent: 0, skipped: 0, failed: 0, deferred: 0 };
	const earliest = earliestReminderSignup(since, now);
	const latest = new Date(now.getTime() - CONFIRMATION_REMINDER_AFTER_MS);
	if (earliest > latest) return counts;
	const contacts = await Contact.find({
		accountId: newsletter.accountId,
		newsletterId: newsletter._id,
		status: "pending",
		subscribedAt: { $gte: earliest, $lte: latest },
	})
		.sort({ subscribedAt: -1 })
		.limit(SCAN_LIMIT)
		.select({ accountId: 1, email: 1, status: 1, subscribedAt: 1, confirmationReminder: 1 })
		.lean();
	const confirmations = contacts.length > 0 ? await latestConfirmations(newsletter.accountId, contacts.map(({ _id }) => _id)) : new Map();
	let sends = 0;
	for (const contact of contacts) {
		if (sends >= SEND_LIMIT) break;
		const window = getReminderWindow({
			status: contact.status,
			subscribedAt: contact.subscribedAt,
			since,
			now,
			latestConfirmationAt: confirmations.get(String(contact._id)) ?? null,
		});
		if (!window.open || reminderClaimBlocks(contact.confirmationReminder, window.cycleAt, now)) continue;
		let outcome;
		try {
			outcome = await remindOne({ newsletter, contact, since, now });
		} catch (error) {
			const detail = String(error.message || "");
			console.error(`[confirmation-reminder] contact ${contact._id} failed: ${detail.includes("@") ? error.name || "Error" : detail}`);
			await settle(contact, contact.subscribedAt, "retry").catch(() => {});
			counts.failed++;
			continue;
		}
		if (outcome === "sent") {
			counts.sent++;
			sends++;
		} else if (outcome === "failed") counts.failed++;
		else if (outcome === "deferred") {
			counts.deferred++;
			break;
		} else if (outcome === "skipped") counts.skipped++;
	}
	return counts;
}

const IDLE = { enabled: 0, sent: 0, skipped: 0, failed: 0, deferred: 0 };

// The hourly cron. With the variable unset this does not read contacts and does not send.
export async function queueConfirmationReminders({ now = new Date(), env = process.env } = {}) {
	const rules = readConfirmationReminders(env);
	if (rules.size === 0) return IDLE;
	if (!isSendingEnabled()) return { ...IDLE, inactive: "sending off" };
	await connectDb();
	await Message.init();
	const newsletters = await Newsletter.find({ slug: { $in: [...rules.keys()] }, requireConfirmation: true })
		.setOptions({ crossAccount: true })
		.lean();
	const totals = { enabled: newsletters.length, sent: 0, skipped: 0, failed: 0, deferred: 0 };
	for (const newsletter of newsletters) {
		const counts = await remindNewsletter(newsletter, rules.get(newsletter.slug), now);
		for (const key of ["sent", "skipped", "failed", "deferred"]) totals[key] += counts[key];
	}
	return totals;
}
