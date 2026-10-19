import { KEEP_BUTTON_LABEL } from "../last-chance-content.js";
import { escapeHtml, preheaderHtml } from "../render-email.js";

// Taco & Tell's email shell, used only when EMAIL_BRAND names that brand (lib/public-brand.js). Web fonts sit in
// @media screen, which Outlook on Windows skips: it would otherwise drop the fallbacks for Times New Roman. The mso
// block gives it Arial and Georgia, the same split as headStyles in lib/render-email.js.

function assetUrl(base, path) {
	return `${String(base ?? "").replace(/\/$/, "")}${path}`;
}

function siteLabel(brand) {
	return new URL(brand.siteUrl).host.replace(/^www\./, "");
}

// The built-in confirmation and last-chance buttons, repainted as a table so Outlook keeps the fill and the border.
// href is left exactly as written: tracking and {{confirm_url}} / {{keep_url}} are filled in after rendering.
// Outlook on Windows ignores padding on the anchor, so the cell carries mso-padding-alt. Other clients keep the
// padding already on the link; mso-padding-alt is Outlook-only and does not stack with it.
function bulletproofButton(anchor, brand) {
	const href = /\bhref="([^"]*)"/i.exec(anchor)?.[1];
	if (href == null) return anchor;
	const label = anchor.replace(/^<a\b[^>]*>/i, "").replace(/<\/a>\s*$/i, "");
	const { colors, fonts } = brand.email;
	return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr><td align="center" bgcolor="${colors.button}" style="background:${colors.button};border:2px solid ${colors.navy};border-radius:999px;color:#ffffff;mso-padding-alt:13px 28px;"><a href="${href}" style="display:inline-block;padding:13px 28px;mso-padding-alt:0;font-family:${fonts.body};font-size:17px;font-weight:800;line-height:1;color:#ffffff;text-decoration:none;border-radius:999px;">${label}</a></td></tr></table>`;
}

export function brandEmailButtons(html, brand) {
	const button = (anchor) => bulletproofButton(anchor, brand);
	// Fresh expressions each call: a shared /g pattern keeps lastIndex between renders.
	const paragraph =
		/<p>(<a\b[^>]*\bstyle="display:inline-block;background:#18181b;color:#ffffff;[^"]*border-radius:\d+px;"[^>]*>[\s\S]*?<\/a>)<\/p>/gi;
	const anchor =
		/<a\b[^>]*\bstyle="display:inline-block;background:#18181b;color:#ffffff;[^"]*border-radius:\d+px;"[^>]*>[\s\S]*?<\/a>/gi;
	return String(html ?? "")
		.replace(paragraph, (_, tag) => button(tag))
		.replace(anchor, button);
}

function fontFaceCss(brand, fontBaseUrl) {
	const { faces, dir } = brand.email.fonts;
	return faces
		.map(
			({ family, weight, file }) =>
				`@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};src:url(${assetUrl(fontBaseUrl, `${dir}/${file}`)}) format('woff2');}`
		)
		.join("");
}

function headStyles(brand, fontBaseUrl) {
	const { colors, fonts } = brand.email;
	return `<style>
@media screen { ${fontFaceCss(brand, fontBaseUrl)} }
.body a { color: ${colors.link}; text-decoration: underline; }
.body h1 { font-family: ${fonts.heading}; font-weight: 700; font-size: 30px; line-height: 1.15; color: ${colors.navy}; margin: 0 0 16px; letter-spacing: -0.015em; }
.body h2 { font-family: ${fonts.heading}; font-weight: 700; font-size: 23px; line-height: 1.2; color: ${colors.navy}; margin: 32px 0 12px; }
.body h3 { font-family: ${fonts.heading}; font-weight: 600; font-size: 19px; line-height: 1.25; color: ${colors.navy}; margin: 24px 0 8px; }
.body p, .body ul, .body ol { margin: 0 0 16px; }
.body hr { border: 0; border-top: 2px dashed ${colors.tan}; margin: 28px 0; }
.body img { max-width: 100%; height: auto; }
@media (max-width: 620px) { .px { padding-left: 20px !important; padding-right: 20px !important; } .body h1 { font-size: 26px !important; } }
[data-ogsc] .body, [data-ogsc] .body p, [data-ogsc] .body li, [data-ogsc] .body h1, [data-ogsc] .body h2, [data-ogsc] .body h3 { color: ${colors.navy} !important; }
[data-ogsc] .body a { color: ${colors.link} !important; }
[data-ogsb] body, [data-ogsb] .page { background-color: ${colors.cream} !important; }
</style>
<!--[if mso]><style>body, table, td, p, a, li { font-family: Arial, sans-serif !important; } h1, h2, h3 { font-family: Georgia, serif !important; }</style><![endif]-->`;
}

function lastChanceEnding(label) {
	return `This is the last email unless you tap “${label}” above.`;
}

function footerSentence(kind, brand) {
	const host = siteLabel(brand);
	if (kind === "confirmation") {
		return `You're getting this because someone signed up with this address at ${host}. You're not on the list until you confirm.`;
	}
	if (kind === "last-chance") {
		return `You're getting ${brand.name} because you signed up at ${host}. ${lastChanceEnding(KEEP_BUTTON_LABEL)}`;
	}
	return `You're getting ${brand.name} because you signed up at ${host}. One email, every ${brand.sendDay}.`;
}

