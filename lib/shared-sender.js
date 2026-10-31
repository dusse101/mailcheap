import "server-only";
import { hasActiveSubscription } from "@/lib/account-state";
import { sendAlert } from "@/lib/alerts";
import { getArchiveCnameTarget, getSharedDomain } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { removeAtProvider } from "@/lib/domains";
import { getEmailProvider, getProvider } from "@/lib/email-provider";
import { isReservedSlug } from "@/lib/reserved-slugs";
import { publishSharedRecords, removeSharedRecords } from "@/lib/dns-broker";
import { getSharedSendingDomain, isOnSharedDomain } from "@/lib/sender-rules";
import Newsletter from "@/models/Newsletter";

// A newsletter on the shared address sends from hello@<slug>.SHARED_DOMAIN: a sending domain in its account's
// tenant at the email provider (a domain belongs to one tenant), with its DNS records published on SHARED_DOMAIN
// by the DNS helper. It follows the slug, like the archive at <slug>.SHARED_DOMAIN.
const CHECK_EVERY_MS = 60_000;
// Where websites' hosts point on Vercel, when ARCHIVE_CNAME_TARGET isn't set.
const DEFAULT_WEB_TARGET = "cname.vercel-dns.com";
// The DNS helper itself failing (lib/dns-broker.js): one alert for all the shared addresses waiting for it.
const DNS_HELPER_ALERTS = {
	cap: {
		title: "DNS helper at its daily cap",
		action: "New shared addresses wait until its oldest records are a day old. Raise the cap if it's real growth.",
	},
	down: {
		title: "DNS helper failing",
		action: "No shared address can be set up: check the helper's logs, its Vercel token and DNS_BROKER_SECRET.",
	},
};

function isRecent(date) {
	return Boolean(date) && Date.now() - new Date(date).getTime() < CHECK_EVERY_MS;
}

// The provider's records, and one for the subdomain itself: with records under it, a wildcard on the shared
// domain no longer answers for it, and its archive and links have to keep resolving.
function getRecords(domain, status) {
	return [...status.records, { purpose: "web", type: "CNAME", name: domain, value: getArchiveCnameTarget() ?? DEFAULT_WEB_TARGET }];
}

// The slug the records were published for, which may not be the newsletter's any longer.
function getRecordSlug(sharedSender) {
	return sharedSender.domain.split(".")[0];
}

async function unpublish(sharedSender) {
	await removeSharedRecords(getRecordSlug(sharedSender), sharedSender.dnsRecordIds).catch((error) =>
		console.error(`[shared-sender] ${sharedSender.domain}'s DNS records stay: ${error.message}`)
	);
}

// Without the DNS helper nothing is published: fine in development, where nothing verifies anyway. In
// production it's an error, so the subdomain is set up again once the helper is there.
async function publish(slug, records) {
	const { ids, skipped } = await publishSharedRecords(slug, records);
	if (skipped && process.env.NODE_ENV === "production") throw new Error(`the DNS helper isn't set up, so ${slug}'s records can't be published`);
	return ids ?? [];
}

// A domain whose records weren't published, or weren't saved on the newsletter, is taken back: nothing would remove
// it later, and it would keep the slug's shared address from whoever takes the slug next.
async function create({ account, newsletter, zone, provider }) {
	const domain = getSharedSendingDomain(newsletter.slug, zone);
	const { providerDomainId = null, status: created } = await provider.addDomain({ account, domain });
	const added = { domain, provider: provider.id, providerDomainId };
	let dnsRecordIds = [];
	try {
		const status = created ?? (await provider.readDomain({ account, domain: added }));
		if (status.error || status.missing) throw new Error(`${provider.name} didn't return ${domain}'s records: ${status.error ?? "not found"}`);
		dnsRecordIds = await publish(newsletter.slug, getRecords(domain, status));
		const sharedSender = { ...added, verified: Boolean(status.verified), dnsRecordIds, createdAt: new Date() };
		await Newsletter.updateOne({ accountId: account._id, _id: newsletter._id }, { $set: { sharedSender } });
		return sharedSender;
	} catch (error) {
		await release({ account, sharedSender: { ...added, dnsRecordIds } });
		throw error;
	}
}

async function remove({ account, newsletter, sharedSender }) {
	await Newsletter.updateOne({ accountId: account._id, _id: newsletter._id, "sharedSender.domain": sharedSender.domain }, { $unset: { sharedSender: 1 } });
	await release({ account, sharedSender });
}

// At the provider it was set up at, and its records. A provider that isn't the active one may not be set up
// any longer: what stays there is reported.
async function release({ account, sharedSender }) {
	const provider = getProvider(sharedSender.provider) ?? getEmailProvider();
	try {
		await provider.removeDomain({ account, domain: sharedSender });
	} catch (error) {
		console.error(`[shared-sender] ${provider.name} still has ${sharedSender.domain}: ${error.message}`);
		await sendAlert({
			accountId: null,
			key: `shared-sender-left:${sharedSender.domain}`,
			title: "Old sending subdomain left behind",
			detail: `${sharedSender.domain} (account ${account._id}) is still at ${provider.name}: ${error.message}.`,
			action: "Remove it there before another newsletter takes the slug.",
			path: "/admin",
		});
	}
	await unpublish(sharedSender);
}

