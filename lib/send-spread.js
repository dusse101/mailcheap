import { SENDER_WARMUP, isCloud } from "./config.js";
import { formatCount } from "./format.js";

// A send goes out in batches of this many, one QStash job each.
export const SEND_BATCH_SIZE = 50;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// A sending domain whose Gmail readers are held back (SENDER_WARMUP, BACKOFF): its day, how far into it, the wait before a
// back-off's days begin, its first day's Gmail emails, how many days, whether each day's emails spread over it (after a
// back-off) or go at its start (a new domain), the Gmail emails it sent since its day began and the ones the account's
// other sends from it still have to send, whether it started, and the domain. null once its days are over, and on a
// self-hosted server. From lib/sender-warmup.js; without startedAt, the send starts it.
export function getSenderPace(
	{ startedAt = null, firstDay = SENDER_WARMUP.gmailFirstDay, days = 1, isGradual = false, sentToday = 0, inFlight = 0, domain = null } = {},
	{ now = new Date(), env = process.env } = {}
) {
	if (!isCloud(env) || !(days >= 1)) return null;
	const elapsedMs = startedAt ? now.getTime() - new Date(startedAt).getTime() : 0;
	if (elapsedMs >= days * DAY_MS) return null;
	const intoMs = Math.max(0, elapsedMs);
	return {
		day: Math.floor(intoMs / DAY_MS) + 1,
		intoDayMs: intoMs % DAY_MS,
		waitMs: Math.max(0, -elapsedMs),
		firstDay,
		days,
		isGradual,
		sentToday: elapsedMs > 0 ? sentToday : 0,
		inFlight,
		hasStarted: Boolean(startedAt),
		domain,
	};
}

// Where the domain's current day began, for the Gmail emails it sent since: its start while a back-off waits.
export function getSenderDayStart(startedAt, now = new Date()) {
	const elapsedMs = now.getTime() - new Date(startedAt).getTime();
	return new Date(new Date(startedAt).getTime() + Math.max(0, Math.floor(elapsedMs / DAY_MS)) * DAY_MS);
}

// The Gmail emails a domain sends on one of its days: twice as many as the day before.
export function getSenderDayEmails(sender, day = sender.day) {
	return sender.firstDay * 2 ** (day - 1);
}

// How much of each day the domain's Gmail emails can use: the rest of today, then whole days.
function getDayCapacity(sender, day) {
	const emails = getSenderDayEmails(sender, day);
	return sender.isGradual && day === sender.day ? (emails * (DAY_MS - sender.intoDayMs)) / DAY_MS : emails;
}

// When the Gmail email after a send's first `emails` Gmail ones may go, in ms from now: after the ones the domain already
// sent today and the account's other sends from it still have to send. A new domain's day goes at its start; after a
// back-off, each day's emails spread evenly over it. Once its days are over, the rest goes at once.
export function getSenderMs(sender, emails) {
	if (!sender) return 0;
	let ms = sender.waitMs;
	let dayLeftMs = DAY_MS - sender.intoDayMs;
	if (sender.isGradual) {
		let left = sender.inFlight + emails;
		for (let day = sender.day; left > 0 && day <= sender.days; day++) {
			const dayEmails = getSenderDayEmails(sender, day);
			const room = getDayCapacity(sender, day);
			if (left <= room) return ms + (left * DAY_MS) / dayEmails;
			left -= room;
			ms += dayLeftMs;
			dayLeftMs = DAY_MS;
		}
		return ms;
	}
	let left = sender.sentToday + sender.inFlight + emails;
	for (let day = sender.day; day <= sender.days; day++) {
		const dayEmails = getSenderDayEmails(sender, day);
		if (left < dayEmails) return ms;
		left -= dayEmails;
		ms += dayLeftMs;
		dayLeftMs = DAY_MS;
	}
	return ms;
}

// When each batch of a send's Gmail readers may start, in Unix seconds: null for right away.
export function getGmailBatchStarts(count, sender, now = Date.now()) {
	return Array.from({ length: count }, (_, index) => {
		const ms = getSenderMs(sender, index * SEND_BATCH_SIZE);
		return ms ? Math.floor((now + ms) / 1000) : null;
	});
}

// How a send's Gmail readers share out over the domain's days, for the dashboard: [today, tomorrow, …], after the ones the
// domain already sent today and the account's other sends from it still have to send. null when they all go today.
export function getGmailDays(sender, gmailEmails) {
	if (!sender || !(gmailEmails > 0)) return null;
	const counts = [];
	let before = (sender.isGradual ? 0 : sender.sentToday) + sender.inFlight;
	let left = gmailEmails;
	for (let day = sender.day; left > 0 && day <= sender.days; day++) {
		const capacity = Math.floor(getDayCapacity(sender, day));
		const taken = Math.min(before, capacity);
		before -= taken;
		const count = Math.min(left, capacity - taken);
		counts.push(count);
		left -= count;
	}
	if (left > 0) counts.push(left);
	return counts.length > 1 || sender.waitMs > 0 ? counts : null;
}

// What the dashboard needs to tell how a send goes out: the domain its newsletter sends from, when Gmail holds it back.
// null on a self-hosted server, which sends at full speed. sender: from getSenderVolumes (lib/sender-warmup.js).
export function getPace({ sender = null, now = new Date(), env = process.env } = {}) {
	if (!isCloud(env)) return null;
	return { sender: sender && getSenderPace(sender, { now, env }) };
}

// A wait as the dashboard says it: minutes under an hour, hours under two days, then days.
export function formatPaceTime(hours) {
	if (hours < 1) return formatCount(Math.max(1, Math.round(hours * 60)), "minute");
	return hours >= 48 ? `about ${formatCount(Math.round(hours / 24), "day")}` : formatCount(Math.round(hours), "hour");
}
