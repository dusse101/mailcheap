import { isBlocked } from "./account-state.js";
import { POSTMASTER } from "./config.js";
import { formatRate } from "./rate-levels.js";

// Gmail's feedback loop reports each Feedback-ID field as an identifier of its own. An account's is mc-<accountId>, in
// MailCheap's own header (lib/sending-rules.js) and first in the one PostShiba writes in its place; a campaign's or a
// newsletter's is its id. Any other (a kind of email, a sender ID, PostShiba's other fields) spans every account.
const ACCOUNT_IDENTIFIER = /^mc-([0-9a-f]{24})$/i;
const OBJECT_ID = /^[0-9a-f]{24}$/i;
// Google doesn't document escapes in a metric's filter, so an identifier it quotes stays within these.
const QUOTABLE = /^[A-Za-z0-9_.-]{1,200}$/;
// Every customer email carries a DKIM signature of the domain (PostShiba's primary domain signing): counting by signer
// takes in the newsletters on their own domains, which counting by From: header leaves out.
const BY_SIGNER = 'aggregation_key_type = "ALL_DKIM"';
const IDENTIFIERS_PER_QUERY = 20;
const MAX_IDENTIFIERS = 200;
const DAY_MS = 86_400_000;

export function readIdentifier(identifier) {
	const value = String(identifier ?? "").trim().toLowerCase();
	const accountId = ACCOUNT_IDENTIFIER.exec(value)?.[1];
	if (accountId) return { accountId };
	return OBJECT_ID.test(value) ? { objectId: value } : null;
}

// One account's Gmail spam rate, at LIMITS' complaint levels: "block", "pause" or null.
export function judgeGmailRate(rate) {
	if (rate >= POSTMASTER.blockRate) return "block";
	if (rate >= POSTMASTER.pauseRate) return "pause";
	return null;
}

export function describeGmailRate(rate) {
	return `Gmail reported a spam rate of ${formatRate(rate)} for your emails (Google Postmaster Tools)`;
}

// Postmaster Tools counts in UTC days, as { year, month, day }; here they're "2026-10-14", which sorts by date.
export function toDay(date) {
	return new Date(date).toISOString().slice(0, 10);
}

function toDate(day) {
	const [year, month, date] = day.split("-").map(Number);
	return { year, month, day: date };
}

