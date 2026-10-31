import "server-only";
import { sendAlert } from "@/lib/alerts";
import { revalidateArchive } from "@/lib/archive-data";
import { getArchiveCnameTarget } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { attachWebsiteHost, detachWebsiteHost } from "@/lib/dns-broker";
import { readCnames, readTxt } from "@/lib/dns-check";
import { normalizeHostInput } from "@/lib/sender-rules";
import { getOwnershipRecord, getWebsiteDomain, getWebsiteHostProblem, hasTxtRecord } from "@/lib/website-domain-rules";
import Newsletter from "@/models/Newsletter";

// A newsletter's website and the links in its emails move to a subdomain of the customer's once its CNAME points at
// MailCheap and its TXT record proves the account controls it. On MailCheap Cloud the DNS helper also puts the host on
// the app's Vercel project, which serves it and its certificate; a self-hosted server routes it on its own.

// The code is one of lib/actions/errors.js, for the API and MCP.
function websiteDomainError(message, code = "validation_failed") {
	return Object.assign(new Error(message), { isUserError: true, code });
}

function getCnameTarget() {
	const target = getArchiveCnameTarget();
	if (!target) throw websiteDomainError("This server doesn't put websites on your own domain", "unavailable");
	return target;
}

function takenError(host) {
	return websiteDomainError(`${host} is already used by another MailCheap newsletter`, "conflict");
}

function findFresh(account, newsletter) {
	return Newsletter.findOne({ accountId: account._id, _id: newsletter._id }).lean();
}

function isLiveElsewhere(host, newsletter) {
	return Newsletter.exists({ archiveHost: host, _id: { $ne: newsletter._id } }).setOptions({ crossAccount: true });
}

// A host stays on the app's Vercel project while another newsletter has it: live, set up on the project, or live on it
// before, for the links in the emails it sent then.
async function detachUnlessKept(host, others) {
	const isKept = await Newsletter.exists({
		...others,
		$or: [{ archiveHost: host }, { "websiteDomain.host": host, "websiteDomain.attachedAt": { $type: "date" } }, { pastHosts: host }],
	}).setOptions({ crossAccount: true });
	if (!isKept) await detachWebsiteHost(host);
}

// The helper itself, not the host (lib/dns-broker.js): one admin alert for every domain waiting on it.
const HELPER_ALERTS = {
	cap: {
		title: "DNS helper at its daily cap",
		action: "New website domains wait until the oldest are a day old. Raise the cap if it's real growth.",
	},
	down: {
		title: "DNS helper failing",
		action: "Website domains can't go live: check the helper's logs, its Vercel token and DNS_BROKER_SECRET.",
	},
};

async function reportHelper(error, host) {
	const alert = HELPER_ALERTS[error.helperProblem];
	if (!alert) return;
	await sendAlert({ accountId: null, key: `dns-helper-${error.helperProblem}`, detail: `${host} couldn't go on the Vercel project: ${error.message}.`, ...alert });
}

// On the app's project once the TXT record is in: { isReady, set }. Without the helper (a self-hosted server, local
// development) there's nothing to do.
async function attachHost(host, current) {
	let attached;
	try {
		attached = await attachWebsiteHost(host);
	} catch (error) {
		if (error.status === 409) {
			throw websiteDomainError(`${host} is used by another site on Vercel, where MailCheap runs. Remove it there, then check again.`, "conflict");
		}
		console.error(`[website-domains] ${host} isn't on the Vercel project: ${error.message}`);
		await reportHelper(error, host);
		throw websiteDomainError(`Couldn't connect ${host} yet. Try again later.`, "unavailable");
	}
	if (attached.skipped) return { isReady: true, set: {} };
	return {
		isReady: attached.verified,
		set: { "websiteDomain.attachedAt": current.attachedAt ?? new Date(), "websiteDomain.verification": attached.verification },
	};
}

