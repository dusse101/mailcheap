import { formatNumber, formatSigned } from "./format.js";
import { formatLinkUrl } from "./link-stats.js";
import { SUMMARY_HOUR } from "./summary.js";

// The summary email itself: the dashboard's overview in a few lines, light and quiet, built from tables and inline
// styles so Gmail, Apple Mail and Outlook all draw it, with a dark version for the apps that ask for one. Pure: the
// job sends it, the account page previews it and tests read it.

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const COLORS = {
	page: "#fafafa",
	card: "#ffffff",
	border: "#e9e9eb",
	rule: "#f0f0f1",
	text: "#18181b",
	soft: "#52525b",
	muted: "#71717a",
	faint: "#a1a1aa",
	panel: "#f7f7f8",
	bar: "#e4e4e7",
	up: "#15803d",
};
const CHART_HEIGHT = 64;
const MAX_LINK_LENGTH = 44;
const WEB_URL = /^https?:\/\//i;
const MONTH_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const WEEKDAY_MONTH_DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

function escapeHtml(value) {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function toDate(dateKey) {
	const [year, month, day] = dateKey.split("-").map(Number);
	return new Date(Date.UTC(year, month - 1, day));
}

// "Oct 12 – 18", or "Sep 28 – Oct 4" across two months.
export function formatPeriodLabel({ frequency, startKey, lastKey }) {
	if (frequency === "daily") return WEEKDAY_MONTH_DAY.format(toDate(lastKey));
	const start = toDate(startKey);
	const last = toDate(lastKey);
	const sameMonth = MONTH.format(start) === MONTH.format(last);
	return `${MONTH_DAY.format(start)} – ${sameMonth ? last.getUTCDate() : MONTH_DAY.format(last)}`;
}

function plural(count, noun) {
	return `${noun}${count === 1 ? "" : "s"}`;
}

function formatShare(part, total) {
	return total ? `${((part / total) * 100).toFixed(1)}%` : "–";
}

function formatPointsText(delta) {
	const points = Number((delta * 100).toFixed(1));
	if (points === 0) return "Same as your average";
	return `${points > 0 ? "+" : "−"}${Math.abs(points).toFixed(1)} pts vs your average`;
}

// "+4 vs last week", with rises in green: the other changes say the number without judging it. before: "last week", or
// "the day before".
function describeCountChange(current, previous, before) {
	if (previous === null || previous === undefined) return { text: "", isUp: false };
	const difference = current - previous;
	if (difference === 0) return { text: `Same as ${before}`, isUp: false };
	return { text: `${formatSigned(difference)} vs ${before}`, isUp: difference > 0 };
}

function describeGrowth(total, previousTotal) {
	if (!previousTotal || total === previousTotal) return { text: total === previousTotal ? "No change" : "", isUp: false };
	const change = ((total - previousTotal) / previousTotal) * 100;
	const rounded = Math.abs(change) < 0.1 ? change.toFixed(2) : change.toFixed(1);
	return { text: `${change > 0 ? "+" : "−"}${Math.abs(Number(rounded))}%`, isUp: change > 0 };
}

function shortenLink(url) {
	const text = formatLinkUrl(url);
	return text.length > MAX_LINK_LENGTH ? `${text.slice(0, MAX_LINK_LENGTH - 1)}…` : text;
}

function headline(joined) {
	return joined > 0 ? `${formatSigned(joined)} ${plural(joined, "subscriber")}` : "No new subscribers";
}

export function getSummarySubject({ frequency, newsletter }) {
	const { joined } = newsletter.subscribers;
	const when = frequency === "daily" ? "yesterday" : "this week";
	return joined > 0
		? `${newsletter.name}: ${formatSigned(joined)} ${plural(joined, "subscriber")} ${when}`
		: `${newsletter.name}: no new subscribers ${when}`;
}

function stat({ label, value, change }) {
	return `<td class="stat" width="33%" valign="top" style="padding:20px 12px 0 0;vertical-align:top">
		<div class="muted" style="font-size:12px;line-height:16px;color:${COLORS.muted}">${escapeHtml(label)}</div>
		<div class="fg num" style="margin-top:4px;font-size:24px;line-height:30px;font-weight:600;letter-spacing:-0.02em;color:${COLORS.text};font-variant-numeric:tabular-nums">${escapeHtml(value)}</div>
		<div class="${change.isUp ? "up" : "muted"}" style="margin-top:2px;font-size:12px;line-height:16px;color:${change.isUp ? COLORS.up : COLORS.muted};font-variant-numeric:tabular-nums">${escapeHtml(change.text) || "&nbsp;"}</div>
	</td>`;
}

function renderChart({ frequency, bars }) {
	const max = Math.max(...bars.map(({ joined }) => joined), 0);
	const cells = bars
		.map((bar, index) => {
			const isLast = index === bars.length - 1;
			const height = max ? Math.max(3, Math.round((bar.joined / max) * CHART_HEIGHT)) : 3;
			const color = isLast ? COLORS.text : COLORS.bar;
			return `<td valign="bottom" style="height:${CHART_HEIGHT}px;padding:0 ${bars.length > 10 ? 2 : 4}px;vertical-align:bottom">
				<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="${isLast ? "bar-now" : "bar"}" height="${height}" bgcolor="${color}" style="height:${height}px;line-height:${height}px;font-size:0;background-color:${color};border-radius:3px 3px 1px 1px">&nbsp;</td></tr></table>
			</td>`;
		})
		.join("");
	const span = frequency === "daily" ? `Last ${bars.length} days` : `Last ${bars.length} weeks`;
	const label = bars.map(({ joined }) => joined).join(", ");
	return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:32px">
		<tr>
			<td class="fg" style="font-size:13px;line-height:18px;font-weight:500;color:${COLORS.text}">New subscribers</td>
			<td class="muted" align="right" style="font-size:12px;line-height:18px;color:${COLORS.muted}">${span}</td>
		</tr>
	</table>
	<table role="img" aria-label="New subscribers per ${frequency === "daily" ? "day" : "week"}: ${label}" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;table-layout:fixed"><tr>${cells}</tr></table>
	<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px">
		<tr>
			<td class="faint" style="font-size:11px;line-height:14px;color:${COLORS.faint}">${escapeHtml(MONTH_DAY.format(toDate(bars[0].startKey)))}</td>
			<td class="faint" align="right" style="font-size:11px;line-height:14px;color:${COLORS.faint}">${frequency === "daily" ? "Yesterday" : "This week"}</td>
		</tr>
	</table>`;
}

function rate(label, value, delta) {
	const isUp = delta !== null && delta !== undefined && Number((delta * 100).toFixed(1)) > 0;
	const note = delta === null || delta === undefined ? "" : formatPointsText(delta);
	return `<td width="50%" valign="top" style="padding-top:14px;vertical-align:top">
		<div class="muted" style="font-size:12px;line-height:16px;color:${COLORS.muted}">${label}</div>
		<div class="fg num" style="margin-top:2px;font-size:20px;line-height:26px;font-weight:600;letter-spacing:-0.02em;color:${COLORS.text};font-variant-numeric:tabular-nums">${value}</div>
		<div class="${isUp ? "up" : "muted"}" style="font-size:12px;line-height:16px;color:${isUp ? COLORS.up : COLORS.muted}">${escapeHtml(note) || "&nbsp;"}</div>
	</td>`;
}

function renderIssue(issue, campaignUrl) {
	const dateText = MONTH_DAY.format(new Date(issue.startedAt));
	const comparison = issue.isSettled ? issue.comparison : null;
	const topLink =
		issue.topLink && WEB_URL.test(issue.topLink.url)
			? `<tr><td colspan="2" class="soft" style="padding-top:14px;font-size:13px;line-height:18px;color:${COLORS.soft}">Most clicked: <a href="${escapeHtml(issue.topLink.url)}" class="fg" style="color:${COLORS.text};text-decoration:underline;text-underline-offset:2px">${escapeHtml(shortenLink(issue.topLink.url))}</a> <span class="muted" style="color:${COLORS.muted}">· ${formatNumber(issue.topLink.clickers)} ${issue.topLink.clickers === 1 ? "person" : "people"}</span></td></tr>`
			: "";
	return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:32px">
		<tr><td class="panel" bgcolor="${COLORS.panel}" style="background-color:${COLORS.panel};border-radius:12px;padding:18px 20px">
			<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
				<tr>
					<td class="muted" style="font-size:12px;line-height:16px;color:${COLORS.muted}">${issue.isInPeriod ? "Sent" : "Latest issue"} · ${escapeHtml(dateText)}${issue.isSettled ? "" : " · so far"}</td>
					<td align="right" style="font-size:12px;line-height:16px"><a href="${escapeHtml(campaignUrl)}" class="muted" style="color:${COLORS.muted};text-decoration:none">Report &rarr;</a></td>
				</tr>
				<tr><td colspan="2" style="padding-top:4px"><a href="${escapeHtml(campaignUrl)}" class="fg" style="font-size:15px;line-height:21px;font-weight:600;color:${COLORS.text};text-decoration:none">${escapeHtml(issue.subject || "Untitled")}</a></td></tr>
				<tr>
					${rate("Opened", formatShare(issue.opened, issue.reached), comparison?.opened)}
					${rate("Clicked", formatShare(issue.clicked, issue.reached), comparison?.clicked)}
				</tr>
				${topLink}
			</table>
		</td></tr>
	</table>`;
}

function renderOthers(others, frequency) {
	if (!others.length) return "";
	const when = frequency === "daily" ? "yesterday" : "this week";
	const rows = others
		.map(
			(newsletter) => `<tr>
				<td class="line" style="padding:12px 0;border-top:1px solid ${COLORS.rule}"><a href="${escapeHtml(newsletter.url)}" class="fg" style="font-size:14px;line-height:20px;font-weight:500;color:${COLORS.text};text-decoration:none">${escapeHtml(newsletter.name)}</a></td>
				<td class="line muted num" align="right" style="padding:12px 0;border-top:1px solid ${COLORS.rule};font-size:13px;line-height:20px;color:${COLORS.muted};font-variant-numeric:tabular-nums;white-space:nowrap">${formatSigned(newsletter.subscribers.joined)} ${when}<span style="padding:0 6px">·</span><span class="fg" style="color:${COLORS.text}">${formatNumber(newsletter.subscribers.total)}</span></td>
			</tr>`
		)
		.join("");
	return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:32px">
		<tr><td colspan="2" class="fg" style="padding-bottom:4px;font-size:13px;line-height:18px;font-weight:500;color:${COLORS.text}">Your other newsletters</td></tr>
		${rows}
	</table>`;
}

const DARK_STYLES = `
	:root { color-scheme: light dark; supported-color-schemes: light dark; }
	@media (prefers-color-scheme: dark) {
		.page { background-color: #0a0a0a !important; }
		.card { background-color: #141415 !important; border-color: #27272a !important; }
		.panel { background-color: #1c1c1e !important; }
		.fg, .fg a { color: #fafafa !important; }
		.soft { color: #d4d4d8 !important; }
		.muted, .muted a { color: #a1a1aa !important; }
		.faint { color: #71717a !important; }
		.up { color: #4ade80 !important; }
		.line { border-color: #27272a !important; }
		.bar { background-color: #3f3f46 !important; }
		.bar-now { background-color: #fafafa !important; }
		.button { background-color: #fafafa !important; }
		.button a { color: #0a0a0a !important; }
	}
	@media (max-width: 520px) {
		.card { padding: 26px 20px 24px !important; }
		.hero { font-size: 32px !important; line-height: 38px !important; }
		.stat .num { font-size: 20px !important; line-height: 26px !important; }
	}
`;

// The newsletter with the most subscribers first, in full; the others in a line each.
export function renderSummaryEmail({ frequency, period, newsletters, links, postalAddress }) {
	const [main, ...others] = newsletters;
	const { subscribers } = main;
	const shareLabel = frequency === "daily" ? "Share yesterday" : "Share this week";
	const periodLabel = formatPeriodLabel({ frequency, ...period });
	const subject = getSummarySubject({ frequency, newsletter: main });
	const previewText = `${formatNumber(subscribers.total)} ${plural(subscribers.total, "subscriber")}. ${main.line}`;
	const schedule = frequency === "daily" ? `every morning at ${SUMMARY_HOUR} AM` : `every Monday at ${SUMMARY_HOUR} AM`;
	const growth = describeGrowth(subscribers.total, subscribers.previousTotal);
	const before = frequency === "daily" ? "the day before" : "last week";
	const joinedChange = describeCountChange(subscribers.joined, subscribers.previousJoined, before);
	const unsubscribedChange = describeCountChange(main.unsubscribed, main.previousUnsubscribed, before);

	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(subject)}</title>
<style>${DARK_STYLES}</style>
</head>
<body class="page" style="margin:0;padding:0;background-color:${COLORS.page};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(previewText)}${"&#8199;&#65279;&#847; ".repeat(40)}</div>
<table role="presentation" class="page" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.page}" style="background-color:${COLORS.page}">
<tr><td align="center" style="padding:32px 12px 40px">
	<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;font-family:${FONT}">
		<tr><td style="padding:0 4px 18px">
			<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
				<tr>
					<td valign="middle" style="vertical-align:middle">
						<a href="${escapeHtml(links.appUrl)}" style="text-decoration:none"><img src="${escapeHtml(links.logoUrl)}" width="22" height="22" alt="" style="display:inline-block;vertical-align:middle;border:0;border-radius:6px;background-color:#ffffff"><span class="fg" style="display:inline-block;vertical-align:middle;padding-left:8px;font-size:15px;line-height:22px;font-weight:600;letter-spacing:-0.01em;color:${COLORS.text}">MailCheap</span></a>
					</td>
					<td class="muted" align="right" valign="middle" style="vertical-align:middle;font-size:13px;line-height:22px;color:${COLORS.muted}">${escapeHtml(periodLabel)}</td>
				</tr>
			</table>
		</td></tr>
		<tr><td class="card" bgcolor="${COLORS.card}" style="background-color:${COLORS.card};border:1px solid ${COLORS.border};border-radius:16px;padding:32px 32px 30px">
			<div class="muted" style="font-size:13px;line-height:18px;color:${COLORS.muted}">${frequency === "daily" ? "Yesterday" : "Your week"} · ${escapeHtml(main.name)}</div>
			<div class="fg hero" style="margin-top:6px;font-size:40px;line-height:46px;font-weight:600;letter-spacing:-0.035em;color:${COLORS.text};font-variant-numeric:tabular-nums">${escapeHtml(headline(subscribers.joined))}</div>
			<div class="soft" style="margin-top:10px;font-size:15px;line-height:22px;color:${COLORS.soft}">${escapeHtml(main.line)}</div>

			<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px">
				<tr><td colspan="3" class="line" style="border-top:1px solid ${COLORS.rule};font-size:0;line-height:0">&nbsp;</td></tr>
				<tr>
					${stat({ label: "Subscribers", value: formatNumber(subscribers.total), change: growth })}
					${stat({ label: "New", value: formatNumber(subscribers.joined), change: joinedChange })}
					${stat({ label: "Unsubscribed", value: formatNumber(main.unsubscribed), change: { ...unsubscribedChange, isUp: false } })}
				</tr>
			</table>

			${subscribers.bars.length ? renderChart({ frequency, bars: subscribers.bars }) : ""}
			${main.issue ? renderIssue(main.issue, links.campaignUrl) : ""}
			${renderOthers(others, frequency)}

			<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:32px">
				<tr>
					<td class="button" bgcolor="${COLORS.text}" style="background-color:${COLORS.text};border-radius:10px">
						<a href="${escapeHtml(links.dashboardUrl)}" style="display:inline-block;padding:11px 18px;font-size:14px;line-height:20px;font-weight:500;color:#ffffff;text-decoration:none">Open dashboard</a>
					</td>
					${links.shareUrl ? `<td style="padding-left:18px"><a href="${escapeHtml(links.shareUrl)}" class="fg" style="font-size:14px;line-height:20px;font-weight:500;color:${COLORS.text};text-decoration:underline;text-underline-offset:3px">${shareLabel}</a></td>` : ""}
				</tr>
			</table>
		</td></tr>
		<tr><td class="faint" style="padding:22px 4px 0;font-size:12px;line-height:18px;color:${COLORS.faint}">
			You get this summary ${schedule} because summaries are on for your MailCheap account. <a href="${escapeHtml(links.settingsUrl)}" class="muted" style="color:${COLORS.muted};text-decoration:underline">Change how often</a> or <a href="${escapeHtml(links.settingsUrl)}" class="muted" style="color:${COLORS.muted};text-decoration:underline">turn it off</a>.${postalAddress ? `<br><br>MailCheap · ${escapeHtml(postalAddress)}` : ""}
		</td></tr>
	</table>
</td></tr>
</table>
</body>
</html>`;

	const text = [
		`${frequency === "daily" ? "Yesterday" : "Your week"} · ${main.name} · ${periodLabel}`,
		"",
		headline(subscribers.joined),
		main.line,
		"",
		`Subscribers: ${formatNumber(subscribers.total)}${growth.text ? ` (${growth.text})` : ""}`,
		`New: ${formatNumber(subscribers.joined)}${joinedChange.text ? ` (${joinedChange.text})` : ""}`,
		`Unsubscribed: ${formatNumber(main.unsubscribed)}`,
		...(main.issue
			? [
					"",
					`${main.issue.isInPeriod ? "Sent" : "Latest issue"}: ${main.issue.subject || "Untitled"}`,
					`Opened ${formatShare(main.issue.opened, main.issue.reached)} · Clicked ${formatShare(main.issue.clicked, main.issue.reached)}`,
					...(main.issue.topLink ? [`Most clicked: ${formatLinkUrl(main.issue.topLink.url)}`] : []),
				]
			: []),
		...others.map((newsletter) => `${newsletter.name}: ${formatSigned(newsletter.subscribers.joined)}, ${formatNumber(newsletter.subscribers.total)} subscribers`),
		"",
		`Open dashboard: ${links.dashboardUrl}`,
		...(links.shareUrl ? [`${shareLabel}: ${links.shareUrl}`] : []),
		"",
		`You get this summary ${schedule} because summaries are on for your MailCheap account.`,
		`Change how often or turn it off: ${links.settingsUrl}`,
		...(postalAddress ? ["", `MailCheap · ${postalAddress}`] : []),
	].join("\n");

	return {
		subject,
		previewText,
		html,
		text,
		// One-click unsubscribe (RFC 8058): mail apps show an Unsubscribe button that posts here.
		headers: { "List-Unsubscribe": `<${links.oneClickUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
	};
}