function footerSentenceHtml(kind, brand) {
	const { colors } = brand.email;
	const host = siteLabel(brand);
	const site = `<a href="${escapeHtml(brand.siteUrl)}" style="color:${colors.muted};text-decoration:underline;">${escapeHtml(host)}</a>`;
	if (kind === "confirmation") {
		return `You're getting this because someone signed up with this address at ${site}. You're not on the list until you confirm.`;
	}
	if (kind === "last-chance") {
		return `You're getting ${escapeHtml(brand.name)} because you signed up at ${site}. ${lastChanceEnding(escapeHtml(KEEP_BUTTON_LABEL))}`;
	}
	return `You're getting ${escapeHtml(brand.name)} because you signed up at ${site}. One email, every ${escapeHtml(brand.sendDay)}.`;
}

export function brandedFooterHtml({ newsletter, unsubscribeUrl, kind, brand }) {
	const { colors, fonts } = brand.email;
	const address = newsletter?.postalAddress
		? `${escapeHtml(brand.name)} &middot; ${escapeHtml(newsletter.postalAddress)}`
		: escapeHtml(brand.name);
	const pastIssues =
		kind === "confirmation"
			? ""
			: ` &middot; <a href="${escapeHtml(brand.issuesUrl)}" style="color:${colors.muted};text-decoration:underline;">Past issues</a>`;
	return `<tr><td class="px" align="center" bgcolor="${colors.cream}" style="padding:20px 24px 8px;background:${colors.cream};font-family:${fonts.body};font-size:12px;line-height:1.6;font-weight:400;color:${colors.muted};text-align:center;">
${footerSentenceHtml(kind, brand)}<br>
<a href="${unsubscribeUrl}" style="color:${colors.muted};text-decoration:underline;">Unsubscribe</a>${pastIssues}<br>
${address}
</td></tr>`;
}

export function brandedFooterText({ newsletter, unsubscribeUrl, kind, brand }) {
	return ["—", footerSentence(kind, brand), `Unsubscribe: ${unsubscribeUrl}`, newsletter?.postalAddress].filter(Boolean).join("\n");
}

export function wrapBrandedBody({
	bodyHtml,
	subject,
	previewText,
	footer,
	webUrl,
	brand,
	kind = "campaign",
	fontBaseUrl = "",
	newsletter,
	unsubscribeUrl,
}) {
	const { colors, fonts } = brand.email;
	const footerRow = footer ?? brandedFooterHtml({ newsletter, unsubscribeUrl, kind, brand });
	const readOnline = webUrl
		? `<tr><td align="right" bgcolor="${colors.cream}" style="padding:0 4px 10px;background:${colors.cream};font-family:${fonts.body};font-size:12px;line-height:1;color:${colors.muted};"><a href="${escapeHtml(webUrl)}" style="color:${colors.muted};text-decoration:none;">Read online</a></td></tr>\n`
		: "";
	const badge = assetUrl(fontBaseUrl, brand.email.badgePath);
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(subject)}</title>
${headStyles(brand, fontBaseUrl)}
</head>
<body class="page" style="margin:0;padding:0;background:${colors.cream};" bgcolor="${colors.cream}">
${preheaderHtml(previewText)}
<table role="presentation" class="page" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${colors.cream};" bgcolor="${colors.cream}">
<tr><td align="center" bgcolor="${colors.cream}" style="padding:24px 12px;background:${colors.cream};">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
${readOnline}<tr><td style="background:${colors.paper};border:2px solid ${colors.navy};border-radius:16px;overflow:hidden;" bgcolor="${colors.paper}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td height="8" bgcolor="${colors.coral}" style="height:8px;line-height:8px;font-size:0;background:${colors.coral};border-radius:14px 14px 0 0;">&nbsp;</td></tr>
<tr><td align="center" class="px" bgcolor="${colors.paper}" style="padding:24px 40px 8px;background:${colors.paper};">
<a href="${escapeHtml(brand.siteUrl)}" style="text-decoration:none;"><img src="${escapeHtml(badge)}" width="88" height="88" alt="${escapeHtml(brand.name)}" style="display:block;border:0;width:88px;height:88px;font-family:${fonts.display};font-size:22px;font-weight:400;line-height:1.2;color:${colors.coral};"></a>
</td></tr>
<tr><td align="center" class="px" bgcolor="${colors.paper}" style="padding:0 40px 20px;background:${colors.paper};font-family:${fonts.body};font-size:12px;line-height:1.4;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${colors.navy};">${escapeHtml(brand.email.tagline)}</td></tr>
<tr><td class="px body" bgcolor="${colors.paper}" style="padding:4px 40px 16px;background:${colors.paper};font-family:${fonts.body};font-size:17px;line-height:1.6;color:${colors.navy};">
${bodyHtml}
</td></tr>
</table>
</td></tr>
${footerRow}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}
