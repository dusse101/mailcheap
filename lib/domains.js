import "server-only";
import { connectDb } from "@/lib/db";
import { getDmarcHosts, getDmarcStatus } from "@/lib/dmarc-rules";
import { readTxt } from "@/lib/dns-check";
import { checkDomainDns } from "@/lib/domain-dns";
import { DNS_RECHECK_HOURS, getDnsProblems } from "@/lib/domain-dns-rules";
import { getEmailProvider, getProvider } from "@/lib/email-provider";
import { getDomainProblem, getEmailDomain, normalizeDomainInput, withActiveProvider } from "@/lib/sender-rules";
import { isObjectIdString } from "@/lib/validation";
import Campaign from "@/models/Campaign";
import Domain from "@/models/Domain";
import Newsletter from "@/models/Newsletter";

// Campaigns that would break halfway if their from domain went away.
const ACTIVE_CAMPAIGN_STATUSES = ["sending", "scheduled", "paused"];
const READ_EVERY_MS = 60_000;
const HOUR_MS = 3_600_000;
// Each hourly run looks at this many domains due for their daily look, a few at a time: about 1,200 a day.
const RECHECK_BATCH = 50;
const RECHECK_AT_ONCE = 5;

// The code is one of lib/actions/errors.js, for the API and MCP.
function domainError(message, code = "validation_failed") {
	return Object.assign(new Error(message), { isUserError: true, code });
}

async function findDomain(account, domainId) {
	const domain = isObjectIdString(String(domainId)) ? await Domain.findOne({ accountId: account._id, _id: domainId }).lean() : null;
	if (!domain) throw domainError("Domain not found", "not_found");
	return domain;
}

// A domain added at another provider, before EMAIL_PROVIDER changed, is added again at this one: it gets new
// DNS records, and sends once they're in.
async function moveToProvider({ account, domain, provider }) {
	if ((domain.provider ?? "ses") === provider.id) return domain;
	const { providerDomainId } = await provider.addDomain({ account, domain: domain.domain });
	const set = {
		provider: provider.id,
		mailFromDomain: provider.getMailFromDomain(domain.domain),
		verified: false,
		dkimStatus: "PENDING",
		mailFromStatus: "PENDING",
		records: [],
		...(providerDomainId && { providerDomainId }),
	};
	await Domain.updateOne(
		{ accountId: account._id, _id: domain._id },
		{ $set: set, ...(!providerDomainId && { $unset: { providerDomainId: 1 } }) }
	);
	return { ...domain, ...set, providerDomainId: providerDomainId ?? undefined };
}

function toProviderFields(status) {
	if (status.missing) return { verified: false, dkimStatus: "NOT_STARTED", mailFromStatus: "NOT_STARTED" };
	return {
		verified: status.verified,
		dkimStatus: status.dkimStatus,
		mailFromStatus: status.mailFromStatus ?? "PENDING",
		records: status.records,
	};
}

// A failed lookup says nothing, so the last answer stays (null).
async function findDmarc(domain) {
	for (const host of getDmarcHosts(domain)) {
		const records = await readTxt(`_dmarc.${host}`);
		if (!records) return null;
		const status = getDmarcStatus(records);
		if (status) return { status, host };
	}
	return { status: "missing" };
}

// The domain at the email provider and its DMARC record, as the fields to save. verify asks the provider to look at
// DNS now; a provider with a verification budget may answer with what it found a moment ago (unchanged).
async function readStatus({ account, domain, provider, verify }) {
	const [status, dmarc] = await Promise.all([provider.readDomain({ account, domain, verify }), findDmarc(domain.domain)]);
	if (status.error) throw Object.assign(new Error(`${provider.name} didn't answer: ${status.error}`), { code: "unavailable" });
	return { isUnchanged: Boolean(status.unchanged), set: { ...(dmarc && { dmarc }), ...(!status.unchanged && toProviderFields(status)) } };
}

async function saveStatus({ account, domain, set }) {
	if (set.verified && !domain.verifiedAt) set.verifiedAt = new Date();
	await Domain.updateOne({ accountId: account._id, _id: domain._id }, { $set: set });
	return { ...domain, ...set };
}

// The provider's status, then MailCheap's own look at the records it lists.
export async function checkDomain({ account, domainId, verify = true }) {
	await connectDb();
	const provider = getEmailProvider();
	const domain = await moveToProvider({ account, domain: await findDomain(account, domainId), provider });
	const { isUnchanged, set } = await readStatus({ account, domain, provider, verify });
	return checkDomainDns(await saveStatus({ account, domain, set: { ...set, ...(!isUnchanged && { checkedAt: new Date() }) } }));
}

function isRecent(date) {
	return Boolean(date) && Date.now() - new Date(date).getTime() < READ_EVERY_MS;
}

function isWaiting(domain, provider) {
	const isSetUp =
		domain.verified &&
		domain.dkimStatus === "SUCCESS" &&
		domain.mailFromStatus === "SUCCESS" &&
		domain.dmarc?.status === "found" &&
		getDnsProblems(domain).length === 0;
	return (domain.provider ?? "ses") === provider.id && !isSetUp && !isRecent(domain.checkedAt) && !isRecent(domain.readAt);
}

