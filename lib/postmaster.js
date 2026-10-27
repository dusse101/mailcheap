import "server-only";
import crypto from "node:crypto";
import { blockAccount } from "@/lib/account-blocks";
import { sendAlert } from "@/lib/alerts";
import { POSTMASTER, getAppUrl, getPostmasterDomain } from "@/lib/config";
import { decryptSecret, encryptSecret } from "@/lib/credentials";
import { connectDb } from "@/lib/db";
import { POSTMASTER_SCOPE, exchangeCode, getAuthorizationUrl, queryDomainStats, refreshAccessToken } from "@/lib/google-postmaster";
import {
	buildDailyQuery,
	buildIdentifierQueries,
	describeGmailRate,
	getLookback,
	getWideRates,
	mergeDailyRates,
	planAccountActions,
	readDays,
	readIdentifier,
	readIdentifierRates,
} from "@/lib/postmaster-rules";
import { formatRate } from "@/lib/rate-levels";
import { pauseSendingCampaigns } from "@/lib/sending";
import Account from "@/models/Account";
import Campaign from "@/models/Campaign";
import Newsletter from "@/models/Newsletter";
import PostmasterConnection from "@/models/PostmasterConnection";

const CONNECTION_ID = "postmaster";
const TOKEN_CONTEXT = "google-postmaster";
export const CALLBACK_PATH = "/api/admin/postmaster/callback";
// __Host-: only this host sets it, so no archive subdomain can hand the admin a state of its own.
export const STATE_COOKIE = "__Host-mailcheap-postmaster";
export const STATE_MAX_AGE_SECONDS = 600;
// Google refusing the token, the client, the API or the domain: nothing works until an admin fixes it. An outage or a
// slow answer waits for the next day's check.
const REFUSALS = new Set([400, 401, 403, 404]);
const WARNING_COOLDOWN_MINUTES = 24 * 60;
const DAY_ALERT_COOLDOWN_MINUTES = 7 * 24 * 60;
const MAX_STORED_FLAGS = 50;

// What the check needs, by name: Google sign-in's OAuth client, the key that encrypts the refresh token, and a domain.
export function getPostmasterSetup(env = process.env) {
	const missing = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "CREDENTIALS_ENCRYPTION_KEY"].filter((name) => !String(env[name] ?? "").trim());
	const domain = getPostmasterDomain(env);
	if (!domain) missing.push("POSTMASTER_DOMAIN");
	return { domain, missing };
}

export function getPostmasterRedirectUri() {
	return `${getAppUrl()}${CALLBACK_PATH}`;
}

// For the admin page: whether it's set up and connected, and the last check. Never the token.
export async function getPostmasterStatus() {
	const setup = getPostmasterSetup();
	await connectDb();
	const connection = await PostmasterConnection.findById(CONNECTION_ID).lean();
	return { ...setup, redirectUri: getPostmasterRedirectUri(), connection: connection?.connectedAt ? connection : null };
}

// The consent screen's address, and the state and PKCE verifier Google's answer has to come back with, for a cookie.
export function startPostmasterConnect() {
	const state = crypto.randomBytes(24).toString("base64url");
	const verifier = crypto.randomBytes(48).toString("base64url");
	const codeChallenge = crypto.createHash("sha256").update(verifier).digest("base64url");
	return { url: getAuthorizationUrl({ redirectUri: getPostmasterRedirectUri(), state, codeChallenge }), cookie: `${state}.${verifier}` };
}

