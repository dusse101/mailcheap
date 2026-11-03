import "server-only";
import { hasActiveSubscription, isBlocked } from "@/lib/account-state";
import { sendAlert } from "@/lib/alerts";
import { getEmailProviderId } from "@/lib/config";
import { alertCustomerBlocked } from "@/lib/customer-blocks";
import { connectDb } from "@/lib/db";
import { isEmailProviderConfigured } from "@/lib/email-provider";
import { getHeldTenantIds, getTeamStatusAlerts } from "@/lib/email-provider/postshiba-rules";
import { getTeamStatus, listSendingDomains } from "@/lib/postshiba";
import Account from "@/models/Account";
import Newsletter from "@/models/Newsletter";

// The same problem found every hour is emailed once a day; Telegram has its own 6 hours (lib/alerts.js).
const COOLDOWN_MINUTES = 24 * 60;
// A key or team id PostShiba doesn't take. An outage or a slow answer waits for the next hour.
const REFUSALS = new Set([401, 403, 404]);
// A domain's suspended_reason is quoted only when it's a code like paused: free text could name someone.
const REASON_CODE = /^[a-z_]{1,40}$/;

async function findHeldAccounts(tenantIds) {
	if (tenantIds.length === 0) return new Map();
	const accounts = await Account.find({ "postshiba.tenantId": { $in: tenantIds } }).select({ "postshiba.tenantId": 1 }).lean();
	return new Map(accounts.map((account) => [account.postshiba.tenantId, String(account._id)]));
}

// A sending domain PostShiba suspended or holds that a newsletter of a customer with a plan sends from: everything it
// sends from there is refused before its owner even tries, so the admins hear of it every day until it's lifted. A
// blocked account is an alert of its own. The keys of the alerts it raised.
async function alertBlockedDomains() {
	const blocked = (await listSendingDomains()).filter((domain) => domain.suspended || domain.operator_held);
	if (blocked.length === 0) return [];
	const accounts = (await Account.find({ "postshiba.tenantId": { $in: blocked.map((domain) => domain.tenant_id) } }).lean()).filter(
		(account) => !isBlocked(account) && hasActiveSubscription(account)
	);
	const newsletters = await Newsletter.find({ accountId: { $in: accounts.map(({ _id }) => _id) } })
		.select({ accountId: 1, name: 1, fromEmail: 1 })
		.setOptions({ crossAccount: true })
		.lean();
	const keys = [];
	for (const domain of blocked) {
		const account = accounts.find(({ postshiba }) => postshiba?.tenantId === domain.tenant_id);
		const name = String(domain.name ?? "").toLowerCase();
		const reason = REASON_CODE.test(domain.suspended_reason ?? "") ? domain.suspended_reason : null;
		const sending = newsletters.filter((newsletter) => String(newsletter.accountId) === String(account?._id) && newsletter.fromEmail?.endsWith(`@${name}`));
		for (const newsletter of sending) {
			await alertCustomerBlocked({
				account,
				newsletter,
				why: domain.operator_held ? `PostShiba's abuse team holds ${name} (operator_hold)` : `PostShiba suspended ${name}${reason ? ` (${reason})` : ""}`,
				what: "Its campaigns pause and its signup and test emails fail until it's lifted.",
				action: domain.operator_held
					? "Ask PostShiba's support why it's held."
					: "Resume the domain at PostShiba once it's safe to send from, or ask the owner to send from another domain.",
			});
			keys.push(`customer-blocked:${newsletter._id}`);
		}
	}
	return keys;
}

// Hourly (app/api/cron/hourly): what PostShiba says stops MailCheap's sends right now, as alerts for the admins.
export async function checkPostshibaStatus() {
	if (getEmailProviderId() !== "postshiba" || !isEmailProviderConfigured()) return { skipped: "PostShiba isn't the email provider" };
	let status;
	try {
		status = await getTeamStatus();
	} catch (error) {
		if (REFUSALS.has(error.status)) {
			await sendAlert({
				accountId: null,
				key: "postshiba-status-refused",
				title: "PostShiba refused the status check",
				detail: `${error.message}.`,
				action: "Check POSTSHIBA_API_KEY and POSTSHIBA_TEAM_ID: every send needs them too.",
				link: "https://app.postshiba.com",
				cooldownMinutes: COOLDOWN_MINUTES,
			});
		}
		return { failed: error.message };
	}
	await connectDb();
	const alerts = getTeamStatusAlerts(status, await findHeldAccounts(getHeldTenantIds(status)));
	for (const alert of alerts) await sendAlert({ accountId: null, cooldownMinutes: COOLDOWN_MINUTES, ...alert });
	const blockedDomains = await alertBlockedDomains().catch((error) => {
		console.error("[postshiba] The sending domains' check failed:", error.message);
		return [];
	});
	return { alerts: [...alerts.map(({ key }) => key), ...blockedDomains] };
}
