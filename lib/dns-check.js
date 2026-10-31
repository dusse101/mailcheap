import "server-only";
import { Resolver } from "node:dns/promises";

// The Domains page waits for these lookups, so they give up within seconds.
const resolver = new Resolver({ timeout: 2000, tries: 2 });
// No such name, or no record of that type: an answer, unlike a resolver that failed.
const NO_RECORD = new Set(["ENOTFOUND", "ENODATA"]);

// Where a hostname's CNAME points, lowercased without the trailing dot. Nothing (or an error) is [].
export async function readCnames(host) {
	try {
		return (await resolver.resolveCname(host)).map((target) => target.toLowerCase().replace(/\.$/, ""));
	} catch {
		return [];
	}
}

// A hostname's TXT records, each as the strings DNS splits it into. Nothing is [], and a failed lookup null.
export async function readTxt(host) {
	try {
		return await resolver.resolveTxt(host);
	} catch (error) {
		return NO_RECORD.has(error.code) ? [] : null;
	}
}

// A hostname's records of one type (CNAME, TXT, MX or A) as text: hostnames lowercased without the trailing dot, an MX
// as its mail server, a TXT record joined from the strings DNS splits it into. Nothing is [], and a failed lookup null.
export async function readRecords(host, type) {
	try {
		return (await resolver.resolve(host, type)).map((answer) => {
			if (type === "TXT") return answer.join("");
			return String(type === "MX" ? answer.exchange : answer)
				.toLowerCase()
				.replace(/\.$/, "");
		});
	} catch (error) {
		return NO_RECORD.has(error.code) ? [] : null;
	}
}
