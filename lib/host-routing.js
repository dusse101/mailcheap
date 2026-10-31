import { getSlugForSharedHost } from "./archive-hosts.js";
import { getAppHost, getSharedDomain } from "./config.js";
import { connectDb } from "./db.js";
import { isReservedSlug } from "./reserved-slugs.js";
import Newsletter from "../models/Newsletter.js";

// Hosts change only when a website domain is checked or removed, so each instance keeps answers for a minute.
const CACHE_TTL_MS = 60_000;
const MAX_CACHED_HOSTS = 5000;
const cache = new Map();

function toHostname(host) {
	return String(host ?? "")
		.toLowerCase()
		.split(":")[0];
}

function isAppHost(hostname) {
	return (
		hostname === toHostname(getAppHost()) ||
		hostname === "localhost" ||
		hostname === "127.0.0.1" ||
		hostname.endsWith(".vercel.app")
	);
}

// The shared domain can be the app's own, as mailcheap.ai is on MailCheap Cloud: www, r, cdn and the other
// reserved subdomains, and every name under them, stay MailCheap's.
function isReservedSharedHost(hostname, sharedDomain) {
	return isReservedSlug(hostname.slice(0, -sharedDomain.length - 1).split(".").pop());
}

async function findSlugByArchiveHost(hostname) {
	const hit = cache.get(hostname);
	if (hit && hit.expiresAt > Date.now()) return hit.slug;
	await connectDb();
	const newsletter = await Newsletter.findOne({ archiveHost: hostname }, { slug: 1 }, { crossAccount: true }).lean();
	if (cache.size >= MAX_CACHED_HOSTS) cache.clear();
	cache.set(hostname, { slug: newsletter?.slug ?? null, expiresAt: Date.now() + CACHE_TTL_MS });
	return newsletter?.slug ?? null;
}

// Which newsletter a request's host serves: <slug>.<shared domain>, or a newsletter's live website domain. null is
// the app itself. A canceled account's host keeps resolving, so its unsubscribe and tracking links work, and so does
// a host a newsletter left: it names no newsletter, so only those links answer there.
export async function resolveArchiveHost(host) {
	const hostname = toHostname(host);
	if (!hostname || isAppHost(hostname)) return { isArchiveHost: false, slug: null };
	const sharedDomain = getSharedDomain();
	if (sharedDomain && (hostname === sharedDomain || hostname.endsWith(`.${sharedDomain}`))) {
		if (isReservedSharedHost(hostname, sharedDomain)) return { isArchiveHost: false, slug: null };
		return { isArchiveHost: true, slug: getSlugForSharedHost(hostname, sharedDomain) };
	}
	try {
		return { isArchiveHost: true, slug: await findSlugByArchiveHost(hostname) };
	} catch (error) {
		console.error(`[host-routing] Could not look up ${hostname}: ${error.message}`);
		return { isArchiveHost: true, slug: null };
	}
}
