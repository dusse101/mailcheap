import "server-only";
import { scoped } from "@/lib/account-scope";
import { getCampaignComparison } from "@/lib/campaign-report";
import { getSubscriberHistory } from "@/lib/overview-data";
import { reachedOf } from "@/lib/report-stats";
import { getSummaryLine, isQuietSummary, summarizeSubscribers } from "@/lib/summary";
import Campaign from "@/models/Campaign";
import CampaignLink from "@/models/CampaignLink";
import Contact from "@/models/Contact";
import Newsletter from "@/models/Newsletter";

const DAY_MS = 24 * 60 * 60 * 1000;
// A weekly summary shows the newsletter's latest issue from this far back; a daily one only an issue sent that day.
const LATEST_ISSUE_DAYS = 30;
// Imports write the unsubscribe time as they create the contact: those left before MailCheap (lib/overview-data.js).
const IMPORT_WINDOW_MS = 60_000;

function countUnsubscribed({ accountId, newsletterId, from, to }) {
	return Contact.countDocuments({
		accountId,
		newsletterId,
		status: "unsubscribed",
		unsubscribedAt: { $gte: from, $lt: to },
		$expr: { $gt: ["$unsubscribedAt", { $add: ["$createdAt", IMPORT_WINDOW_MS] }] },
	});
}

async function findIssue({ account, newsletterId, period, now }) {
	const since = period.frequency === "daily" ? period.start : new Date(period.end.getTime() - LATEST_ISSUE_DAYS * DAY_MS);
	const campaign = await Campaign.findOne(
		{ accountId: account._id, newsletterId, status: { $in: ["sent", "sending"] }, startedAt: { $gte: since, $lt: period.end } },
		{ accountId: 1, newsletterId: 1, subject: 1, startedAt: 1, stats: 1 }
	)
		.sort({ startedAt: -1 })
		.lean();
	if (!campaign) return null;
	const [comparison, topLink] = await Promise.all([
		getCampaignComparison(campaign, { now }),
		CampaignLink.findOne({ accountId: account._id, campaignId: campaign._id, clickers: { $gt: 0 } }, { url: 1, clickers: 1 })
			.sort({ clickers: -1, clicks: -1 })
			.lean(),
	]);
	return {
		id: String(campaign._id),
		subject: campaign.subject,
		startedAt: campaign.startedAt,
		isInPeriod: campaign.startedAt >= period.start,
		reached: reachedOf(campaign.stats),
		opened: campaign.stats?.opened ?? 0,
		clicked: campaign.stats?.clicked ?? 0,
		isSettled: Boolean(comparison?.isSettled),
		comparison: comparison ? { opened: comparison.delta.opened, clicked: comparison.delta.clicked, issues: comparison.issues } : null,
		topLink: topLink ? { url: topLink.url, clickers: topLink.clickers } : null,
	};
}

// One newsletter over the period: what the summary email and the get_summary action show.
export async function summarizeNewsletter({ account, newsletter, period, now = new Date() }) {
	const accountId = account._id;
	const newsletterId = newsletter._id;
	const [history, unsubscribed, previousUnsubscribed, issue] = await Promise.all([
		// Its days up to the period's last one: "today" for getSubscriberHistory is the day before the summary goes out.
		getSubscriberHistory({ accountId, newsletterId, timeZone: period.timeZone, now: new Date(period.end.getTime() - 1) }),
		countUnsubscribed({ accountId, newsletterId, from: period.start, to: period.end }),
		countUnsubscribed({ accountId, newsletterId, from: period.previousStart, to: period.start }),
		findIssue({ account, newsletterId, period, now }),
	]);
	const subscribers = summarizeSubscribers([...history.previous, ...history.current], period.frequency);
	return {
		id: String(newsletterId),
		name: newsletter.name,
		subscribers,
		unsubscribed,
		previousUnsubscribed,
		issue,
		line: getSummaryLine({ frequency: period.frequency, subscribers, issue }),
	};
}

// Each of the account's newsletters over the period, the one with the most subscribers first. Null without a newsletter.
export async function buildSummary({ account, period, now = new Date() }) {
	const newsletters = await Newsletter.find(scoped(account, {}), { name: 1 }).sort({ createdAt: 1 }).lean();
	if (!newsletters.length) return null;
	const summaries = await Promise.all(newsletters.map((newsletter) => summarizeNewsletter({ account, newsletter, period, now })));
	summaries.sort((a, b) => b.subscribers.total - a.subscribers.total);
	return { newsletters: summaries, isQuiet: isQuietSummary(summaries) };
}
