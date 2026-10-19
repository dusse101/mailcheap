import assert from "node:assert/strict";
import mongoose from "mongoose";
import { runWithRequest } from "../stubs/next-headers.mjs";
import { NotFoundError, RedirectError } from "../stubs/next-navigation.mjs";
import { startMongo } from "./mongo.mjs";

// Platform emails sent through Resend's API, newest last.
export const platformEmails = [];
// Messages to Telegram's Bot API, newest last, with the token their URL carried.
export const telegramMessages = [];
let stripeHandler = null;
let telegramAnswer = null;
let visitor = 0;

// No test talks to the network: Resend and Telegram are recorded and Stripe answers from mockStripe's handler.
function installFetch() {
	globalThis.fetch = async (input, init = {}) => {
		const url = String(input?.url ?? input);
		if (url === "https://api.resend.com/emails") {
			platformEmails.push(JSON.parse(init.body));
			return Response.json({ id: `email_${platformEmails.length}` });
		}
		const telegram = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/sendMessage$/.exec(url);
		if (telegram) {
			const answer = telegramAnswer?.();
			if (answer) return answer;
			telegramMessages.push({ token: telegram[1], ...JSON.parse(init.body) });
			return Response.json({ ok: true, result: { message_id: telegramMessages.length } });
		}
		if (url.startsWith("https://api.stripe.com/")) {
			if (!stripeHandler) throw new Error(`Unexpected Stripe request: ${init.method ?? "GET"} ${url}`);
			const { pathname, searchParams } = new URL(url);
			const body = new URLSearchParams(typeof init.body === "string" ? init.body : "");
			const result = await stripeHandler({ method: init.method ?? "GET", path: pathname, query: searchParams, body });
			return Response.json(result?.error ? { error: result.error } : result, {
				status: result?.error ? (result.status ?? 400) : 200,
				headers: { "request-id": "req_test" },
			});
		}
		throw new Error(`Unexpected request to ${url}`);
	};
}

export function mockStripe(handler) {
	stripeHandler = handler;
}

// The lookup keys a prices.list asks for, as Stripe gets them: lookup_keys[0], lookup_keys[1]…
export function readLookupKeys(query) {
	return [...query].filter(([name]) => name.startsWith("lookup_keys[")).map(([, value]) => value);
}

// Stripe's answer to a prices.list when it has both prices of every plan, at lib/plans.js's amounts.
export async function listPlanPrices(query) {
	const { getPlan, getPrice, parseLookupKey } = await import("../../lib/plans.js");
	const data = readLookupKeys(query).flatMap((lookupKey) => {
		const price = parseLookupKey(lookupKey);
		if (!price) return [];
		const amount = getPrice(getPlan(price.plan), price.interval) * 100;
		return [{ id: `price_${lookupKey}`, object: "price", lookup_key: lookupKey, unit_amount: amount, currency: "usd", recurring: { interval: price.interval } }];
	});
	return { object: "list", data, has_more: false };
}

// Telegram answers this Response instead, while the function returns one.
export function answerTelegram(answer) {
	telegramAnswer = answer;
}

// MailCheap Cloud by default; a self-hosted server with { MAILCHEAP_CLOUD: "" }.
export async function startTestApp(env = {}) {
	const mongo = await startMongo();
	Object.assign(process.env, {
		NODE_ENV: "test",
		MAILCHEAP_CLOUD: "true",
		MONGODB_URI: mongo.uri,
		BETTER_AUTH_SECRET: "test-secret-for-integration-tests-0123456789",
		SUPPRESSION_HASH_KEY: "test-suppression-hash-key-0123456789abcdef",
		APP_URL: "http://localhost:3000",
		RESEND_API_KEY: "re_test",
		SENDING_ENABLED: "true",
		QSTASH_TOKEN: "qstash-test",
		SEND_RATE_PER_SECOND: "14",
		STRIPE_SECRET_KEY: "sk_test_mailcheap",
		STRIPE_WEBHOOK_SECRET: "whsec_test_mailcheap",
		ADMIN_EMAILS: "admin@example.com",
		BLOB_READ_WRITE_TOKEN: "blob-test",
		SHARED_DOMAIN: "mailcheapmail.com",
		ARCHIVE_CNAME_TARGET: "cname.mailcheap.ai",
		SES_AWS_ACCOUNT_ID: "111122223333",
		SES_ACCESS_KEY_ID: "test-ses-key-id",
		SES_SECRET_ACCESS_KEY: "test-ses-secret",
		...env,
	});
	installFetch();
	const stop = async () => {
		await mongoose.disconnect();
		await mongo.stop();
	};
	try {
		const { connectDb } = await import("../../lib/db.js");
		await connectDb();
	} catch (error) {
		await stop();
		throw error;
	}
	return { stop };
}

