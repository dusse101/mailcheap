import "server-only";
import { sendAlert } from "@/lib/alerts";
import { getAccountPlan, isPaidStatus } from "@/lib/plans";

export const CUSTOMER_BLOCKED_KIND = "customer-blocked";
// Signup and test emails fail again with each one, and the hourly check finds the same block every hour: a newsletter's
// alert is emailed once a day. A campaign pauses once, so each pause is. Telegram has its own 6 hours (lib/alerts.js).
const NEWSLETTER_COOLDOWN_MINUTES = 24 * 60;

function domainOf(email) {
	return String(email ?? "").split("@")[1] ?? "";
}

// A customer with a plan whose emails the email provider refuses, which nothing on their dashboard lifts: one alert per
// campaign it paused, and one per newsletter whose signup or test emails it refuses, or whose domain it suspended or
// holds. Telegram and the admins' email hear of each, and Needs a look lists them first, in red (lib/admin-stats.js).
// why: what the provider does. what: what it stops. Never a reader's address: the provider's answers can quote one.
export async function alertCustomerBlocked({ account, newsletter, campaignId, why, what, action }) {
	const plan = getAccountPlan(account)?.name;
	await sendAlert({
		accountId: null,
		key: `customer-blocked:${campaignId ?? newsletter._id}`,
		title: `${isPaidStatus(account?.subscriptionStatus) ? "A paying customer" : "A customer"} can't send`,
		detail: `${newsletter.name} (${domainOf(newsletter.fromEmail)}${plan ? `, ${plan} plan` : ""}): ${why}. ${what}`,
		action,
		path: campaignId ? `/admin/campaigns/${campaignId}` : `/admin/newsletters/${newsletter._id}`,
		...(!campaignId && { cooldownMinutes: NEWSLETTER_COOLDOWN_MINUTES }),
	});
}
