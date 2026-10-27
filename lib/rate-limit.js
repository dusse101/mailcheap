import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const limiters = new Map();
let redis;

// Without Redis, or while it's down, the same limits are counted in this server instance's memory.
// Instances don't share it and lose it on restart, so it's weaker on serverless hosts, but a script
// hammering one form still gets stopped.
const memory = new Map();
const MAX_MEMORY_KEYS = 10_000;
const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const REPORT_EVERY_MINUTES = 30;
let lastReportAt = 0;

// One limiter per limit: a name that takes several, like a plan's signup limits, keeps one count in Redis, which each
// compares with its own limit, so an upgrade raises the limit on what was already counted.
export function getLimiter({ name, limit, window }) {
	const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = process.env;
	if (!url || !token) return null;
	redis ??= new Redis({ url, token });
	const id = `${name}:${limit}:${window}`;
	if (!limiters.has(id)) {
		limiters.set(id, new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(limit, window), prefix: `mailcheap/${name}` }));
	}
	return limiters.get(id);
}

// Windows use Upstash's format: "10 m", "1 h".
function windowMs(window) {
	const [amount, unit] = String(window).trim().split(/\s+/);
	return Number(amount) * (UNIT_MS[unit] ?? Number.NaN);
}

export function isLimitedInMemory({ name, limit, window, key }, now = Date.now()) {
	const id = `${name}:${key}`;
	const hits = (memory.get(id) ?? []).filter((time) => now - time < windowMs(window));
	const isLimited = hits.length >= limit;
	if (!isLimited) hits.push(now);
	// Re-inserting keeps the Map in order of last use, so the oldest key goes first when it's full.
	memory.delete(id);
	memory.set(id, hits);
	if (memory.size > MAX_MEMORY_KEYS) memory.delete(memory.keys().next().value);
	return isLimited;
}

// Logged at most every 30 minutes per server instance, so an outage doesn't write a line for every request. Errors
// other than a timeout, which Redis gets over on its own, alert the admins after the response.
async function reportUnavailable(name, error) {
	if (Date.now() - lastReportAt < REPORT_EVERY_MINUTES * 60_000) return;
	lastReportAt = Date.now();
	console.error(`[rate-limit] ${name} unavailable, counting in memory:`, error.message);
	if (error.isTimeout) return;
	try {
		// Loaded on demand: alerts need Next.js and the database, which counting doesn't.
		const [{ after }, { sendAlert }] = await Promise.all([import("next/server"), import("./alerts.js")]);
		after(() =>
			sendAlert({
				key: "rate-limit-unavailable",
				title: "Rate limiter unavailable",
				detail: `Upstash Redis failed (${error.message}). Limits are counted in each server instance's memory until it's back.`,
				action: "Check the database and its token in Upstash's console.",
				link: "https://console.upstash.com/redis",
				cooldownMinutes: REPORT_EVERY_MINUTES,
			})
		);
	} catch (alertError) {
		console.error("[rate-limit] Alert failed:", alertError.message);
	}
}

export function getClientIp(headers) {
	const forwardedFor = headers.get("x-forwarded-for")?.split(",")[0].trim();
	return forwardedFor || headers.get("x-real-ip") || "unknown";
}

export async function isRateLimited({ name, limit, window, key }, limiter = getLimiter({ name, limit, window })) {
	if (!limiter) return isLimitedInMemory({ name, limit, window, key });
	try {
		const { success, reason } = await limiter.limit(key);
		// Upstash lets a request through when Redis doesn't answer in time.
		if (reason === "timeout") throw Object.assign(new Error("Redis timed out"), { isTimeout: true });
		return !success;
	} catch (error) {
		await reportUnavailable(name, error);
		return isLimitedInMemory({ name, limit, window, key });
	}
}
