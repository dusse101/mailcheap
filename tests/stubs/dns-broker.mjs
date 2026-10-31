// The DNS helper in memory: records MailCheap asked for, by slug, as the helper keeps them on mailcheap.ai, and website
// domains on the app's Vercel project.
export const dnsRecords = new Map();
let nextId = 0;
let nextFailure = null;

// The next publish fails as lib/dns-broker.js reports the helper's answer: { status, message, helperProblem }.
export function failNextPublish(failure) {
	nextFailure = failure;
}

// Like the helper: a slug's records all or none, one record per name for a CNAME.
export async function publishSharedRecords(slug, records) {
	if (nextFailure) {
		const { status, message, helperProblem } = nextFailure;
		nextFailure = null;
		throw Object.assign(new Error(`The DNS helper refused to create ${slug}'s records: ${message}`), { status, helperProblem });
	}
	for (const { type, name } of records) {
		if ([...dnsRecords.values()].some((record) => record.name === name && (record.type === "CNAME" || type === "CNAME"))) {
			throw new Error(`The DNS helper refused to create ${slug}'s records: ${type} ${name} is taken`);
		}
	}
	const ids = records.map(({ type, name, value }) => {
		const id = `rec_${++nextId}`;
		dnsRecords.set(id, { id, slug, type, name, value });
		return id;
	});
	return { ids };
}

export async function removeSharedRecords(slug, ids = []) {
	for (const id of ids) if (dnsRecords.get(id)?.slug === slug) dnsRecords.delete(id);
	return { deleted: ids };
}

// What a resolver would find at a name, for the provider stubs deciding whether a domain verifies.
export function findDnsRecord(name, type) {
	return [...dnsRecords.values()].find((record) => record.name === name && record.type === type) ?? null;
}

// Website domains on the app's Vercel project, as the helper keeps them: host → verified. challengedHosts: hosts Vercel
// wants verified with its own TXT record first, until a test takes them out.
export const projectHosts = new Map();
export const challengedHosts = new Set();
const helper = { isSetUp: true, nextFailure: null };

// false: a self-hosted server, without the helper.
export function setHelperSetUp(isSetUp) {
	helper.isSetUp = isSetUp;
}

// The next attach fails as lib/dns-broker.js reports the helper's answer: { status, message, helperProblem }.
export function failNextAttach(failure) {
	helper.nextFailure = failure;
}

export async function attachWebsiteHost(host) {
	if (!helper.isSetUp) return { skipped: true };
	if (helper.nextFailure) {
		const { status, message, helperProblem = null } = helper.nextFailure;
		helper.nextFailure = null;
		throw Object.assign(new Error(`The DNS helper refused to attach ${host}: ${message}`), { status, helperProblem });
	}
	const verified = !challengedHosts.has(host);
	projectHosts.set(host, verified);
	const apex = host.split(".").slice(-2).join(".");
	return { verified, verification: verified ? [] : [{ type: "TXT", name: `_vercel.${apex}`, value: `vc-domain-verify=${host},7d1c0a` }] };
}

export async function detachWebsiteHost(host) {
	if (!helper.isSetUp) return { skipped: true };
	return { detached: projectHosts.delete(host) };
}