// Two Stripe events for one checkout start the plan at the same moment, and both set up the shared address: the one
// that loses the race fails at the provider while the other one saves it, so that isn't a failure worth an alert.
const RECHECK_AFTER_MS = 2_000;

async function findSetUpMeanwhile({ account, newsletter, zone }) {
	await new Promise((resolve) => setTimeout(resolve, RECHECK_AFTER_MS));
	const fresh = await Newsletter.findOne({ accountId: account._id, _id: newsletter._id }).select({ sharedSender: 1 }).lean();
	return fresh?.sharedSender?.domain === getSharedSendingDomain(newsletter.slug, zone) ? fresh.sharedSender : null;
}

// After a newsletter is saved: the sending subdomain for its slug at the active provider, while it uses the
// shared address. One for another slug or provider goes, so a slug given up can be taken by someone else.
// Failures are reported and retried at the next send, never thrown: the newsletter is saved either way.
// Before the provider's keys are in, the expected state of a new server, nothing is tried: the Domains page says so.
// An account without a plan gets nothing at the provider or in DNS until its plan starts (syncSharedSenders).
export async function syncSharedSender({ account, newsletter }) {
	const zone = getSharedDomain();
	if (!zone) return null;
	const current = newsletter.sharedSender?.domain ? newsletter.sharedSender : null;
	try {
		const provider = getEmailProvider();
		if (!provider.isConfigured()) return null;
		if (current?.domain === getSharedSendingDomain(newsletter.slug, zone) && current.provider === provider.id) return current;
		if (current) await remove({ account, newsletter, sharedSender: current });
		const isWanted = isOnSharedDomain(newsletter.fromEmail, zone) && !isReservedSlug(newsletter.slug) && hasActiveSubscription(account);
		return isWanted ? await create({ account, newsletter, zone, provider }) : null;
	} catch (error) {
		const madeByAnotherRun = await findSetUpMeanwhile({ account, newsletter, zone }).catch(() => null);
		if (madeByAnotherRun) return madeByAnotherRun;
		console.error(`[shared-sender] ${newsletter.slug}: ${error.message}`);
		const { helperProblem } = error;
		if (helperProblem) await sendAlert({ accountId: null, key: `dns-helper-${helperProblem}`, detail: `${error.message}.`, ...DNS_HELPER_ALERTS[helperProblem] });
		await sendAlert({
			accountId: null,
			key: `${helperProblem ? "shared-sender-waiting" : "shared-sender-failed"}:${newsletter._id}`,
			title: "Shared address not set up",
			detail: `${getSharedSendingDomain(newsletter.slug, zone)} (account ${account._id}): ${error.message}.`,
			action: "The newsletter's next save or send tries again.",
			path: "/admin",
		});
		return null;
	}
}

// An account's purge: each shared address's subdomain at its provider, then the records the DNS helper published
// for it. A failure throws, so the purge tries again while the newsletter still has the record ids.
export async function releaseSharedSenders(account) {
	await connectDb();
	const newsletters = await Newsletter.find({ accountId: account._id, "sharedSender.domain": { $type: "string" } }).select({ sharedSender: 1 }).lean();
	for (const { _id, sharedSender } of newsletters) {
		await removeAtProvider({ account, domain: sharedSender });
		await removeSharedRecords(getRecordSlug(sharedSender), sharedSender.dnsRecordIds);
		await Newsletter.updateOne({ accountId: account._id, _id }, { $unset: { sharedSender: 1 } });
	}
}

// When a plan starts, for the newsletters set up before it.
export async function syncSharedSenders(account) {
	await connectDb();
	const newsletters = await Newsletter.find({ accountId: account._id }).lean();
	for (const newsletter of newsletters) await syncSharedSender({ account, newsletter });
}

// Before a send: the newsletter with its sending subdomain set up and, until it verifies, checked again at
// most once a minute. Reading doesn't use the provider's verification budget; the provider keeps checking on its own.
export async function refreshSharedSender(account, newsletter) {
	const zone = getSharedDomain();
	if (!isOnSharedDomain(newsletter?.fromEmail, zone)) return newsletter;
	await connectDb();
	const stored = await Newsletter.findOne({ accountId: account._id, _id: newsletter._id }).select({ slug: 1, fromEmail: 1, sharedSender: 1 }).lean();
	if (!stored) return newsletter;
	let sharedSender = await syncSharedSender({ account, newsletter: stored });
	if (!sharedSender || sharedSender.verified || isRecent(sharedSender.checkedAt)) return { ...newsletter, sharedSender };

	const status = await getEmailProvider().readDomain({ account, domain: sharedSender });
	// Gone at the provider: the next send sets it up again.
	if (status.missing) {
		await remove({ account, newsletter: stored, sharedSender });
		return { ...newsletter, sharedSender: null };
	}
	const checkedAt = new Date();
	const isVerified = Boolean(status.verified);
	await Newsletter.updateOne(
		{ accountId: account._id, _id: newsletter._id, "sharedSender.domain": sharedSender.domain },
		{ $set: { "sharedSender.verified": isVerified, "sharedSender.checkedAt": checkedAt, ...(isVerified && { "sharedSender.verifiedAt": checkedAt }) } }
	);
	sharedSender = { ...sharedSender, verified: isVerified, checkedAt };
	return { ...newsletter, sharedSender };
}
