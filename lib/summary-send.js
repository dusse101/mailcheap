import "server-only";
import { scoped } from "@/lib/account-scope";
import { PAID_SUBSCRIPTION_STATUSES } from "@/lib/plans";
import { findOwnerEmail } from "@/lib/accounts";
import { getAppUrl, isCloud } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { sendPlatformEmail } from "@/lib/platform-email";
import { publishJob } from "@/lib/sending";
import { siteExtensions } from "@/lib/site-extensions";
import {
	SUMMARY_FREQUENCIES,
	getDueSummary,
	getLatestSummaryPeriod,
	getSummaryFrequency,
	getSummaryPeriod,
	isQuietSummary,
	isSummaryEligible,
	parseSummaryKey,
} from "@/lib/summary";
import { summarizeNewsletter } from "@/lib/summary-data";
import { renderSummaryEmail } from "@/lib/summary-email";
import { createSummaryEmailLinks } from "@/lib/summary-links";
import { DEFAULT_TIME_ZONE, resolveTimeZone } from "@/lib/time-zone";
import Account from "@/models/Account";
import Newsletter from "@/models/Newsletter";

// A job that waits this long, after QStash retries or an outage, has missed its morning: it's dropped, not sent late.
const STALE_MS = 18 * 60 * 60 * 1000;
const SCHEDULES = SUMMARY_FREQUENCIES.filter((frequency) => frequency !== "off");
// The send marker is bookkeeping: it leaves the newsletter's updatedAt, which says when its settings changed, alone.
const BOOKKEEPING = { timestamps: false };

function getTimeZone(account) {
	return resolveTimeZone(account?.summary?.timeZone ?? DEFAULT_TIME_ZONE);
}

// The summaries due this hour for each eligible account, in its owner's timezone: { daily, weekly }, each a period or null.
function findDuePeriods(accounts, now) {
	const due = new Map();
	for (const account of accounts) {
		if (!isSummaryEligible(account)) continue;
		const periods = Object.fromEntries(SCHEDULES.map((frequency) => [frequency, getDueSummary({ frequency, timeZone: getTimeZone(account), now })]));
		if (SCHEDULES.some((frequency) => periods[frequency])) due.set(String(account._id), periods);
	}
	return due;
}

// The hourly cron: one job per newsletter whose summary is due this hour in its owner's timezone and hasn't gone out.
export async function queueDueSummaries({ now = new Date() } = {}) {
	if (!isCloud()) return { queued: 0 };
	await connectDb();
	const accounts = await Account.find(
		{ subscriptionStatus: { $in: PAID_SUBSCRIPTION_STATUSES }, status: { $ne: "paused" }, "deletion.requestedAt": { $exists: false } },
		{ summary: 1, subscriptionStatus: 1, status: 1, deletion: 1 }
	).lean();
	const due = findDuePeriods(accounts, now);
	if (due.size === 0) return { queued: 0 };
	const newsletters = await Newsletter.find(
		{ accountId: { $in: [...due.keys()] }, "notifications.summary": { $ne: "off" } },
		{ accountId: 1, notifications: 1, summarySent: 1 }
	)
		.setOptions({ crossAccount: true })
		.lean();

	let queued = 0;
	let failed = 0;
	for (const newsletter of newsletters) {
		const period = due.get(String(newsletter.accountId))?.[getSummaryFrequency(newsletter)];
		if (!period || newsletter.summarySent?.key === period.key) continue;
		try {
			await publishJob({
				url: `${getAppUrl()}/api/jobs/send-summary`,
				body: { newsletterId: String(newsletter._id), key: period.key },
				deduplicationId: `summary-${newsletter._id}-${period.key.replace(":", "-")}`,
			});
			queued++;
		} catch {
			failed++;
		}
	}
	return { queued, ...(failed && { failed }) };
}

function renderFor({ account, period, summary, now }) {
	return renderSummaryEmail({
		frequency: period.frequency,
		period,
		newsletter: summary,
		links: createSummaryEmailLinks({ account, newsletter: summary, period, now }),
		postalAddress: siteExtensions.defaultPostalAddress,
	});
}