// For the Domains page: a domain still being set up, or with a record to fix, is read again, at most once a minute and
// without the provider's verification budget, as PostShiba keeps checking DNS on its own. One from another provider
// waits for Check now, which adds it at this one.
export async function refreshDomains(account, domains) {
	const provider = getEmailProvider();
	if (!provider.isConfigured()) return domains;
	await connectDb();
	return Promise.all(
		domains.map(async (domain) => {
			if (!isWaiting(domain, provider)) return domain;
			try {
				const { set } = await readStatus({ account, domain, provider, verify: false });
				return await checkDomainDns(await saveStatus({ account, domain, set: { ...set, readAt: new Date() } }));
			} catch (error) {
				console.warn(`[domains] ${domain.domain} not read again: ${error.message}`);
				return domain;
			}
		})
	);
}

// A verified domain's daily look, from the hourly cron: its provider's status, whose records can change too, then its
// DNS. One its provider doesn't answer for still gets its DNS looked at.
async function recheckDomain(domain, provider) {
	const account = { _id: domain.accountId };
	let current = domain;
	try {
		const { set } = await readStatus({ account, domain, provider, verify: false });
		current = await saveStatus({ account, domain, set });
	} catch (error) {
		console.warn(`[domains] ${domain.domain} not read again: ${error.message}`);
	}
	return checkDomainDns(current);
}

// The hourly cron's part: the verified domains last looked at over a day ago, the oldest first.
export async function recheckDomains() {
	const provider = getEmailProvider();
	if (!provider.isConfigured()) return { skipped: "email provider not set up" };
	await connectDb();
	const domains = await Domain.find({
		verified: true,
		provider: provider.id === "ses" ? { $in: ["ses", null] } : provider.id,
		$or: [{ "dns.checkedAt": { $lt: new Date(Date.now() - DNS_RECHECK_HOURS * HOUR_MS) } }, { "dns.checkedAt": { $exists: false } }],
	})
		.sort({ "dns.checkedAt": 1 })
		.limit(RECHECK_BATCH)
		.setOptions({ crossAccount: true })
		.lean();
	let withProblems = 0;
	for (let index = 0; index < domains.length; index += RECHECK_AT_ONCE) {
		const checked = await Promise.all(domains.slice(index, index + RECHECK_AT_ONCE).map((domain) => recheckDomain(domain, provider)));
		withProblems += checked.filter((domain) => withActiveProvider(domain).dnsProblems.length > 0).length;
	}
	return { checked: domains.length, withProblems };
}

// The unique index makes the first account to add a domain its only owner, even with two at once.
export async function addDomain({ account, domain: domainInput }) {
	await connectDb();
	const domain = normalizeDomainInput(domainInput);
	const domainProblem = getDomainProblem(domain);
	if (domainProblem) throw domainError(domainProblem);

	const provider = getEmailProvider();
	let created;
	try {
		created = await Domain.create({
			accountId: account._id,
			domain,
			archiveHost: `news.${domain}`,
			mailFromDomain: provider.getMailFromDomain(domain),
			provider: provider.id,
		});
	} catch (error) {
		if (error?.code !== 11000) throw error;
		const isOwn = await Domain.exists({ accountId: account._id, domain });
		throw domainError(isOwn ? `${domain} is already added` : `${domain} is used by another MailCheap account`, "conflict");
	}

	try {
		const { providerDomainId } = await provider.addDomain({ account, domain });
		if (providerDomainId) await Domain.updateOne({ accountId: account._id, _id: created._id }, { $set: { providerDomainId } });
	} catch (error) {
		// Nothing was sent from it yet: the claim goes, so the account can try again.
		await Domain.deleteOne({ accountId: account._id, _id: created._id });
		throw error;
	}
	// The provider starts checking a new domain on its own: reading it is enough.
	return checkDomain({ account, domainId: created._id, verify: false });
}

// At the provider it was added at. One that isn't the active provider anymore may not be set up any longer.
export async function removeAtProvider({ account, domain }) {
	const active = getEmailProvider();
	const owner = getProvider(domain.provider ?? "ses") ?? active;
	try {
		await owner.removeDomain({ account, domain });
	} catch (error) {
		if (owner === active) throw error;
		console.error(`[domains] ${owner.name} didn't remove ${domain.domain}: ${error.message}`);
	}
}

export async function removeDomain({ account, domainId }) {
	await connectDb();
	const domain = await findDomain(account, domainId);
	const newsletterIds = (await Newsletter.find({ accountId: account._id }).select({ fromEmail: 1 }).lean())
		.filter(({ fromEmail }) => getEmailDomain(fromEmail) === domain.domain)
		.map(({ _id }) => _id);
	const isInUse =
		newsletterIds.length > 0 &&
		(await Campaign.exists({ accountId: account._id, newsletterId: { $in: newsletterIds }, status: { $in: ACTIVE_CAMPAIGN_STATUSES } }));
	if (isInUse) {
		throw domainError(`A campaign is sending or scheduled from ${domain.domain}. Wait until it's sent or cancel it first.`, "conflict");
	}

	await removeAtProvider({ account, domain });
	await Domain.deleteOne({ accountId: account._id, _id: domain._id });
	return { removed: domain.domain };
}

// An account's purge: every domain at its provider. Its campaigns are gone already.
export async function releaseDomains(account) {
	await connectDb();
	for (const domain of await Domain.find({ accountId: account._id }).lean()) {
		await removeAtProvider({ account, domain });
		await Domain.deleteOne({ accountId: account._id, _id: domain._id });
	}
}
