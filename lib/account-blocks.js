import "server-only";
import { BLOCKED_BY, ERROR_CODES, getUnblockHint, isBlocked } from "@/lib/account-state";
import { sendAlert } from "@/lib/alerts";
import { connectDb } from "@/lib/db";
import { siteExtensions } from "@/lib/site-extensions";
import { resumeTenant, suspendTenantQuietly } from "@/lib/tenants";
import Account from "@/models/Account";
import Campaign from "@/models/Campaign";

export const BLOCKED_CAMPAIGN_REASON = "the account is blocked";

// Every block, whatever set it off, reaches the admins and the owner at once: no cooldown, and the block's time in
// the key makes each one an alert of its own. An admin's own block only shows on the admin page.
async function alertBlock(accountId, { reason, by, detail, at }) {
	const why = [reason, detail].filter(Boolean).join(". ") || "no reason given";
	await Promise.all([
		sendAlert({
			accountId: null,
			key: `${by === "admin" ? "account-blocked-by-admin" : "account-blocked"}:${accountId}:${at.getTime()}`,
			title: "Account blocked",
			detail: `Account ${accountId}, blocked by ${BLOCKED_BY[by] ?? by}: ${why}.`,
			action: "Review it on the admin page, and unblock it once it's sorted out.",
			path: "/admin",
			cooldownMinutes: 0,
		}),
		sendAlert({
			accountId,
			key: "account-blocked",
			title: "Account blocked",
			detail: `${reason ? `${reason}. ` : ""}Nothing is sent from this account, welcome emails included, and imports and changes are off. ${getUnblockHint()}`,
			path: siteExtensions.supportChatPath ?? "/",
			cooldownMinutes: 0,
			isUrgent: true,
		}),
	]);
}

// Spam signals stop the whole account at once: every newsletter's sends, welcome and confirmation emails, imports,
// new contacts and every change but stopping things (lib/actions/run-action.js), its tracked links (app/c) and its
// tenant at the provider.
// Nothing lifts it but an admin (unblockAccount). reason: what the owner reads. detail: for the admins only, like a
// provider's own answer. True when this call blocked it.
export async function blockAccount(accountId, { reason, by = "admin", detail } = {}) {
	await connectDb();
	const pausedAt = new Date();
	const { modifiedCount } = await Account.updateOne(
		{ _id: accountId, status: { $ne: "paused" } },
		{ $set: { status: "paused", pausedAt, pauseReason: reason || undefined, pausedBy: by } }
	);
	if (modifiedCount === 0) return false;
	await Campaign.updateMany(
		{ accountId, status: "sending" },
		{ $set: { status: "paused", pauseReason: BLOCKED_CAMPAIGN_REASON, pauseCode: ERROR_CODES.accountBlocked } }
	);
	await suspendTenantQuietly(accountId);
	await alertBlock(accountId, { reason, by, detail, at: pausedAt });
	return true;
}

// From the admin page only. The provider lifts its own pause on the tenant first, and throws while it holds it
// (PostShiba's operator_hold), so a provider's hold waits for the provider too. True when this call unblocked it.
export async function unblockAccount(accountId) {
	await connectDb();
	const account = await Account.findById(accountId).select({ status: 1 }).lean();
	if (!isBlocked(account)) return false;
	await resumeTenant(accountId);
	const { modifiedCount } = await Account.updateOne(
		{ _id: accountId, status: "paused" },
		{ $set: { status: "active", unblockedAt: new Date() }, $unset: { pausedAt: 1, pauseReason: 1, pausedBy: 1 } }
	);
	return modifiedCount > 0;
}
