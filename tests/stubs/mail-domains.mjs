// Domains tests mark as unable to receive email, or as DNS not answering, instead of looking them up.
export const domainsWithoutMail = new Set();
export const domainsUnknown = new Set();

export async function checkMailDomain(domain) {
	const name = domain.toLowerCase();
	if (domainsWithoutMail.has(name)) return "none";
	return domainsUnknown.has(name) ? "unknown" : "ok";
}

export async function checkMailDomains(domains) {
	const unique = [...new Set(domains.map((domain) => domain.toLowerCase()))];
	return new Map(await Promise.all(unique.map(async (domain) => [domain, await checkMailDomain(domain)])));
}

export async function findDomainsWithoutMail(domains) {
	return new Set(domains.map((domain) => domain.toLowerCase()).filter((domain) => domainsWithoutMail.has(domain)));
}
