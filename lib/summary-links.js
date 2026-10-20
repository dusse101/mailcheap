import { getAppUrl, isCloud } from "./config.js";
import { getNewsletterPagePath } from "./newsletters.js";
import { createSummaryShareToken, createSummarySettingsToken } from "./summary-token.js";

export function getSummarySettingsPath(token) {
	return `/summary/${token}`;
}

// Where the summary email's links go. Share links only exist on MailCheap Cloud, whose site renders their page, and only
// for a period someone joined in: there's nothing to show off otherwise.
export function createSummaryEmailLinks({ account, summary, period, now = new Date() }) {
	const appUrl = getAppUrl();
	const settingsToken = createSummarySettingsToken(account._id, now.getTime());
	const [main] = summary.newsletters;
	const shareToken =
		isCloud() && main.subscribers.joined > 0
			? createSummaryShareToken({
					name: main.name,
					joined: main.subscribers.joined,
					total: main.subscribers.total,
					frequency: period.frequency,
					lastKey: period.lastKey,
				})
			: null;
	return {
		appUrl,
		logoUrl: `${appUrl}/icon-192.png`,
		dashboardUrl: `${appUrl}${getNewsletterPagePath(main.id, "/")}`,
		newsletterUrl: (id) => `${appUrl}${getNewsletterPagePath(id, "/")}`,
		campaignUrl: main.issue ? `${appUrl}/campaigns/${main.issue.id}` : null,
		settingsUrl: `${appUrl}${getSummarySettingsPath(settingsToken)}`,
		oneClickUrl: `${appUrl}/api/summary/unsubscribe?token=${settingsToken}`,
		shareUrl: shareToken ? `${appUrl}/share/${shareToken}` : null,
	};
}
