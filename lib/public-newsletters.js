import "server-only";
import { ACCESS_FIELDS, hasActiveSubscription, isBlocked } from "@/lib/account-state";
import { getSignupScale } from "@/lib/plans";
import Account from "@/models/Account";
import Newsletter from "@/models/Newsletter";

// Signup forms and email links find a newsletter by its public slug or a signed id, whatever the account.
export function findNewsletterAnywhere(filter) {
	return Newsletter.findOne(filter).setOptions({ crossAccount: true }).lean();
}

async function findWithAccount(filter) {
	const newsletter = await findNewsletterAnywhere(filter);
	if (!newsletter) return {};
	const account = await Account.findById(newsletter.accountId).select({ ...ACCESS_FIELDS, status: 1, plan: 1 }).lean();
	return { newsletter, account };
}

// A canceled account's newsletters take no signups until it subscribes again.
export async function findOpenNewsletter(filter) {
	const { newsletter, account } = await findWithAccount(filter);
	return newsletter && hasActiveSubscription(account) ? newsletter : null;
}

// New signups also wait while the account is blocked; its archive stays online and pending readers can confirm.
// signupScale: how much its account's plan raises the limits on signups (lib/plans.js getSignupScale).
export async function findSignupNewsletterWithScale(filter) {
	const { newsletter, account } = await findWithAccount(filter);
	if (!newsletter || !hasActiveSubscription(account) || isBlocked(account)) return null;
	return { newsletter, signupScale: getSignupScale(account) };
}

export async function findSignupNewsletter(filter) {
	return (await findSignupNewsletterWithScale(filter))?.newsletter ?? null;
}
