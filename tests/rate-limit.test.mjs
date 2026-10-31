import assert from "node:assert/strict";
import { test } from "node:test";
import { getLimiter, isLimitedInMemory, isRateLimited } from "../lib/rate-limit.js";

delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

const LOGIN = { name: "test-login", limit: 3, window: "15 m" };

async function countAllowed(options, attempts, limiter) {
	let allowed = 0;
	for (let attempt = 0; attempt < attempts; attempt += 1) if (!(await isRateLimited(options, limiter))) allowed += 1;
	return allowed;
}

test("without Redis, limits still apply, counted in memory per key", async () => {
	const results = [];
	for (let attempt = 0; attempt < 4; attempt += 1) results.push(await isRateLimited({ ...LOGIN, key: "203.0.113.7" }));
	assert.deepEqual(results, [false, false, false, true]);
	assert.equal(await isRateLimited({ ...LOGIN, key: "203.0.113.8" }), false, "other visitors keep their own count");
	assert.equal(await isRateLimited({ ...LOGIN, name: "test-other", key: "203.0.113.7" }), false, "and other limits");
});

test("a Redis error or timeout falls back to memory instead of letting everything through", async (t) => {
	t.mock.method(console, "error", () => {});
	const failing = { limit: async () => Promise.reject(new Error("fetch failed")) };
	const timingOut = { limit: async () => ({ success: true, reason: "timeout" }) };
	assert.equal(await countAllowed({ ...LOGIN, key: "198.51.100.3" }, 5, failing), 3);
	assert.equal(await countAllowed({ ...LOGIN, key: "198.51.100.4" }, 5, timingOut), 3);

	const reports = console.error.mock.calls.filter(({ arguments: [message] }) => /unavailable, counting in memory/.test(message));
	assert.equal(reports.length, 1, "an outage is reported at most every 30 minutes, not on every request");
});

test("Redis answers decide while it's up", async () => {
	const allowing = { limit: async () => ({ success: true }) };
	const refusing = { limit: async () => ({ success: false }) };
	assert.equal(await countAllowed({ ...LOGIN, key: "198.51.100.5" }, 5, allowing), 5);
	assert.equal(await countAllowed({ ...LOGIN, key: "198.51.100.5" }, 2, refusing), 0);
});

test("a name can take several limits, as a plan's signup limits do: one count, which each compares with its own", async () => {
	const starter = { name: "test-plan", limit: 2, window: "1 h", key: "account-a" };
	const growth = { ...starter, limit: 4 };
	const results = [];
	for (const limits of [starter, starter, starter, growth, growth, growth]) results.push(await isRateLimited(limits));
	assert.deepEqual(results, [false, false, true, false, false, true], "an upgrade raises the limit on what was already counted");
});

test("with Redis, each limit has its own limiter, all keeping their name's count", () => {
	process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
	process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
	try {
		const starter = getLimiter({ name: "test-scaled", limit: 600, window: "1 h" });
		const growth = getLimiter({ name: "test-scaled", limit: 1200, window: "1 h" });
		assert.notEqual(growth, starter, "a bigger plan's limit, never the first one asked for");
		assert.equal(getLimiter({ name: "test-scaled", limit: 600, window: "1 h" }), starter);
		assert.equal(starter.prefix, "mailcheap/test-scaled");
		assert.equal(growth.prefix, starter.prefix);
	} finally {
		delete process.env.UPSTASH_REDIS_REST_URL;
		delete process.env.UPSTASH_REDIS_REST_TOKEN;
	}
});

test("memory limits open again once the window has passed", () => {
	const limits = { name: "test-window", limit: 2, window: "10 m" };
	const start = Date.parse("2026-10-09T12:00:00Z");
	assert.equal(isLimitedInMemory({ ...limits, key: "a" }, start), false);
	assert.equal(isLimitedInMemory({ ...limits, key: "a" }, start + 1000), false);
	assert.equal(isLimitedInMemory({ ...limits, key: "a" }, start + 2000), true);
	assert.equal(isLimitedInMemory({ ...limits, key: "a" }, start + 10 * 60_000 + 1000), false);
});
