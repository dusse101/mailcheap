import "server-only";
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
	isSummaryEligible,
	parseSummaryKey,
} from "@/lib/summary";
import { buildSummary } from "@/lib/summary-data";
import { renderSummaryEmail } from "@/lib/summary-email";
import { createSummaryEmailLinks } from "@/lib/summary-links";
import { DEFAULT_TIME_ZONE, resolveTimeZone } from "@/lib/time-zone";
import Account from "@/models/Account";

// A job that waits this long, after QStash retries or an outage, has missed its morning: it's dropped, not sent late.
const STALE_MS = 18 * 60 * 60 * 1000;

function getTimeZone(account) {
	return resolveTimeZone(account?.summary?.timeZone ?? DEFAULT_TIME_ZONE);
}

// The hourly cron: one job per account whose summary is due this hour in its owner's timezone and hasn't gone out.
export async function queueDueSummaries({ now = new Date() } = {}) {
	if (!isCloud()) return { queued: 0 };
	await connectDb();
	const accounts = await Account.find(
		{
			subscriptionStatus: { $in: PAID_SUBSCRIPTION_STATUSES },
			status: { $ne: "paused" },
			"deletion.requestedAt": { $exists: false },
			"summary.frequency": { $ne: "off" },
		},
		{ summary: 1, subscriptionStatus: 1, status: 1, deletion: 1 }
	).lean();

	let queued = 0;
	let failed = 0;
	for (const account of accounts) {
		const due = getDueSummary({ frequency: getSummaryFrequency(account), timeZone: getTimeZone(account), now });
		if (!due || account.summary?.lastSentKey === due.key || !isSummaryEligible(account)) continue;
		try {
			await publishJob({
				url: `${getAppUrl()}/api/jobs/send-summary`,
				body: { accountId: String(account._id), key: due.key },
				deduplicationId: `summary-${account._id}-${due.key.replace(":", "-")}`,
			});
			queued++;
		} catch {
			failed++;
		}
	}
	return { queued, ...(failed && { failed }) };
}

async function renderFor({ account, period, summary, now }) {
	const links = createSummaryEmailLinks({ account, summary, period, now });
	return renderSummaryEmail({
		frequency: period.frequency,
		period,
		newsletters: summary.newsletters.map((newsletter) => ({ ...newsletter, url: links.newsletterUrl(newsletter.id) })),
		links,
		postalAddress: siteExtensions.defaultPostalAddress,
	});
}

// Claimed before it goes out, so a second delivery of the same job sends nothing; given back if sending fails, so
// QStash's retry sends it.
async function claim(account, key, now) {
	const { modifiedCount } = await Account.updateOne(
		{ _id: account._id, "summary.lastSentKey": { $ne: key } },
		{ $set: { "summary.lastSentKey": key, "summary.lastSentAt": now } }
	);
	return modifiedCount > 0;
}

async function release(account, key) {
	const previous = account.summary?.lastSentKey;
	const change = previous ? { $set: { "summary.lastSentKey": previous } } : { $unset: { "summary.lastSentKey": "", "summary.lastSentAt": "" } };
	await Account.updateOne({ _id: account._id, "summary.lastSentKey": key }, change);
}

// The job: checks again that the account still gets this summary, then sends it once. A daily summary with nothing to
// say is skipped.
export async function sendSummary({ accountId, key, now = new Date() }) {
	const parsed = parseSummaryKey(key);
	if (!parsed) return { skipped: "invalid" };
	await connectDb();
	const account = await Account.findById(accountId).lean();
	if (!account || !isSummaryEligible(account)) return { skipped: "not_eligible" };
	if (getSummaryFrequency(account) !== parsed.frequency) return { skipped: "frequency_changed" };
	if (account.summary?.lastSentKey === key) return { skipped: "sent" };
	const period = getSummaryPeriod({ ...parsed, timeZone: getTimeZone(account) });
	if (now.getTime() - period.end.getTime() > STALE_MS || now < period.end) return { skipped: "stale" };
	if (!(await claim(account, key, now))) return { skipped: "sent" };

	try {
		const summary = await buildSummary({ account, period, now });
		if (!summary) return { skipped: "no_newsletter" };
		if (period.frequency === "daily" && summary.isQuiet) return { skipped: "quiet" };
		const to = await findOwnerEmail(account._id);
		if (!to) return { skipped: "no_owner" };
		const email = await renderFor({ account, period, summary, now });
		await sendPlatformEmail({ to, subject: email.subject, text: email.text, html: email.html, headers: email.headers });
		return { sent: true };
	} catch (error) {
		await release(account, key);
		throw error;
	}
}

// What the account page previews: the latest whole day or week, as its summary would show it. Off previews the weekly.
export async function previewSummary({ account, now = new Date() }) {
	const frequency = getSummaryFrequency(account);
	const period = getLatestSummaryPeriod({ frequency: frequency === "off" ? "weekly" : frequency, timeZone: getTimeZone(account), now });
	const summary = await buildSummary({ account, period, now });
	if (!summary) return null;
	return renderFor({ account, period, summary, now });
}

export async function saveSummaryFrequency(accountId, frequency, { timeZone } = {}) {
	if (!SUMMARY_FREQUENCIES.includes(frequency)) return false;
	const zone = timeZone ? resolveTimeZone(timeZone) : null;
	await connectDb();
	await Account.updateOne(
		{ _id: accountId },
		{ $set: { "summary.frequency": frequency, ...(zone && { "summary.timeZone": zone }) } }
	);
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
