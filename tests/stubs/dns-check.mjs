// CNAMEs and TXT records set by tests instead of looked up. A TXT record set to null is a lookup that failed.
export const cnames = new Map();
export const txts = new Map();
// Sending records' lookups (lib/domain-dns.js), as "<type> <host>". One a test didn't set fails, which leaves a domain's
// last state: other tests' domains send as their provider says.
export const records = new Map();

export async function readCnames(host) {
	return cnames.get(host) ?? [];
}

export async function readTxt(host) {
	return txts.has(host) ? txts.get(host) : [];
}

export async function readRecords(host, type) {
	const key = `${type} ${host}`;
	return records.has(key) ? records.get(key) : null;
}
