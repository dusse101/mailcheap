import { isBlocked, isDeletionPending } from "./account-state.js";
import { isCloud } from "./config.js";
import { formatNumber } from "./format.js";
import { isPaidStatus } from "./plans.js";
import { hourIn, shiftDateKey, startOfDateKey, toDateKey } from "./time-zone.js";

// The summary email: one newsletter's numbers, every morning or every Monday in its owner's timezone, for a paying
// account. Each newsletter has its own (notifications.summary). What's due when, who gets it and the line it opens with
// are worked out here, apart from the database, so tests can check them.

export const SUMMARY_FREQUENCIES = ["daily", "weekly", "off"];
export const DEFAULT_SUMMARY_FREQUENCY = "weekly";
// The local hour it goes out. The hourly cron runs a few more times after it, which send one a missed run left behind.
export const SUMMARY_HOUR = 8;
const SEND_WINDOW_HOURS = 4;
const MONDAY = 1;
// Bars in the email's chart: two weeks of days, or eight weeks.
export const SUMMARY_BARS = { daily: 14, weekly: 8 };
const MILESTONES = [100, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];
// An issue whose open rate beats the newsletter's average by this much gets the email's line.
const ABOVE_AVERAGE = 0.02;
const GROWTH_RATE = 0.05;
const STREAK = 3;
const KEY_PATTERN = /^(daily|weekly):(\d{4}-\d{2}-\d{2})$/;

export function getSummaryFrequency(newsletter) {
	const frequency = newsletter?.notifications?.summary;
	return SUMMARY_FREQUENCIES.includes(frequency) ? frequency : DEFAULT_SUMMARY_FREQUENCY;
}

// MailCheap Cloud accounts that pay for a plan. Not a free plan an admin gave, a blocked account or one waiting to be
// deleted, and never a self-hosted server.
export function isSummaryEligible(account, env = process.env) {
	return isCloud(env) && isPaidStatus(account?.subscriptionStatus) && !isBlocked(account) && !isDeletionPending(account);
}

