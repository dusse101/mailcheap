import crypto from "node:crypto";
import { getAppHost, getAppSecret, getSharedDomain } from "./config.js";
import { getDnsHost } from "./domain-records.js";
import { rootDomain } from "./root-domain.js";
import { isHostname, isReservedDomain } from "./sender-rules.js";

const OWNERSHIP_VALUE_PREFIX = "mailcheap-verify=";
const FOUND = { label: "Found", tone: "good" };
const WAITING = { label: "Waiting for DNS", tone: "wait" };

// A newsletter's website goes on a subdomain of the customer's: a domain's own name can't take a CNAME.
export function getWebsiteHostProblem(host, { sharedDomain = getSharedDomain(), appHost = getAppHost() } = {}) {
	if (!isHostname(host)) return "Enter a subdomain like news.example.com";
	if (isReservedDomain(host, { sharedDomain, appHost })) return "This domain can't be used";
	if (rootDomain(host) === host) return `Use a subdomain, like news.${host}`;
	return null;
}

// The TXT record that proves an account controls the host. It's derived from the account and the host, so the same
// record works each time the account adds the host, and no other account can know it: a CNAME someone left pointing at
// MailCheap isn't enough to claim their domain.
export function getOwnershipRecord(accountId, host) {
	const key = Buffer.from(crypto.hkdfSync("sha256", getAppSecret(), "", "mailcheap-website-domain-v1", 32));
	const token = crypto.createHmac("sha256", key).update(`${accountId}:${host}`).digest("base64url").slice(0, 32);
	return { type: "TXT", name: `_mailcheap.${host}`, value: `${OWNERSHIP_VALUE_PREFIX}${token}` };
}

// txt: the TXT records at a name, each as the strings DNS splits it into.
export function hasTxtRecord(txt, value) {
	return txt.some((strings) => strings.join("") === value);
}

// The newsletter's website domain, being set up or live. A host from before website domains had their own setting,
// a sending domain's subdomain, is live.
export function getWebsiteDomain(newsletter) {
	const domain = newsletter?.websiteDomain;
	if (domain?.host) return { ...domain, isLive: newsletter.archiveHost === domain.host };
	return newsletter?.archiveHost ? { host: newsletter.archiveHost, isLive: true } : null;
}

// What the Website settings and the API show: the domain's status and the records to add, step by step, as last
// checked. A live domain only keeps its CNAME. null without a domain, or on a server that doesn't host websites on
// customers' domains (cnameTarget).
export function getWebsiteDomainSetup(newsletter, { accountId, cnameTarget }) {
	const domain = getWebsiteDomain(newsletter);
	if (!domain || !cnameTarget) return null;
	const { host, isLive } = domain;
	const zone = rootDomain(host);
	const withHost = (record) => ({ ...record, host: getDnsHost(record.name, zone) });
	// A host from before website domains had their own setting was never checked here: it was live then.
	const isPointed = isLive ? domain.cnameFound !== false : Boolean(domain.cnameFound);
	const steps = [
		{
			key: "cname",
			title: "Points to MailCheap",
			description: isLive
				? `Keep this record: it puts your website and the links in your emails on ${host}.`
				: `Puts your website and the links in your emails on ${host}.`,
			status: getCnameStatus({ isLive, isPointed }),
			records: [withHost({ type: "CNAME", name: host, value: cnameTarget })],
		},
	];
	if (!isLive) {
		steps.push({
			key: "ownership",
			title: "Proves it's yours",
			description: "Only someone who manages the domain can add it, so nobody else can claim it.",
			status: domain.txtFound ? FOUND : WAITING,
			records: [withHost(getOwnershipRecord(accountId, host))],
		});
	}
	if (!isLive && domain.verification?.length > 0) {
		steps.push({
			key: "vercel",
			title: "Vercel's check",
			description: `${zone} is also used on Vercel, where MailCheap runs, so Vercel asks for this record too.`,
			status: WAITING,
			records: domain.verification.map(({ type, name, value }) => withHost({ type, name, value })),
		});
	}
	return { host, zone, isLive, isPointed, status: getStatus({ isLive, isPointed }), steps, checkedAt: domain.checkedAt ?? null };
}

function getCnameStatus({ isLive, isPointed }) {
	if (isPointed) return FOUND;
	return isLive ? { label: "Not found", tone: "bad" } : WAITING;
}

function getStatus({ isLive, isPointed }) {
	if (!isLive) return WAITING;
	return isPointed ? { label: "Live", tone: "good" } : { label: "Not pointing at MailCheap", tone: "bad" };
}
