import { getAppUrl, isCloud } from "./config.js";
import { getNewsletterPagePath } from "./newsletters.js";
import { createSummaryShareToken, createSummarySettingsToken } from "./summary-token.js";

export function getSummarySettingsPath(token) {
	return `/summary/${token}`;
}

// Where a newsletter's summary email links go. newsletter: what lib/summary-data.js summarizeNewsletter says about it.
// Share links only exist on MailCheap Cloud, whose site renders their page, and only for a period someone joined in:
// there's nothing to show off otherwise.
export function createSummaryEmailLinks({ account, newsletter, period, now = new Date() }) {
	const appUrl = getAppUrl();
	const settingsToken = createSummarySettingsToken({ accountId: account._id, newsletterId: newsletter.id }, now.getTime());
	const shareToken =
		isCloud() && newsletter.subscribers.joined > 0
			? createSummaryShareToken({
					name: newsletter.name,
					joined: newsletter.subscribers.joined,
					total: newsletter.subscribers.total,
					frequency: period.frequency,
					lastKey: period.lastKey,
				})
			: null;
	return {
		appUrl,
		logoUrl: `${appUrl}/icon-192.png`,
		dashboardUrl: `${appUrl}${getNewsletterPagePath(newsletter.id, "/")}`,
		campaignUrl: newsletter.issue ? `${appUrl}/campaigns/${newsletter.issue.id}` : null,
		settingsUrl: `${appUrl}${getSummarySettingsPath(settingsToken)}`,
		oneClickUrl: `${appUrl}/api/summary/unsubscribe?token=${settingsToken}`,
		shareUrl: shareToken ? `${appUrl}/share/${shareToken}` : null,
	};
}