// Looks at its DNS records again. A domain being set up goes live once they're all in; a live one only says whether its
// CNAME is still there, since taking it down would change the links of the next emails on a DNS hiccup.
export async function checkWebsiteDomain({ account, newsletter }) {
	await connectDb();
	const cnameTarget = getCnameTarget();
	const current = getWebsiteDomain(newsletter);
	if (!current) throw websiteDomainError("Add a domain for the website first", "not_found");
	const { host } = current;
	const ownership = getOwnershipRecord(account._id, host);
	const [cnames, txt] = await Promise.all([readCnames(host), current.isLive ? null : readTxt(ownership.name)]);
	const set = { "websiteDomain.host": host, "websiteDomain.cnameFound": cnames.includes(cnameTarget), "websiteDomain.checkedAt": new Date() };
	// A failed TXT lookup says nothing, so the last answer stays.
	if (txt) set["websiteDomain.txtFound"] = hasTxtRecord(txt, ownership.value);
	const filter = { accountId: account._id, _id: newsletter._id, ...(!current.isLive && { "websiteDomain.host": host }) };
	const save = () => Newsletter.updateOne(filter, { $set: set });

	const isProven = !current.isLive && (set["websiteDomain.txtFound"] ?? current.txtFound) === true;
	if (!isProven) {
		await save();
		return findFresh(account, newsletter);
	}
	if (await isLiveElsewhere(host, newsletter)) {
		await save();
		throw takenError(host);
	}
	let attached;
	try {
		attached = await attachHost(host, current);
	} catch (error) {
		await save();
		throw error;
	}
	Object.assign(set, attached.set);
	if (!attached.isReady || !set["websiteDomain.cnameFound"]) {
		await save();
		return findFresh(account, newsletter);
	}
	try {
		await Newsletter.updateOne(filter, { $set: { ...set, archiveHost: host, "websiteDomain.liveAt": new Date() }, $pull: { pastHosts: host } });
	} catch (error) {
		if (error?.code !== 11000) throw error;
		await save();
		throw takenError(host);
	}
	revalidateArchive();
	return findFresh(account, newsletter);
}

// One domain per newsletter: a live one is removed first. One that never went live gives way to the new one.
export async function setWebsiteDomain({ account, newsletter, host: input }) {
	await connectDb();
	getCnameTarget();
	const host = normalizeHostInput(input);
	const problem = getWebsiteHostProblem(host);
	if (problem) throw websiteDomainError(problem);
	const current = getWebsiteDomain(newsletter);
	if (current?.host === host) return checkWebsiteDomain({ account, newsletter });
	if (current?.isLive) throw websiteDomainError(`Remove ${current.host} first: a newsletter has one domain at a time`, "conflict");
	if (await isLiveElsewhere(host, newsletter)) throw takenError(host);

	await Newsletter.updateOne({ accountId: account._id, _id: newsletter._id }, { $set: { websiteDomain: { host } } });
	if (current?.attachedAt) {
		await detachUnlessKept(current.host, { _id: { $ne: newsletter._id } }).catch((error) =>
			console.error(`[website-domains] ${current.host} stays on the Vercel project: ${error.message}`)
		);
	}
	return checkWebsiteDomain({ account, newsletter: { ...newsletter, websiteDomain: { host } } });
}

// The website goes back to the shared subdomain. A host that was live stays on the app's project, so the links in the
// emails sent on it keep working while it points at MailCheap.
export async function removeWebsiteDomain({ account, newsletter }) {
	await connectDb();
	const current = getWebsiteDomain(newsletter);
	if (!current) throw websiteDomainError("The newsletter has no website domain", "not_found");
	await Newsletter.updateOne(
		{ accountId: account._id, _id: newsletter._id },
		current.isLive
			? { $unset: { websiteDomain: 1, archiveHost: 1 }, $addToSet: { pastHosts: current.host } }
			: { $unset: { websiteDomain: 1 } }
	);
	if (current.isLive) revalidateArchive();
	else if (current.attachedAt) {
		await detachUnlessKept(current.host, { _id: { $ne: newsletter._id } }).catch((error) =>
			console.error(`[website-domains] ${current.host} stays on the Vercel project: ${error.message}`)
		);
	}
	return { removed: current.host };
}

// An account's purge: its hosts leave the app's project, unless another account's newsletter has one. A failure
// throws, so the purge tries again while the newsletters still name them.
export async function releaseWebsiteDomains(account) {
	await connectDb();
	const newsletters = await Newsletter.find({ accountId: account._id }).select({ archiveHost: 1, websiteDomain: 1, pastHosts: 1 }).lean();
	const hosts = new Set(
		newsletters.flatMap(({ archiveHost, websiteDomain, pastHosts }) => [
			archiveHost,
			websiteDomain?.attachedAt ? websiteDomain.host : null,
			...(pastHosts ?? []),
		])
	);
	hosts.delete(null);
	hosts.delete(undefined);
	for (const host of hosts) await detachUnlessKept(host, { accountId: { $ne: account._id } });
}