// Claimed before it goes out, so a second delivery of the same job sends nothing; given back if sending fails, so
// QStash's retry sends it.
async function claim(newsletter, key, now) {
	const { modifiedCount } = await Newsletter.updateOne(
		{ accountId: newsletter.accountId, _id: newsletter._id, "summarySent.key": { $ne: key } },
		{ $set: { "summarySent.key": key, "summarySent.at": now } },
		BOOKKEEPING
	);
	return modifiedCount > 0;
}

async function release(newsletter, key) {
	const previous = newsletter.summarySent;
	const change = previous?.key ? { $set: { summarySent: previous } } : { $unset: { summarySent: "" } };
	await Newsletter.updateOne({ accountId: newsletter.accountId, _id: newsletter._id, "summarySent.key": key }, change, BOOKKEEPING);
}

// The job: checks again that the newsletter's owner still gets this summary, then sends it once. A daily summary with
// nothing to say is skipped.
export async function sendSummary({ newsletterId, key, now = new Date() }) {
	const parsed = parseSummaryKey(key);
	if (!parsed) return { skipped: "invalid" };
	await connectDb();
	const newsletter = await Newsletter.findOne({ _id: newsletterId }, { name: 1, accountId: 1, notifications: 1, summarySent: 1 })
		.setOptions({ crossAccount: true })
		.lean();
	if (!newsletter) return { skipped: "no_newsletter" };
	const account = await Account.findById(newsletter.accountId).lean();
	if (!account || !isSummaryEligible(account)) return { skipped: "not_eligible" };
	if (getSummaryFrequency(newsletter) !== parsed.frequency) return { skipped: "frequency_changed" };
	if (newsletter.summarySent?.key === key) return { skipped: "sent" };
	const period = getSummaryPeriod({ ...parsed, timeZone: getTimeZone(account) });
	if (now.getTime() - period.end.getTime() > STALE_MS || now < period.end) return { skipped: "stale" };
	if (!(await claim(newsletter, key, now))) return { skipped: "sent" };

	try {
		const summary = await summarizeNewsletter({ account, newsletter, period, now });
		if (period.frequency === "daily" && isQuietSummary(summary)) return { skipped: "quiet" };
		const to = await findOwnerEmail(account._id);
		if (!to) return { skipped: "no_owner" };
		const email = renderFor({ account, period, summary, now });
		await sendPlatformEmail({ to, subject: email.subject, text: email.text, html: email.html, headers: email.headers });
		return { sent: true };
	} catch (error) {
		await release(newsletter, key);
		throw error;
	}
}

// What the newsletter's notifications page previews: the latest whole day or week, as its summary would show it. Off
// previews the weekly.
export async function previewSummary({ account, newsletter, now = new Date() }) {
	const frequency = getSummaryFrequency(newsletter);
	const period = getLatestSummaryPeriod({ frequency: frequency === "off" ? "weekly" : frequency, timeZone: getTimeZone(account), now });
	return renderFor({ account, period, summary: await summarizeNewsletter({ account, newsletter, period, now }), now });
}

// From the summary's own links, which work without signing in: the token named the newsletter and its account. The
// dashboard and the API save it with the newsletter's other settings (update_newsletter).
export async function saveSummaryFrequency({ accountId, newsletterId, frequency }) {
	if (!SUMMARY_FREQUENCIES.includes(frequency)) return false;
	await connectDb();
	await Newsletter.updateOne(scoped(accountId, { _id: newsletterId }), { $set: { "notifications.summary": frequency } });
	return true;
}

// The owner's browser timezone (the dashboard's tz cookie), kept for the hourly cron, which has no browser to ask.
export async function rememberTimeZone(account, value) {
	if (!isCloud() || !value) return;
	const timeZone = resolveTimeZone(value);
	if (timeZone === account?.summary?.timeZone || (timeZone === DEFAULT_TIME_ZONE && value !== DEFAULT_TIME_ZONE)) return;
	await connectDb();
	await Account.updateOne({ _id: account._id }, { $set: { "summary.timeZone": timeZone } });
}