function readDay(date) {
	const { year, month, day } = date ?? {};
	if (![year, month, day].every(Number.isInteger) || !year || !month || !day) return null;
	return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// The last days up to yesterday: today's data never comes before tomorrow.
export function getLookback(now = new Date(), days = POSTMASTER.lookbackDays) {
	const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - DAY_MS;
	return { start: toDay(end - (days - 1) * DAY_MS), end: toDay(end) };
}

export function buildDailyQuery({ start, end }) {
	return {
		metricDefinitions: [
			{ name: "spam_rate", baseMetric: { standardMetric: "SPAM_RATE" } },
			{ name: "feedback_loop_ids", baseMetric: { standardMetric: "FEEDBACK_LOOP_ID" }, filter: BY_SIGNER },
		],
		timeQuery: { dateRanges: { dateRanges: [{ start: toDate(start), end: toDate(end) }] } },
		aggregationGranularity: "DAILY",
	};
}

// A spam rate is a share of the emails Gmail delivered to the inbox, 0.001 for 0.1%. Anything that isn't one is left out
// rather than guessed at.
export function readRate(value) {
	const rate = value?.doubleValue ?? value?.floatValue;
	return typeof rate === "number" && Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : null;
}

// Each day with any data, oldest first: the domain's spam rate (null if Gmail gave none) and the identifiers it flagged.
export function readDays(rows) {
	const days = new Map();
	for (const row of Array.isArray(rows) ? rows : []) {
		const day = readDay(row?.date);
		if (!day) continue;
		const entry = days.get(day) ?? { day, spamRate: null, identifiers: [] };
		if (row.metric === "spam_rate") entry.spamRate = readRate(row.value);
		if (row.metric === "feedback_loop_ids") {
			const values = row.value?.stringList?.values;
			entry.identifiers = [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string" && QUOTABLE.test(value)))];
		}
		days.set(day, entry);
	}
	return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export function readLatestDay(rows) {
	return readDays(rows).at(-1) ?? null;
}

// The days' spam rates kept so far, with the days just read: Gmail's newer answer for a day replaces it, a day it gave
// no rate for keeps what it had, and the last POSTMASTER.keepDays stay, oldest first.
export function mergeDailyRates(kept, days) {
	const rates = new Map((kept ?? []).map(({ day, spamRate }) => [day, spamRate]));
	for (const { day, spamRate } of days ?? []) if (spamRate !== null) rates.set(day, spamRate);
	return [...rates]
		.sort(([a], [b]) => a.localeCompare(b))
		.slice(-POSTMASTER.keepDays)
		.map(([day, spamRate]) => ({ day, spamRate }));
}

// One spam rate per identifier for the day, a few identifiers a query; the metric's name carries its identifier's index.
export function buildIdentifierQueries({ day, identifiers }) {
	const list = identifiers.slice(0, MAX_IDENTIFIERS);
	const queries = [];
	for (let start = 0; start < list.length; start += IDENTIFIERS_PER_QUERY) {
		const group = list.slice(start, start + IDENTIFIERS_PER_QUERY);
		const metricDefinitions = group.map((identifier, index) => ({
			name: `feedback_loop_${index}`,
			baseMetric: { standardMetric: "FEEDBACK_LOOP_SPAM_RATE" },
			filter: `feedback_loop_id = "${identifier}" AND ${BY_SIGNER}`,
		}));
		queries.push({ identifiers: group, query: { metricDefinitions, timeQuery: { dateList: { dates: [toDate(day)] } }, aggregationGranularity: "DAILY" } });
	}
	return queries;
}

export function readIdentifierRates(rows, identifiers) {
	const rates = [];
	for (const row of Array.isArray(rows) ? rows : []) {
		const index = /^feedback_loop_(\d+)$/.exec(row?.metric ?? "")?.[1];
		const id = index === undefined ? undefined : identifiers[Number(index)];
		const rate = readRate(row.value);
		if (id && rate !== null && !rates.some((item) => item.id === id)) rates.push({ id, rate });
	}
	return rates;
}

// Each account's highest flagged rate, judged; none for an account already blocked, or unblocked by an admin after that
// day's emails went out, so the same emails never cost it twice. accounts: by id, each with status and unblockedAt.
export function planAccountActions({ day, flags, accounts }) {
	const worst = new Map();
	for (const flag of flags) {
		if (!flag.accountId) continue;
		const known = worst.get(flag.accountId);
		if (!known || flag.rate > known.rate) worst.set(flag.accountId, flag);
	}
	return [...worst.values()].map(({ accountId, id, rate }) => {
		const level = judgeGmailRate(rate);
		const account = accounts.get(accountId);
		const item = { accountId, id, rate, level };
		if (!level) return { ...item, action: "none" };
		if (!account) return { ...item, action: "skip", why: "no such account" };
		if (isBlocked(account)) return { ...item, action: "skip", why: "already blocked" };
		if (account.unblockedAt && toDay(account.unblockedAt) >= day) return { ...item, action: "skip", why: "unblocked after these emails" };
		return { ...item, action: level };
	});
}

// What spans every account and reached the alert level that day: the domain's rate, and identifiers that are no account's.
export function getWideRates({ domain, spamRate, flags }) {
	return [
		...(spamRate === null ? [] : [{ label: domain, rate: spamRate }]),
		...flags.filter(({ isWide }) => isWide).map(({ id, rate }) => ({ label: `feedback ID ${id}`, rate })),
	].filter(({ rate }) => rate >= POSTMASTER.alertRate);
}
