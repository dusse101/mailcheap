import ListAttentionItems from "@/components/ListAttentionItems";
import { describeBlocker } from "@/lib/account-state";
import { ALERT_OCCURRENCES_KEPT } from "@/lib/alert-rules";

// What may need a look (lib/admin-stats.js listAttention): blocked accounts, customers' paused campaigns, then the alerts
// of the last 7 days, each newest first. Each opens its details, and can be dismissed until it happens again.
export default function ListAttention({ attention, now }) {
	const items = [
		...attention.blockedAccounts.map(describeBlocked),
		...attention.pausedCampaigns.map(describePaused),
		...attention.alerts.map(describeAlert),
	];
	const dismissed = attention.dismissed.map((item) => ({
		...(item.kind === "account" ? describeBlocked(item) : item.kind === "campaign" ? describePaused(item) : describeAlert(item)),
		dismissedAt: item.dismissedAt,
		dismissedBy: item.dismissedBy,
	}));
	return <ListAttentionItems items={items} dismissed={dismissed} now={now} />;
}

function describeBlocked(account) {
	return {
		kind: "account",
		id: account.id,
		icon: "blocked",
		title: account.ownerEmail ?? "Unknown owner",
		detail: `Blocked by ${describeBlocker(account.by)}${account.reason ? `: ${account.reason}` : ""}`,
		at: account.at,
	};
}

function describePaused(campaign) {
	return {
		kind: "campaign",
		id: campaign.id,
		icon: "paused",
		title: campaign.subject || "Untitled",
		detail: [campaign.ownerEmail, campaign.reason].filter(Boolean).join(" · "),
		at: campaign.at,
	};
}

// Counted from the occurrences kept, so the cap reads as at least that.
function describeTimes(count) {
	if (!(count > 1)) return null;
	return count >= ALERT_OCCURRENCES_KEPT ? `${ALERT_OCCURRENCES_KEPT}+ times this week` : `${count} times this week`;
}

function describeAlert(alert) {
	return {
		kind: "alert",
		id: alert.id,
		icon: "alert",
		title: alert.title,
		detail: [alert.ownerEmail, describeTimes(alert.timesThisWeek)].filter(Boolean).join(" · "),
		at: alert.at,
	};
}
