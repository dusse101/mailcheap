import "server-only";
import { Resolver } from "node:dns/promises";
import { mailboxProvider } from "./providers.js";

const CONCURRENCY = 20;
const CACHE_MS = 24 * 60 * 60 * 1000;
// A lookup DNS couldn't answer is tried again soon rather than trusted for a day.
const UNKNOWN_CACHE_MS = 10 * 60 * 1000;
const MAX_CACHED = 50_000;
// Domain -> { verdict, at }, shared by the chunks of one import and the signups of one server.
const cache = new Map();
let resolver;

function getResolver() {
	resolver ??= new Resolver({ timeout: 2500, tries: 2 });
	return resolver;
}

// No MX record: mail goes to the domain's own address (RFC 5321), so the domain needs one.
async function checkAddress(domain, dns) {
	for (const lookup of ["resolve4", "resolve6"]) {
		try {
			if ((await dns[lookup](domain)).length > 0) return "ok";
		} catch (error) {
			if (error.code === "ENOTFOUND") return "none";
			if (error.code !== "ENODATA") return "unknown";
		}
	}
	return "none";
}

// ok: the domain takes email. none: DNS says it can't: no such domain, "MX 0 ." (RFC 7505), or no MX and no address.
// unknown: DNS didn't answer (a timeout, a broken name server), which never counts against an address.
export async function checkMailDomain(domain, dns = getResolver()) {
	try {
		const records = await dns.resolveMx(domain);
		return records.some(({ exchange }) => exchange && exchange !== ".") ? "ok" : "none";
	} catch (error) {
		if (error.code === "ENOTFOUND") return "none";
		if (error.code !== "ENODATA") return "unknown";
	}
	return checkAddress(domain, dns);
}

function readCache(domain, now) {
	const entry = cache.get(domain);
	if (!entry) return undefined;
	return now - entry.at < (entry.verdict === "unknown" ? UNKNOWN_CACHE_MS : CACHE_MS) ? entry.verdict : undefined;
}

function writeCache(domain, verdict, now) {
	if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value);
	cache.set(domain, { verdict, at: now });
}

// Each domain's verdict, looked up at most CONCURRENCY at a time and once per domain. Big mailbox providers are known
// to take email and aren't looked up.
export async function checkMailDomains(domains, dns = getResolver()) {
	const now = Date.now();
	const unique = [...new Set(domains.map((domain) => domain.toLowerCase()))];
	const toCheck = unique.filter((domain) => mailboxProvider(`x@${domain}`) === "other" && readCache(domain, now) === undefined);
	for (let index = 0; index < toCheck.length; index += CONCURRENCY) {
		const group = toCheck.slice(index, index + CONCURRENCY);
		const verdicts = await Promise.all(group.map((domain) => checkMailDomain(domain, dns)));
		group.forEach((domain, position) => writeCache(domain, verdicts[position], now));
	}
	return new Map(unique.map((domain) => [domain, mailboxProvider(`x@${domain}`) === "other" ? readCache(domain, now) : "ok"]));
}

// The domains, among these, that can't receive email: an address is only left out when DNS says so.
export async function findDomainsWithoutMail(domains, dns = getResolver()) {
	const verdicts = await checkMailDomains(domains, dns);
	return new Set([...verdicts].filter(([, verdict]) => verdict === "none").map(([domain]) => domain));
}