// 1 for Monday, as Date#getUTCDay counts.
function weekdayOf(dateKey) {
	const [year, month, day] = dateKey.split("-").map(Number);
	return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

// What a summary sent on todayKey covers: yesterday, or the seven days before Monday, and the period before for the
// comparisons. key names it once per newsletter and period, so a retried job never sends it twice.
export function getSummaryPeriod({ frequency, todayKey, timeZone }) {
	const days = frequency === "daily" ? 1 : 7;
	const startKey = shiftDateKey(todayKey, -days);
	return {
		frequency,
		days,
		timeZone,
		key: `${frequency}:${todayKey}`,
		startKey,
		lastKey: shiftDateKey(todayKey, -1),
		start: startOfDateKey(startKey, timeZone),
		end: startOfDateKey(todayKey, timeZone),
		previousStart: startOfDateKey(shiftDateKey(startKey, -days), timeZone),
	};
}

// The summary due at now in the owner's timezone, or null: from 8 AM, every day or on Mondays.
export function getDueSummary({ frequency, timeZone, now = new Date() }) {
	if (frequency !== "daily" && frequency !== "weekly") return null;
	const hour = hourIn(now, timeZone);
	if (hour < SUMMARY_HOUR || hour >= SUMMARY_HOUR + SEND_WINDOW_HOURS) return null;
	const todayKey = toDateKey(now, timeZone);
	if (frequency === "weekly" && weekdayOf(todayKey) !== MONDAY) return null;
	return getSummaryPeriod({ frequency, todayKey, timeZone });
}

// The last whole period, for a preview and the API: yesterday, or the week before the latest Monday.
export function getLatestSummaryPeriod({ frequency, timeZone, now = new Date() }) {
	const todayKey = toDateKey(now, timeZone);
	if (frequency === "daily") return getSummaryPeriod({ frequency, todayKey, timeZone });
	const daysSinceMonday = (weekdayOf(todayKey) - MONDAY + 7) % 7;
	return getSummaryPeriod({ frequency: "weekly", todayKey: shiftDateKey(todayKey, -daysSinceMonday), timeZone });
}

export function parseSummaryKey(key) {
	const match = KEY_PATTERN.exec(String(key ?? ""));
	return match ? { frequency: match[1], todayKey: match[2] } : null;
}

function sum(values) {
	return values.reduce((total, value) => total + value, 0);
}

// The period's numbers from the overview's subscriber days (lib/overview-data.js getSubscriberHistory), oldest first
// and ending with the period's last day, and the chart's bars: one per day or per week.
export function summarizeSubscribers(days, frequency) {
	const size = frequency === "daily" ? 1 : 7;
	const bars = [];
	for (let index = 0; index < SUMMARY_BARS[frequency]; index++) {
		const end = days.length - index * size;
		if (end - size < 0) break;
		const slice = days.slice(end - size, end);
		bars.unshift({
			startKey: slice[0].key,
			endKey: slice.at(-1).key,
			joined: sum(slice.map(({ joined }) => joined)),
			left: sum(slice.map(({ left }) => left)),
		});
	}
	const current = bars.at(-1) ?? { joined: 0, left: 0 };
	const total = days.at(-1)?.total ?? 0;
	return {
		joined: current.joined,
		left: current.left,
		total,
		previousTotal: total - current.joined + current.left,
		previousJoined: bars.length > 1 ? bars.at(-2).joined : null,
		bars,
	};
}

function people(count) {
	return count === 1 ? "1 person" : `${formatNumber(count)} people`;
}

// Weeks or days in a row, counting back from this one, when more people joined than left.
function countStreak(bars) {
	let streak = 0;
	for (let index = bars.length - 1; index >= 0 && bars[index].joined > bars[index].left; index--) streak++;
	return streak;
}

// The line the email opens with: the one thing worth saying about the numbers, first match wins. Facts only.
export function getSummaryLine({ frequency, subscribers, issue }) {
	const { joined, left, total, previousTotal, previousJoined, bars } = subscribers;
	const isDaily = frequency === "daily";
	const when = isDaily ? "yesterday" : "this week";
	const unit = isDaily ? "day" : "week";

	const milestone = MILESTONES.filter((value) => previousTotal < value && total >= value).at(-1);
	if (milestone) return `You passed ${formatNumber(milestone)} subscribers ${when}.`;
	if (joined > 0 && total <= 10) return `Every list starts here: ${people(joined)} joined ${when}.`;
	const earlier = bars.slice(0, -1);
	if (joined > 0 && earlier.length >= 3 && earlier.every((bar) => joined > bar.joined)) {
		return `More people joined ${when} than in any ${unit} of the last ${isDaily ? "two weeks" : "two months"}.`;
	}
	const streak = countStreak(bars);
	if (streak >= STREAK) return `Your list grew ${streak} ${unit}s in a row.`;
	const openDelta = issue?.comparison?.opened;
	if (issue?.isSettled && openDelta >= ABOVE_AVERAGE) {
		return `Your last issue opened ${(openDelta * 100).toFixed(1)}% above your average.`;
	}
	if (previousTotal > 0 && (total - previousTotal) / previousTotal >= GROWTH_RATE) {
		return `Your list grew ${Math.round(((total - previousTotal) / previousTotal) * 100)}% ${when}.`;
	}
	if (previousJoined !== null && joined > previousJoined && previousJoined > 0) {
		return `${people(joined)} joined ${when}, ${formatNumber(joined - previousJoined)} more than the ${unit} before.`;
	}
	if (left > joined) return `More people left than joined ${when}. That happens after an issue goes out.`;
	if (joined === 0) return "A link to your website in your next post brings readers in.";
	return `${people(joined)} joined ${when}. Keep going.`;
}

// Nothing to say: no one joined or left, and no issue went out. A daily summary skips such a day; a weekly one still
// goes out.
export function isQuietSummary({ subscribers, unsubscribed, issue }) {
	return !subscribers.joined && !subscribers.left && !unsubscribed && !issue?.isInPeriod;
}
