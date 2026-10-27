import "server-only";
import { connectDb } from "@/lib/db";
import { getDomainListProblem, isSpamListEnabled, parseDomainList } from "@/lib/domain-reputation";
import DomainList from "@/models/DomainList";

const MAX_BYTES = 5 * 1024 * 1024;
const CACHE_MS = 60 * 60 * 1000;
// The lists change once a day at most; the hygiene runs more often.
const REFRESH_MS = 20 * 60 * 60 * 1000;

// Lists downloaded again once a day by the list hygiene's runs (app/api/cron/list-hygiene).
// disposable: throwaway inbox services, from disposable-email-domains (CC0, public domain).
// spam: StopForumSpam's toxic domains, minus the 10,000 most visited sites. Its terms allow non-commercial use only,
// so it stays off until StopForumSpam waives that for MailCheap and STOPFORUMSPAM_COMMERCIAL_OK=1 is set.
export const DOMAIN_SOURCES = [
	{
		id: "disposable",
		url: "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf",
		minCount: 2_000,
	},
	{
		id: "spam",
		url: "https://www.stopforumspam.com/downloads/toxic_domains_whole_filtered_10000.txt",
		minCount: 20_000,
		isEnabled: isSpamListEnabled,
	},
];

let cache = null;

function getEnabledSources() {
	return DOMAIN_SOURCES.filter((source) => !source.isEnabled || source.isEnabled());
}

// The file, refused past MAX_BYTES while it streams in.
async function download(url, fetchImpl) {
	const response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000), redirect: "error" });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("file too large");
	const chunks = [];
	let size = 0;
	for await (const chunk of response.body) {
		size += chunk.byteLength;
		if (size > MAX_BYTES) throw new Error("file too large");
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf8");
}

// Each enabled list replaced by a fresh download that passes its checks; any other outcome keeps the list in use. A
// list downloaded in the last REFRESH_MS is kept as it is, unless force.
export async function refreshDomainLists({ fetchImpl = fetch, force = false, now = Date.now() } = {}) {
	await connectDb();
	const results = {};
	for (const source of getEnabledSources()) {
		try {
			const current = await DomainList.findById(source.id).select({ count: 1, fetchedAt: 1 }).lean();
			if (!force && current?.fetchedAt && now - current.fetchedAt < REFRESH_MS) {
				results[source.id] = { count: current.count, fresh: true };
				continue;
			}
			const parsed = parseDomainList(await download(source.url, fetchImpl));
			const problem = getDomainListProblem(parsed, { minCount: source.minCount, previousCount: current?.count });
			if (problem) throw new Error(problem);
			await DomainList.updateOne(
				{ _id: source.id },
				{ $set: { domains: parsed.domains, count: parsed.domains.length, sourceUrl: source.url, fetchedAt: new Date() } },
				{ upsert: true }
			);
			results[source.id] = { count: parsed.domains.length };
		} catch (error) {
			results[source.id] = { kept: true, error: String(error?.message ?? error).slice(0, 120) };
		}
	}
	cache = null;
	return results;
}

// The lists in use, as sets for classifyDomain (lib/domain-reputation.js); read again at most once an hour.
export async function getDomainLists({ now = Date.now() } = {}) {
	if (cache && now - cache.at < CACHE_MS) return cache.lists;
	await connectDb();
	const ids = getEnabledSources().map(({ id }) => id);
	const documents = await DomainList.find({ _id: { $in: ids } }).select({ domains: 1 }).lean();
	const lists = Object.fromEntries(documents.map((document) => [document._id, new Set(document.domains)]));
	cache = { at: now, lists };
	return lists;
}

export function clearDomainListCache() {
	cache = null;
}
