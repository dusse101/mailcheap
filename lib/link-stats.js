import crypto from "node:crypto";
import { getAppHost } from "./config.js";
import { decodeEntities } from "./clean-html.js";
import { decodeHref } from "./tracking.js";

export { formatLinkUrl } from "./links.js";

// A campaign report's clicks per link (models/CampaignLink.js). A link is its address without the parameters that only
// say where a visit came from, so the same page counts once whatever tracking each of its links in the email carries.
const TRACKING_PARAM =
	/^(utm_\w+|fbclid|gclid|gbraid|wbraid|dclid|msclkid|yclid|twclid|ttclid|igshid|li_fat_id|mc_cid|mc_eid|_hsenc|_hsmi|mkt_tok|ref_src)$/i;
// MailCheap's own pages in its emails: unsubscribing, keeping a subscription, confirming one.
const SYSTEM_PATH = /^\/(api\/)?(unsubscribe|keep|confirm)(\/|$)/;
const ANCHOR_PATTERN = /<a\b[^>]*?\shref\s*=\s*(["'])(https?:\/\/[^"'\s]+)\1[^>]*>([\s\S]*?)<\/a>/gi;
const ANCHOR_START_PATTERN = /<a\b(?=[^>]*?\shref\s*=\s*(["'])(https?:\/\/[^"'\s]+)\1)/gi;
const ALT_PATTERN = /<img\b[^>]*?\salt\s*=\s*(["'])(.*?)\1/i;
const LABEL_LENGTH = 120;

// Null for anything that isn't a web address.
export function normalizeLink(href) {
	let url;
	try {
		url = new URL(String(href ?? "").trim());
	} catch {
		return null;
	}
	if (!["http:", "https:"].includes(url.protocol)) return null;
	const params = [...url.searchParams]
		.filter(([name]) => !TRACKING_PARAM.test(name))
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	url.search = new URLSearchParams(params).toString();
	if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "") || "/";
	return url.toString();
}

// Short and stable: an email keeps the keys of the links its reader clicked (Message.clickedLinks).
export function getLinkKey(url) {
	return crypto.createHash("sha256").update(url).digest("base64url").slice(0, 16);
}

export function isSystemLink(url, appHost = getAppHost()) {
	try {
		const { host, pathname } = new URL(url);
		return host.toLowerCase() === appHost && SYSTEM_PATH.test(pathname);
	} catch {
		return true;
	}
}

// What the email shows for each of its links, by key: the link's text, or its picture's alt text. Hrefs are decoded the
// way lib/tracking.js reads them, so each key matches the clicks' own. webUrl is the issue's page, which sent emails link
// at the top as "Read online" (lib/sending-rules.js getIssueWebUrl).
export function getLinkLabels(html, { webUrl } = {}) {
	const labels = new Map();
	for (const [, , href, inner] of String(html ?? "").matchAll(ANCHOR_PATTERN)) {
		const url = normalizeLink(decodeEntities(href));
		if (!url) continue;
		const key = getLinkKey(url);
		if (!labels.get(key)) labels.set(key, getLabel(inner));
	}
	const page = webUrl && normalizeLink(webUrl);
	if (page && !labels.get(getLinkKey(page))) labels.set(getLinkKey(page), "Read online");
	return labels;
}

// For the report's preview, which shows each link's clicks on the email (components/OverlayClicks.jsx): every link that
// counts carries the key of its clicks, from its href read as its click reads it. Merge tags in an href go out unfilled
// in its tracked address (lib/sending-rules.js), so its key is the same for every reader.
export function withLinkKeys(html) {
	return String(html ?? "").replace(ANCHOR_START_PATTERN, (start, _quote, href) => {
		const url = normalizeLink(decodeHref(href));
		return url && !isSystemLink(url) ? `${start} data-link-key="${getLinkKey(url)}"` : start;
	});
}

function getLabel(inner) {
	const text = decodeEntities(inner.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
	const label = text || decodeEntities(ALT_PATTERN.exec(inner)?.[2] ?? "").trim();
	return label ? label.slice(0, LABEL_LENGTH) : null;
}