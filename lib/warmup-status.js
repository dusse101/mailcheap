import { BACKOFF, FIRST_SEND } from "./config.js";
import { formatCount, formatNumber } from "./format.js";
import { formatPaceTime, getGmailDays } from "./send-spread.js";

const HOUR_MS = 60 * 60 * 1000;

// Why each section of the pace notice (components/NoticeWarmup.jsx) is there, and when it stops. Its link says more.
export const STEPS_WHY =
	"To keep your emails out of spam, a small part of your new contacts gets it first, to check the addresses work and the readers want it. It's only the first time: your next issues go to them at once.";
export const GMAIL_WHY = "Gmail is careful with the first emails from a new domain, so a little at a time keeps them out of spam.";
export const BACKOFF_WHY = `Waiting protects your reputation with Gmail. Resuming earlier still waits for those ${BACKOFF.hours} hours.`;

// Steps are capped (FIRST_SEND), so on a large list the first one is a fraction of a percent.
function formatShare(part, total) {
	const percent = (part / total) * 100;
	if (percent >= 1) return `${Math.round(percent)}%`;
	return percent < 0.1 ? "under 0.1%" : `${Number(percent.toFixed(1))}%`;
}

// A first send's steps (lib/first-send.js) as the notice lists them: how many each sends, its share of the new
// contacts, and when. step: how many went out; nextAt: when the next one's check runs.
export function getStepItems(steps, { step = 0, nextAt = null, now = Date.now() } = {}) {
	const total = steps.reduce((sum, size) => sum + size, 0);
	const wait = formatCount(FIRST_SEND.waitMinutes, "minute");
	return steps.map((size, index) => {
		const count = formatNumber(size);
		const when =
			index === step && nextAt
				? `in about ${formatPaceTime(Math.max(0, new Date(nextAt).getTime() - now) / HOUR_MS)}`
				: `${wait} ${index === 1 ? "later" : "after that"}`;
		const text =
			index === 0
				? `${count} first (${formatShare(size, total)})`
				: index === steps.length - 1
					? `The other ${count}, ${when}`
					: `${count} more (${formatShare(size, total)}), ${when}`;
		return { text, state: index < step ? "done" : index === step ? "current" : "next" };
	});
}

function formatIn(hours) {
	return hours >= 48 ? `in ${formatPaceTime(hours)}` : `in about ${formatPaceTime(hours)}`;
}

// A send's Gmail readers its new domain sends a later day, once it's going out (lib/sending.js markSendAfter): how many,
// and when the first of them goes.
export function getGmailLaterTrack({ domain = null, later, laterAt, now = Date.now() }) {
	const hours = Math.max(0, new Date(laterAt).getTime() - now) / HOUR_MS;
	return {
		label: domain ?? "This newsletter's domain",
		domain,
		day: 1,
		days: 2,
		isStepped: true,
		now: `The other ${formatNumber(later)} Gmail readers get it ${formatIn(hours)}.`,
		next: null,
	};
}

// A domain that holds Gmail's readers back (lib/send-spread.js) as a track of the notice: how many get a send today and
// how many later. null when they all get it today.
export function getGmailTrack(sender, gmailEmails) {
	const counts = getGmailDays(sender, gmailEmails);
	if (!counts) return null;
	const [first, ...later] = counts;
	const rest = later.reduce((sum, count) => sum + count, 0);
	const track = {
		label: sender.domain ?? "This newsletter's domain",
		domain: sender.domain,
		day: sender.hasStarted && !sender.waitMs ? sender.day : 0,
		// A back-off's days, or a new domain's first day and the next.
		days: sender.isGradual ? sender.days : sender.days + 1,
		isStepped: true,
	};
	const then = later.length > 1 ? `over the next ${formatCount(later.length, "day")}` : "tomorrow";
	if (sender.waitMs > 0) {
		const hours = formatCount(Math.ceil(sender.waitMs / HOUR_MS), "hour");
		return { ...track, now: `Gmail gets it again in ${hours}: ${formatNumber(first)} of your Gmail readers that day.`, next: rest ? `the other ${formatNumber(rest)} ${then}.` : null };
	}
	if (first === 0) return { ...track, now: `Your ${formatNumber(rest)} Gmail readers get it ${then}.`, next: null };
	return { ...track, now: `${formatNumber(first)} of your ${formatNumber(gmailEmails)} Gmail readers today.`, next: `the other ${formatNumber(rest)} ${then}.` };
}
