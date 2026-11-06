import "server-only";
import { isSendingEnabled } from "@/lib/config";
import { runBackfill } from "@/lib/confirmation-reminder-backfill";
import {
	CONFIRMATION_REMINDER_AFTER_MS,
	earliestReminderSignup,
	getReminderWindow,
	readConfirmationReminderBackfill,
	readConfirmationReminders,
	reminderClaimBlocks,
} from "@/lib/confirmation-reminder-rules";
import { latestConfirmations, remindContacts } from "@/lib/confirmation-reminder-send";
import { connectDb } from "@/lib/db";
import Contact from "@/models/Contact";
import Message from "@/models/Message";
import Newsletter from "@/models/Newsletter";

// The daily route's confirmation reminders: an error here is reported and not thrown, and the time it can take is well
// under the route's 60 seconds. A run cut short loses nothing while the window is open: claims time out and the next
// day's run carries on.
const SCAN_LIMIT = 500;
const SEND_LIMIT = 25;
const RUN_BUDGET_MS = 30_000;
const COUNTERS = ["sent", "skipped", "failed", "deferred", "alreadySent", "noConfirmationSent"];
const IDLE = { enabled: 0, ...Object.fromEntries(COUNTERS.map((counter) => [counter, 0])) };

async function remindNewsletter({ newsletter, since, now, run, totals }) {
	const earliest = earliestReminderSignup(since, now);
	const latest = new Date(now.getTime() - CONFIRMATION_REMINDER_AFTER_MS);
	if (earliest > latest) return;
	const contacts = await Contact.find({
		accountId: newsletter.accountId,
		newsletterId: newsletter._id,
		status: "pending",
		subscribedAt: { $gte: earliest, $lte: latest },
		// Finished cycles would otherwise fill the scan.
		$expr: {
			$not: {
				$and: [{ $eq: ["$confirmationReminder.cycleAt", "$subscribedAt"] }, { $in: ["$confirmationReminder.state", ["sent", "skipped"]] }],
			},
		},
	})
		.sort({ subscribedAt: -1 })
		.limit(SCAN_LIMIT)
		.select({ accountId: 1, email: 1, status: 1, subscribedAt: 1, confirmationReminder: 1 })
		.lean();
	if (contacts.length === 0) return;
	const confirmations = await latestConfirmations(newsletter.accountId, contacts.map(({ _id }) => _id), now);
	const windowOf = (contact, confirmation) =>
		getReminderWindow({ status: contact.status, subscribedAt: contact.subscribedAt, since, now, latestConfirmationAt: confirmation?.latestAt ?? null });
	const due = contacts.filter((contact) => {
		const window = windowOf(contact, confirmations.get(String(contact._id)));
		if (window.reason === "no confirmation sent") totals.noConfirmationSent++;
		return window.open && !reminderClaimBlocks(contact.confirmationReminder, window.cycleAt, now);
	});
	await remindContacts({
		newsletter,
		contacts: due,
		limit: SEND_LIMIT,
		now,
		run,
		counts: totals,
		recheck: ({ contact, confirmation }) => {
			const window = windowOf(contact, confirmation);
			if (window.open) return null;
			return window.reason === "too soon" || window.reason === "no confirmation sent" ? "not yet" : window.reason;
		},
	});
}

async function runAll({ rules, backfill, now, run, totals }) {
	await connectDb();
	const sending = isSendingEnabled();
	if (!sending && rules.size > 0) totals.inactive = "sending off";
	if (rules.size > 0 && sending) {
		await Message.init();
		const newsletters = await Newsletter.find({ slug: { $in: [...rules.keys()] }, requireConfirmation: true })
			.setOptions({ crossAccount: true })
			.lean();
		totals.enabled = newsletters.length;
		for (const newsletter of newsletters) {
			if (totals.stopped) break;
			await remindNewsletter({ newsletter, since: rules.get(newsletter.slug), now, run, totals });
		}
	}
	if (backfill.size === 0) return;
	totals.backfill = {};
	const newsletters = await Newsletter.find({ slug: { $in: [...backfill.keys()] }, requireConfirmation: true })
		.setOptions({ crossAccount: true })
		.lean();
	for (const newsletter of newsletters) {
		const rule = backfill.get(newsletter.slug);
		// What just stopped the new signups' reminders would stop these too.
		if (rule.mode === "send" && totals.stopped) {
			totals.backfill[newsletter.slug] = { mode: "send", state: "waiting", reason: totals.stopped };
			continue;
		}
		if (rule.mode === "send" && sending) await Message.init();
		totals.backfill[newsletter.slug] = await runBackfill({ newsletter, rule, now, run, sendLimit: SEND_LIMIT });
	}
}

// The daily route. With both variables unset this does not read contacts and does not send.
export async function queueConfirmationReminders({ now = new Date(), env = process.env, budgetMs = RUN_BUDGET_MS } = {}) {
	const rules = readConfirmationReminders(env);
	const backfill = readConfirmationReminderBackfill(env);
	if (rules.size === 0 && backfill.size === 0) return { ...IDLE };
	if (backfill.size === 0 && !isSendingEnabled()) return { ...IDLE, inactive: "sending off" };

	const totals = { ...IDLE };
	const run = { deadline: Date.now() + budgetMs };
	let timer;
	const outOfTime = new Promise((resolve) => {
		timer = setTimeout(() => {
			totals.stopped ??= "time budget";
			resolve();
		}, budgetMs);
	});
	try {
		await Promise.race([runAll({ rules, backfill, now, run, totals }), outOfTime]);
	} catch (error) {
		const detail = String(error?.message || "");
		console.error(`[confirmation-reminder] The run failed: ${detail.includes("@") ? error?.name || "Error" : detail}`);
		totals.error = error?.name || "Error";
	} finally {
		clearTimeout(timer);
	}
	return totals;
}