function isSameState(given, expected) {
	const a = Buffer.from(String(given ?? ""));
	const b = Buffer.from(String(expected ?? ""));
	return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Straight from Google's token endpoint over TLS, the ID token's email needs no signature check (OpenID Connect 3.1.3.7).
// It only names the account on the admin page.
function readGoogleEmail(idToken) {
	try {
		const email = JSON.parse(Buffer.from(String(idToken).split(".")[1], "base64url").toString("utf8"))?.email;
		return typeof email === "string" ? email.slice(0, 200) : null;
	} catch {
		return null;
	}
}

function isRefusal(error) {
	return error?.name === "GoogleError" && REFUSALS.has(error.status);
}

async function readRecentDays(accessToken, domain, now = new Date()) {
	return readDays(await queryDomainStats({ accessToken, domain, query: buildDailyQuery(getLookback(now)) }));
}

// Google's answer to the consent screen, checked against the cookie that started it. The refresh token is stored
// encrypted; a first read tells whether Postmaster Tools lets this Google account see the domain, which the admin page shows.
// Returns what the admin page says: connected, denied, scope, expired or failed.
export async function finishPostmasterConnect({ params, cookie, admin }) {
	const [state, verifier] = String(cookie ?? "").split(".");
	if (!verifier || !isSameState(params.get("state"), state)) return "expired";
	if (params.get("error")) return "denied";
	const code = params.get("code");
	if (!code) return "failed";
	let token;
	try {
		token = await exchangeCode({ code, codeVerifier: verifier, redirectUri: getPostmasterRedirectUri() });
	} catch (error) {
		console.error(`[postmaster] Google didn't take the code: ${error.message}`);
		return "failed";
	}
	if (!String(token?.scope ?? "").split(" ").includes(POSTMASTER_SCOPE)) return "scope";
	if (!token.refresh_token || !token.access_token) return "failed";

	await connectDb();
	await PostmasterConnection.updateOne(
		{ _id: CONNECTION_ID },
		{
			$set: {
				refreshToken: encryptSecret(token.refresh_token, { context: TOKEN_CONTEXT }),
				email: readGoogleEmail(token.id_token),
				connectedBy: admin.email,
				connectedAt: new Date(),
			},
			$unset: { problem: 1 },
		},
		{ upsert: true }
	);
	console.info(`[postmaster] ${admin.email} connected Postmaster Tools`);
	try {
		await readRecentDays(token.access_token, getPostmasterSetup().domain);
	} catch (error) {
		if (!isRefusal(error)) return "connected";
		await PostmasterConnection.updateOne({ _id: CONNECTION_ID }, { $set: { "problem.message": error.message, "problem.at": new Date() } });
	}
	return "connected";
}

// One alert per stretch of refusals: the first one claims it, and the next success or connection ends the stretch. Its
// start in the key makes each stretch's alert one of its own.
async function noteRefusal(message) {
	const now = new Date();
	const { modifiedCount } = await PostmasterConnection.updateOne(
		{ _id: CONNECTION_ID, "problem.alertedAt": null },
		{ $set: { "problem.message": message, "problem.at": now, "problem.alertedAt": now, checkedAt: now } }
	);
	if (!modifiedCount) {
		await PostmasterConnection.updateOne({ _id: CONNECTION_ID }, { $set: { "problem.message": message, checkedAt: now } });
		return { refused: message };
	}
	await sendAlert({
		accountId: null,
		key: `postmaster-refused:${now.getTime()}`,
		title: "Postmaster Tools refused MailCheap",
		detail: `${message}.`,
		action: "Gmail's spam rates go unchecked until it's fixed: connect Postmaster Tools again on the admin page.",
		path: "/admin",
		cooldownMinutes: 0,
	});
	return { refused: message, alerted: true };
}

// Each flag with its account: mc-<accountId>, or the account of the campaign or newsletter its id names. An identifier
// that names no account spans them all (isWide); an id whose campaign or newsletter is gone names nothing.
async function attachAccounts(flags) {
	const objectIds = flags.map(({ id }) => readIdentifier(id)?.objectId).filter(Boolean);
	const owners = new Map();
	if (objectIds.length > 0) {
		const found = await Promise.all(
			[Campaign, Newsletter].map((Model) => Model.find({ _id: { $in: objectIds } }).select({ accountId: 1 }).setOptions({ crossAccount: true }).lean())
		);
		for (const { _id, accountId } of found.flat()) owners.set(String(_id), String(accountId));
	}
	return flags.map((flag) => {
		const parsed = readIdentifier(flag.id);
		return { ...flag, accountId: parsed?.accountId ?? owners.get(parsed?.objectId) ?? null, isWide: !parsed };
	});
}

async function readFlags({ accessToken, domain, day, identifiers }) {
	const rates = [];
	for (const { identifiers: group, query } of buildIdentifierQueries({ day, identifiers })) {
		rates.push(...readIdentifierRates(await queryDomainStats({ accessToken, domain, query }), group));
	}
	return attachAccounts(rates);
}

function logAction(fields) {
	console.info(`[postmaster] ${JSON.stringify(fields)}`);
}

// Through the paths every other spam signal takes: the block alerts the admins (Telegram too) and the owner, the pause
// emails the owner for each send it stops, and with no send to stop the owner is warned once a day.
async function act({ accountId, id, rate, action, why }, { domain, day }) {
	const fields = { day, account: accountId, feedbackId: id, rate };
	if (action === "block") {
		const detail = `Postmaster Tools for ${domain} on ${day}: feedback ID ${id} at ${formatRate(rate)}, the block level is ${formatRate(POSTMASTER.blockRate)}`;
		const isBlocked = await blockAccount(accountId, { reason: describeGmailRate(rate), by: "gmail", detail });
		logAction({ ...fields, action: isBlocked ? "blocked" : "skipped", ...(!isBlocked && { why: "already blocked" }) });
		return isBlocked ? "blocked" : "skipped";
	}
	if (action === "pause") {
		const warning = `${describeGmailRate(rate)}. Check that your contacts asked for your emails before you resume: at ${formatRate(POSTMASTER.blockRate)}, the account is blocked.`;
		const campaigns = await pauseSendingCampaigns(accountId, warning);
		if (campaigns.length === 0) {
			await sendAlert({
				accountId,
				key: "gmail-warning",
				title: "Gmail reports spam complaints",
				detail: `${describeGmailRate(rate)}. Nothing is paused, but at ${formatRate(POSTMASTER.blockRate)} the account is blocked: check where your recent contacts came from.`,
				path: "/",
				cooldownMinutes: WARNING_COOLDOWN_MINUTES,
			});
		}
		logAction({ ...fields, action: campaigns.length > 0 ? "paused" : "warned", campaigns });
		return campaigns.length > 0 ? "paused" : "warned";
	}
	logAction({ ...fields, action, ...(why && { why }) });
	return action;
}

async function alertWideRates({ domain, day, rates }) {
	await sendAlert({
		accountId: null,
		key: `gmail-spam-rate:${day}`,
		title: "Gmail spam rate is high",
		detail: `Google Postmaster Tools, ${day}: ${rates.map(({ label, rate }) => `${label} at ${formatRate(rate)}`).join(", ")}, over ${formatRate(POSTMASTER.alertRate)}.`,
		action: `Over ${formatRate(POSTMASTER.alertRate)} Gmail filters more of every customer's mail. Accounts Gmail flags pause or block on their own: see the admin page.`,
		path: "/admin",
		cooldownMinutes: DAY_ALERT_COOLDOWN_MINUTES,
	});
	logAction({ day, action: "alerted", domain, rates });
}

// Daily (app/api/cron/postmaster): the newest day of Gmail's data for the domain, acted on once, and each day's spam rate
// kept. Without its settings or a connected Google account it does nothing, and a day without data passes quietly.
export async function checkPostmaster({ now = new Date() } = {}) {
	const { domain, missing } = getPostmasterSetup();
	if (missing.length > 0) return { skipped: "Postmaster Tools isn't set up" };
	await connectDb();
	const connection = await PostmasterConnection.findById(CONNECTION_ID).select("+refreshToken").lean();
	if (!connection?.refreshToken) return { skipped: "Postmaster Tools isn't connected" };

	let refreshToken;
	try {
		refreshToken = decryptSecret(connection.refreshToken, { context: TOKEN_CONTEXT });
	} catch (error) {
		return noteRefusal(`The stored refresh token doesn't decrypt (${error.message})`);
	}
	let days;
	let latest;
	let flags = [];
	try {
		const accessToken = await refreshAccessToken(refreshToken);
		days = await readRecentDays(accessToken, domain, now);
		latest = days.at(-1) ?? null;
		if (latest && latest.day > (connection.lastDay ?? "")) {
			flags = await readFlags({ accessToken, domain, day: latest.day, identifiers: latest.identifiers });
		}
	} catch (error) {
		if (isRefusal(error)) return noteRefusal(error.message);
		console.warn(`[postmaster] Postmaster Tools didn't answer: ${error.message}`);
		return { failed: error.message };
	}
	const kept = mergeDailyRates(connection.days, days);
	if (!latest || latest.day <= (connection.lastDay ?? "")) {
		await PostmasterConnection.updateOne({ _id: CONNECTION_ID }, { $set: { checkedAt: new Date(), days: kept }, $unset: { problem: 1 } });
		return { skipped: latest ? `nothing newer than ${connection.lastDay}` : "no data from Gmail" };
	}

	const accountIds = [...new Set(flags.map(({ accountId }) => accountId).filter(Boolean))];
	const accounts = new Map(
		(await Account.find({ _id: { $in: accountIds } }).select({ status: 1, unblockedAt: 1 }).lean()).map((account) => [String(account._id), account])
	);
	const results = [];
	for (const item of planAccountActions({ day: latest.day, flags, accounts })) {
		results.push({ ...item, action: await act(item, { domain, day: latest.day }) });
	}
	const wide = getWideRates({ domain, spamRate: latest.spamRate, flags });
	if (wide.length > 0) await alertWideRates({ domain, day: latest.day, rates: wide });

	const unowned = flags.filter(({ accountId }) => !accountId).map(({ id, rate, isWide }) => ({ id, rate, accountId: null, action: isWide ? "wide" : "unknown" }));
	for (const { id, rate, action } of unowned) logAction({ day: latest.day, feedbackId: id, rate, action });
	const flagged = [...results, ...unowned];
	await PostmasterConnection.updateOne(
		{ _id: CONNECTION_ID },
		{
			$set: {
				lastDay: latest.day,
				checkedAt: new Date(),
				days: kept,
				lastRun: { day: latest.day, spamRate: latest.spamRate, flagged: flagged.slice(0, MAX_STORED_FLAGS).map(({ id, rate, accountId, action }) => ({ id, rate, accountId, action })) },
			},
			$unset: { problem: 1 },
		}
	);
	return { day: latest.day, spamRate: latest.spamRate, alerted: wide.length > 0, flagged: flagged.map(({ id, rate, accountId, action }) => ({ id, rate, accountId, action })) };
}
