import "server-only";
import { CONFIRMATION_REMINDER_CLAIM_MS, latestConfirmationMatch } from "@/lib/confirmation-reminder-rules";
import { sendConfirmationReminder } from "@/lib/sending";
import Contact from "@/models/Contact";
import Message from "@/models/Message";

// What the new-signup path and the backfill share. Contacts are claimed before a message is created, and the message is
// unique per pending cycle, so two overlapping runs send once. A failed send is tried again on a later run, a few times
// at most; a contact who confirmed, unsubscribed, bounced, complained or was deleted is not.
const STOP_AFTER_FAILURES = 3;
const BOOKKEEPING = { timestamps: false };

function sameTime(left, right) {
	const a = new Date(left).getTime();
	const b = new Date(right).getTime();
	return Number.isFinite(a) && a === b;
}

// contactId -> { latestAt, latestSentAt }, for the confirmation emails that count. A contact with none isn't in the map.
export async function latestConfirmations(accountId, contactIds, now) {
	const rows = await Message.aggregate([
		{ $match: { accountId, contactId: { $in: contactIds }, ...latestConfirmationMatch(now) } },
		{
			$group: {
				_id: "$contactId",
				latestAt: { $max: "$createdAt" },
				latestSentAt: { $max: { $cond: [{ $gt: ["$sentAt", null] }, "$createdAt", null] } },
			},
		},
	]);
	return new Map(rows.map(({ _id, latestAt, latestSentAt }) => [String(_id), { latestAt, latestSentAt }]));
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

// recheck({ contact, confirmation }): null when the reminder may go, else why not. "not yet" keeps the cycle open for a
// later run. Anything else ends it.
async function remindOne({ newsletter, contact, recheck, now }) {
	const cycleAt = contact.subscribedAt;
	if (!(await claim(contact, cycleAt, now))) return "busy";
	const fresh = await Contact.findOne({ accountId: contact.accountId, _id: contact._id })
		.select({ status: 1, subscribedAt: 1 })
		.lean();
	const confirmations = await latestConfirmations(contact.accountId, [contact._id], now);
	const blocked =
		!fresh || !sameTime(fresh.subscribedAt, cycleAt) ? "gone" : recheck({ contact: fresh, confirmation: confirmations.get(String(contact._id)) });
	if (blocked === "not yet") {
		await releaseClaim(contact, cycleAt);
		return "early";
	}
	if (blocked) {
		await settle(contact, cycleAt, "skipped");
		return "skipped";
	}
	const outcome = await sendConfirmationReminder({ newsletter, contact, cycleAt });
	if (outcome.result === "sent") {
		await settle(contact, cycleAt, "sent", outcome.messageId);
		return outcome.already ? "alreadySent" : "sent";
	}
	if (outcome.result === "retry") {
		if (outcome.gaveUp) {
			await settle(contact, cycleAt, "skipped", outcome.messageId);
			return "failed";
		}
		await settle(contact, cycleAt, outcome.reason === "queued" ? "claimed" : "retry", outcome.messageId);
		return outcome.reason === "failed" || outcome.reason === "unknown" ? "failed" : "deferred";
	}
	await settle(contact, cycleAt, "skipped", outcome.messageId);
	return "skipped";
}

// One pass over contacts that looked due. limit counts provider attempts, not just sends, so an outage can't use more
// than a sent run would. A throttle or a refusal ends it at once, and so do a few failures in a row: the next run tries
// again. run.deadline is shared by everything the cron run does.
export async function remindContacts({ newsletter, contacts, limit, recheck, now, run, counts }) {
	let attempts = 0;
	let failures = 0;
	for (const contact of contacts) {
		if (attempts >= limit) break;
		if (Date.now() >= run.deadline) {
			counts.stopped = "time budget";
			break;
		}
		let outcome;
		try {
			outcome = await remindOne({ newsletter, contact, recheck, now });
		} catch (error) {
			const detail = String(error.message || "");
			console.error(`[confirmation-reminder] contact ${contact._id} failed: ${detail.includes("@") ? error.name || "Error" : detail}`);
			await settle(contact, contact.subscribedAt, "retry").catch(() => {});
			outcome = "failed";
		}
		if (outcome === "alreadySent" || outcome === "skipped") counts[outcome]++;
		if (outcome === "sent" || outcome === "failed" || outcome === "deferred") {
			attempts++;
			counts[outcome]++;
		}
		if (outcome === "sent") failures = 0;
		if (outcome === "deferred") {
			counts.stopped = "throttled";
			break;
		}
		if (outcome === "failed" && ++failures >= STOP_AFTER_FAILURES) {
			counts.stopped = "failures";
			break;
		}
	}
}
