// A newsletter can have its own website for reading issues, outside MailCheap. NEWSLETTER_EXTERNAL_SITES maps
// newsletter slugs to the https address its issues live under, e.g. {"weekly":"https://example.com/issues"}.
// For a newsletter in it, emails' Read online links go to <address>/<archiveSlug>, and its archive here
// redirects there: the index to <address>, each issue to its page. Unset, empty or invalid: off, as before.
function parseSites(raw) {
	if (!raw || !String(raw).trim()) return {};
	try {
		const sites = JSON.parse(raw);
		return sites && typeof sites === "object" && !Array.isArray(sites) ? sites : {};
	} catch {
		console.error("[external-site] NEWSLETTER_EXTERNAL_SITES is not valid JSON; ignoring it");
		return {};
	}
}

export function getExternalSiteBase(newsletter, env = process.env) {
	const slug = newsletter?.slug;
	if (!slug) return null;
	const value = parseSites(env.NEWSLETTER_EXTERNAL_SITES)[slug];
	if (typeof value !== "string") return null;
	try {
		const url = new URL(value.trim());
		if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
		return url.toString().replace(/\/+$/, "");
	} catch {
		return null;
	}
}

export function getExternalIssueUrl(newsletter, postSlug, env = process.env) {
	const base = getExternalSiteBase(newsletter, env);
	return base && postSlug ? `${base}/${encodeURIComponent(postSlug)}` : null;
}
