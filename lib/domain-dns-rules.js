// MailCheap's own look at a domain's sending records (lib/domain-dns.js), next to its email provider's: a provider can
// keep a domain verified after its records change, and Cloudflare's proxy answers a proxied CNAME's name with its own
// addresses, so inboxes find neither the DKIM key nor the return path while the domain still looks set up.

// A verified domain is looked at again once a day, and before a test or a send whose last look is older than an hour.
export const DNS_RECHECK_HOURS = 24;
export const DNS_FRESH_MINUTES = 60;

const PURPOSE_NAMES = { dkim: "signature (DKIM)", "mail-from": "return path" };

// Each record's step on the Domains page, when a problem is what it shows.
export const DNS_STATE_STATUSES = {
	proxied: { label: "Behind a proxy, set it to DNS only", tone: "bad" },
	different: { label: "Doesn't match, copy it again", tone: "bad" },
	missing: { label: "Not found anymore, add it back", tone: "bad" },
};

function toHost(value) {
	return String(value ?? "")
		.trim()
		.toLowerCase()
		.replace(/\.$/, "");
}

function squash(text) {
	return String(text ?? "").replace(/\s+/g, "");
}

// The lookups a record needs, by the answer each gives. A CNAME's target's TXT records tell a DNS provider that
// flattens the CNAME, answering with its target's records, from one whose proxy hides it.
export function getRecordLookups({ type, name, value }) {
	if (type === "CNAME") return { cname: [name, "CNAME"], txt: [name, "TXT"], targetTxt: [value, "TXT"], addresses: [name, "A"] };
	if (type === "MX") return { mx: [name, "MX"] };
	return { txt: [name, "TXT"] };
}

// found, proxied (addresses answer where the CNAME should be, as behind Cloudflare's proxy), different (something else
// is there) or missing, from the answers to getRecordLookups. null when a lookup failed: the last state stays.
export function getRecordState(record, answers) {
	if (record.type === "CNAME") return getCnameState(toHost(record.value), answers);
	const found = record.type === "MX" ? answers.mx : answers.txt;
	if (!found) return null;
	if (found.length === 0) return "missing";
	// A key has one right value; an SPF record or an MX may carry the customer's own additions.
	const isKey = record.type === "TXT" && record.purpose === "dkim";
	return !isKey || found.some((text) => squash(text) === squash(record.value)) ? "found" : "different";
}

function getCnameState(target, { cname, txt, targetTxt, addresses }) {
	if (!cname) return null;
	if (cname.includes(target)) return "found";
	if (!txt || !targetTxt) return null;
	if (targetTxt.length > 0 && targetTxt.every((text) => txt.includes(text))) return "found";
	if (cname.length > 0 || txt.length > 0) return "different";
	if (!addresses) return null;
	return addresses.length > 0 ? "proxied" : "missing";
}

function isSameRecord(a, b) {
	return a.type === b.type && toHost(a.name) === toHost(b.name);
}

// The records' problems after a look, in the records' order. A record whose lookup failed keeps its last state.
export function mergeDnsProblems(records, states, previous = []) {
	return records.flatMap((record, index) => {
		const state = states[index] ?? previous.find((problem) => isSameRecord(problem, record))?.state ?? "found";
		return state === "found" ? [] : [{ purpose: record.purpose, type: record.type, name: record.name, state }];
	});
}

// The problems that count, on the records the domain has now. verified: its provider's word. Until then, a record
// that isn't there yet is what the provider's status already shows.
export function getDnsProblems({ records = [], dns, verified }) {
	const problems = (dns?.problems ?? []).filter((problem) => records.some((record) => isSameRecord(problem, record)));
	return verified ? problems : problems.filter(({ state }) => state !== "missing");
}

export function isDnsStale(domain, minutes, now = Date.now()) {
	const checkedAt = domain.dns?.checkedAt;
	return !checkedAt || now - new Date(checkedAt).getTime() >= minutes * 60_000;
}

// What stops the domain from sending, and its fix: the first problem, with the other records that have the same.
export function getDnsProblemMessage(domain, problems) {
	const [first] = problems;
	if (!first) return null;
	const same = problems.filter(({ state }) => state === first.state);
	const names = [...new Set(same.map(({ purpose }) => PURPOSE_NAMES[purpose] ?? "DNS"))].join(" and ");
	const isPlural = same.length > 1;
	const records = `${domain}'s ${names} record${isPlural ? "s" : ""}`;
	const them = isPlural ? "them" : "it";
	if (first.state === "proxied") {
		return `${records} ${isPlural ? "are" : "is"} behind a proxy, which hides ${them} from inboxes. On Cloudflare, set ${them} to DNS only.`;
	}
	if (first.state === "different") return `${records} ${isPlural ? "don't" : "doesn't"} match the Domains page. Copy ${them} again from there.`;
	return `${records} ${isPlural ? "aren't" : "isn't"} in its DNS anymore. Add ${them} back.`;
}