// Runs code with some environment variables changed, and puts them back after.
export async function withEnv(values, run) {
	const previous = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
	Object.assign(process.env, values);
	try {
		return await run();
	} finally {
		for (const [name, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
}

export function form(fields) {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.set(key, String(value));
	return data;
}

export async function catchRedirect(promise) {
	try {
		await promise;
	} catch (error) {
		if (error instanceof RedirectError) return error.url;
		throw error;
	}
	throw new Error("Expected a redirect");
}

export async function catchNotFound(promise) {
	try {
		await promise;
	} catch (error) {
		if (error instanceof NotFoundError) return true;
		throw error;
	}
	return false;
}

// Runs code as the signed-in user: their cookies go with the request, and new ones land in their jar.
export function as(user, run) {
	return runWithRequest({ jar: user.jar, headers: { "x-forwarded-for": user.ip } }, run);
}

export function anonymous(run) {
	return runWithRequest({ jar: new Map() }, run);
}

// The real sign-in: a code by email (through the Resend API), then the code.
export async function signIn(email) {
	const { sendSigninCode, verifySigninCode } = await import("../../app/signin/actions.js");
	const user = { email, jar: new Map(), ip: `198.51.100.${++visitor}` };
	const sent = await as(user, () => sendSigninCode(null, form({ email })));
	assert.deepEqual(sent, { email: email.toLowerCase() });
	const { subject } = platformEmails.findLast(({ to }) => to.includes(email.toLowerCase()));
	const code = subject.slice(0, 6);
	assert.equal(await as(user, () => catchRedirect(verifySigninCode(null, form({ email, code, next: "/" })))), "/");

	const Account = (await import("../../models/Account.js")).default;
	const stored = await mongoose.connection.db.collection("users").findOne({ email: email.toLowerCase() });
	user.userId = stored._id;
	// Past its warm-up: sends up to 200 emails, or 5 times what it proved (proveVolume), go out at full speed. Tests of the
	// warm-up unset it.
	await Account.updateOne({ ownerId: stored._id }, { $set: { spreadUntil: new Date(0) } });
	user.account = await Account.findOne({ ownerId: stored._id }).lean();
	user.accountId = user.account._id;
	return user;
}

// What the Stripe webhook writes for a paid subscription.
export async function activate(user, { plan = "starter", interval = "month", ...set } = {}) {
	const Account = (await import("../../models/Account.js")).default;
	const { addMonths, startUsagePeriod } = await import("../../lib/usage-period.js");
	const start = new Date();
	const end = addMonths(start, interval === "year" ? 12 : 1);
	await Account.updateOne(
		{ _id: user.accountId },
		{
			$set: {
				plan,
				interval,
				subscriptionStatus: "active",
				stripeCustomerId: `cus_${user.accountId}`,
				stripeSubscriptionId: `sub_${user.accountId}`,
				currentPeriodStart: start,
				currentPeriodEnd: end,
				usage: startUsagePeriod({ start, end }),
				...set,
			},
		}
	);
	user.account = await Account.findById(user.accountId).lean();
	return user.account;
}

// A campaign the account sent before, which proves its volume (lib/send-spread.js) once it's a day old and under the
// pause level.
export async function proveVolume(user, sent, { bounced = 0, hoursAgo = 48 } = {}) {
	const Campaign = (await import("../../models/Campaign.js")).default;
	const at = new Date(Date.now() - hoursAgo * 3_600_000);
	await Campaign.create({
		accountId: user.accountId,
		newsletterId: user.newsletterId,
		subject: "Earlier issue",
		status: "sent",
		stats: { recipients: sent, sent, bounced },
		startedAt: at,
		sentAt: at,
		finishedAt: at,
	});
}

// An issue the newsletter sent, which puts its website online (lib/archive-data.js).
export async function addSentIssue(user) {
	const Campaign = (await import("../../models/Campaign.js")).default;
	await Campaign.create({ accountId: user.accountId, newsletterId: user.newsletterId, subject: "Sent issue", status: "sent", sentAt: new Date() });
}

// A domain added through the Domains page, with its DNS records in and its archive subdomain pointed at us.
export async function addVerifiedDomain(user, domain, { archiveHost = `news.${domain}`, isArchiveLive = true } = {}) {
	const { addDomain, checkDomain } = await import("../../lib/domains.js");
	const { verifyIdentity } = await import("../stubs/ses.mjs");
	const { cnames } = await import("../stubs/dns-check.mjs");
	const Account = (await import("../../models/Account.js")).default;
	const account = await Account.findById(user.accountId).lean();
	const added = await addDomain({ account, domain, archiveHost });
	verifyIdentity(domain);
	if (isArchiveLive) cnames.set(archiveHost, ["cname.mailcheap.ai"]);
	user.account = await Account.findById(user.accountId).lean();
	return checkDomain({ account: user.account, domainId: added._id });
}

export function jsonRequest(url, { method = "GET", body, headers = {} } = {}) {
	return new Request(new URL(url, "http://localhost:3000"), {
		method,
		headers: { ...(body !== undefined && { "content-type": "application/json" }), ...headers },
		...(body !== undefined && { body: JSON.stringify(body) }),
	});
}

// A request to /api/v1 through its route handler, as Next.js routes it: the path after /api/v1 as params.
export async function callApi(method, path, { key, body, headers = {}, jar = new Map() } = {}) {
	const route = await import("../../app/api/v1/[...path]/route.js");
	const url = new URL(path, "http://localhost:3000");
	const segments = url.pathname.replace(/^\/api\/v1\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
	const request = jsonRequest(`${url.pathname}${url.search}`, {
		method,
		body,
		headers: { ...(key && { authorization: `Bearer ${key}` }), ...headers },
	});
	const response = await runWithRequest({ jar }, () => route[method](request, { params: Promise.resolve({ path: segments }) }));
	return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) };
}
