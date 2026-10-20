import crypto from "node:crypto";
import { getAppSecret } from "./config.js";
import { isObjectIdString } from "./validation.js";

// The summary email's links, signed so they work without signing in: base64url JSON payload + "." + HMAC-SHA256. The
// settings link acts for one account and expires; the share link only carries the numbers it shows, which can't be
// changed, and keeps working wherever it was posted. Each signs with its own key, so one never stands in for the other.
const SETTINGS_INFO = "mailcheap-summary-settings";
const SHARE_INFO = "mailcheap-summary-share";
// Long enough for any summary still in an inbox: the law asks for 30 days at least.
export const SETTINGS_TOKEN_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,600}\.[A-Za-z0-9_-]{43}$/;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NAME_LENGTH = 80;

function sign(info, payload) {
	const key = Buffer.from(crypto.hkdfSync("sha256", getAppSecret(), "", info, 32));
	return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

function encode(info, data) {
	const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
	return `${payload}.${sign(info, payload)}`;
}

function decode(info, token) {
	if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return null;
	const [payload, signature] = token.split(".");
	const expected = Buffer.from(sign(info, payload));
	const provided = Buffer.from(signature);
	if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) return null;
	try {
		return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
	} catch {
		return null;
	}
}

export function createSummarySettingsToken(accountId, now = Date.now()) {
	const account = String(accountId ?? "").toLowerCase();
	if (!isObjectIdString(account)) throw new Error("Invalid account");
	return encode(SETTINGS_INFO, { a: account, t: Math.floor(now / 1000) });
}

// The account whose summary the link changes, or null.
export function verifySummarySettingsToken(token, now = Date.now()) {
	const data = decode(SETTINGS_INFO, token);
	if (!data || !isObjectIdString(data.a) || !Number.isInteger(data.t)) return null;
	if (now - data.t * 1000 > SETTINGS_TOKEN_MAX_AGE_MS || data.t * 1000 > now + 60_000) return null;
	return { accountId: data.a };
}

function toCount(value) {
	return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

// Only the newsletter's own totals, never a reader: its name, who joined over the period, the total and the day it ended.
export function createSummaryShareToken({ name, joined, total, frequency, lastKey }) {
	return encode(SHARE_INFO, {
		n: String(name ?? "").trim().slice(0, MAX_NAME_LENGTH),
		j: Math.max(0, Math.round(joined)),
		t: Math.max(0, Math.round(total)),
		f: frequency === "daily" ? "d" : "w",
		d: lastKey,
	});
}

export function verifySummaryShareToken(token) {
	const data = decode(SHARE_INFO, token);
	if (!data || typeof data.n !== "string" || !data.n || data.n.length > MAX_NAME_LENGTH) return null;
	const joined = toCount(data.j);
	const total = toCount(data.t);
	if (joined === null || total === null || !["d", "w"].includes(data.f) || !DATE_KEY_PATTERN.test(data.d)) return null;
	return { name: data.n, joined, total, frequency: data.f === "d" ? "daily" : "weekly", lastKey: data.d };
}
