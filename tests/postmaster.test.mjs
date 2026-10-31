import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { renderToStaticMarkup } from "react-dom/server";
import { LIMITS, POSTMASTER } from "../lib/config.js";
import { decryptSecret } from "../lib/credentials.js";
import {
	buildDailyQuery,
	buildIdentifierQueries,
	describeGmailRate,
	getLookback,
	getWideRates,
	judgeGmailRate,
	mergeDailyRates,
	planAccountActions,
	readDays,
	readIdentifier,
	readIdentifierRates,
	readLatestDay,
	readRate,
	toDay,
} from "../lib/postmaster-rules.js";
import { getFeedbackId } from "../lib/sending-rules.js";
import { as, catchNotFound, catchRedirect, platformEmails, signIn, startTestApp, telegramMessages, withEnv } from "./helpers/app.mjs";
import { GOOGLE_ENV, createFakeGoogle } from "./helpers/google-postmaster.mjs";

// Gmail's side of spam: the Feedback-ID every email carries, and the daily check of Google Postmaster Tools, which alerts,
// pauses and blocks through the paths every other spam signal takes. tests/helpers/google-postmaster.mjs answers Google.
const CRON_SECRET = "test-cron-secret-0123456789abcdef";
const TELEGRAM = { TELEGRAM_BOT_TOKEN: "123456:test-bot-token-never-logged", TELEGRAM_CHAT_ID: "424242" };
const DOMAIN = GOOGLE_ENV.POSTMASTER_DOMAIN;
const SCOPE = "https://www.googleapis.com/auth/postmaster.traffic.readonly";
const ACCOUNT_ID = "6a00000000000000000000a1";
const CAMPAIGN_ID = "6a00000000000000000000c1";
const NEWSLETTER_ID = "6a00000000000000000000d1";
const DAY_MS = 86_400_000;
let app;
let google;
let m;
let admin;
let slugs = 0;

function daysAgo(days) {
	return toDay(Date.now() - days * DAY_MS);
}

function firstLines(messages) {
	return messages.map(({ text }) => text.split("\n")[0]);
}

function toAdmins(emails) {
	return emails.filter(({ to }) => to.includes("admin@example.com"));
}

function to(user, emails) {
	return emails.filter(({ to: recipients }) => recipients.includes(user.email));
}

function callback(params) {
	return new Request(`http://localhost:3000/api/admin/postmaster/callback?${new URLSearchParams(params)}`);
}

// What an admin clicks through: Connect, Google's consent screen, and back.
async function connect(user, options) {
	const url = await as(user, () => catchRedirect(m.connectRoute.GET()));
	const { code, state } = google.approve(url, options);
	return as(user, () => catchRedirect(m.callbackRoute.GET(callback({ code, state, scope: SCOPE }))));
}

// The daily cron's check, as if it ran at now.
function check(now = new Date()) {
	return m.postmaster.checkPostmaster({ now });
}

async function connection() {
	return m.PostmasterConnection.findById("postmaster").select("+refreshToken").lean();
}

// A customer with a newsletter, and campaigns going out unless said otherwise.
async function customer(email, campaigns = [{}]) {
	const user = await signIn(email);
	const slug = `gmail-${++slugs}`;
	const newsletter = await m.Newsletter.create({ accountId: user.accountId, name: slug, slug, fromEmail: `hello@${slug}.example.com` });
	user.newsletterId = newsletter._id;
	user.campaignIds = [];
	for (const fields of campaigns) {
		const campaign = await m.Campaign.create({ accountId: user.accountId, newsletterId: newsletter._id, subject: "Issue", status: "sending", startedAt: new Date(), ...fields });
		user.campaignIds.push(campaign._id);
	}
	return user;
}

async function campaignOf(user, index = 0) {
	return m.Campaign.findOne({ accountId: user.accountId, _id: user.campaignIds[index] }).lean();
}

async function accountOf(user) {
	return m.Account.findById(user.accountId).lean();
}

before(async () => {
	app = await startTestApp({ ...GOOGLE_ENV, ...TELEGRAM, CRON_SECRET });
	google = createFakeGoogle();
	google.install();
	m = {
		postmaster: await import("../lib/postmaster.js"),
		blocks: await import("../lib/account-blocks.js"),
		connectRoute: await import("../app/api/admin/postmaster/connect/route.js"),
		callbackRoute: await import("../app/api/admin/postmaster/callback/route.js"),
		cronRoute: await import("../app/api/cron/postmaster/route.js"),
		CardPostmaster: (await import("../components/CardPostmaster.jsx")).default,
		Account: (await import("../models/Account.js")).default,
		Alert: (await import("../models/Alert.js")).default,
		Campaign: (await import("../models/Campaign.js")).default,
		Newsletter: (await import("../models/Newsletter.js")).default,
		PostmasterConnection: (await import("../models/PostmasterConnection.js")).default,
	};
	await m.Alert.init();
	admin = await signIn("admin@example.com");
});

afterEach(() => google.state.failures.splice(0));

after(() => app?.stop());

describe("Feedback-ID", () => {
	test("the campaign, or the newsletter for signup emails; the account as mc-<accountId>; the kind; and mailcheap", () => {
		const ids = { accountId: ACCOUNT_ID, newsletterId: NEWSLETTER_ID };
		assert.equal(getFeedbackId({ ...ids, campaignId: CAMPAIGN_ID, kind: "campaign" }), `${CAMPAIGN_ID}:mc-${ACCOUNT_ID}:campaign:mailcheap`);
		assert.equal(getFeedbackId({ ...ids, campaignId: CAMPAIGN_ID, kind: "last-chance" }), `${CAMPAIGN_ID}:mc-${ACCOUNT_ID}:last-chance:mailcheap`);
		assert.equal(getFeedbackId({ ...ids, campaignId: CAMPAIGN_ID, kind: "test" }), `${CAMPAIGN_ID}:mc-${ACCOUNT_ID}:test:mailcheap`);
		assert.equal(getFeedbackId({ ...ids, kind: "welcome" }), `${NEWSLETTER_ID}:mc-${ACCOUNT_ID}:welcome:mailcheap`);
		assert.equal(getFeedbackId({ ...ids, kind: "confirmation" }), `${NEWSLETTER_ID}:mc-${ACCOUNT_ID}:confirmation:mailcheap`);
		assert.equal(getFeedbackId({ ...ids, kind: "test" }), `${NEWSLETTER_ID}:mc-${ACCOUNT_ID}:test:mailcheap`, "a welcome email's test");
	});

	test("in Gmail's format: four fields, none repeated, none with a colon, none naming a message or a person", () => {
		for (const kind of ["campaign", "last-chance", "welcome", "confirmation", "test"]) {
			const fields = getFeedbackId({ accountId: ACCOUNT_ID, newsletterId: NEWSLETTER_ID, campaignId: kind === "welcome" ? undefined : CAMPAIGN_ID, kind }).split(":");
			assert.equal(fields.length, 4, kind);
			assert.equal(fields.at(-1), "mailcheap", "the sender ID Google asks for, 5 to 15 characters, the same on every email");
			assert.equal(new Set(fields).size, 4, `${kind}: Gmail counts each field on its own`);
			assert.ok(fields.every((field) => /^[A-Za-z0-9_-]+$/.test(field)), kind);
			assert.ok(!fields.some((field) => field.includes("@")), "no address");
		}
		assert.equal(getFeedbackId({ accountId: "6a00:x", newsletterId: "a b:c", kind: "wel:come" }), "abc:mc-6a00x:welcome:mailcheap", "nothing can add a field");
	});
});

describe("Postmaster Tools' answers", () => {
	test("an identifier names an account as mc-<accountId>, a campaign or a newsletter by its id; anything else spans every account", () => {
		assert.deepEqual(readIdentifier(`mc-${ACCOUNT_ID}`), { accountId: ACCOUNT_ID });
		assert.deepEqual(readIdentifier(`MC-${ACCOUNT_ID.toUpperCase()}`), { accountId: ACCOUNT_ID });
		assert.deepEqual(readIdentifier(CAMPAIGN_ID), { objectId: CAMPAIGN_ID });
		for (const wide of ["mailcheap", "postshiba", "campaign", "welcome", "shared", "150", "mc-platform", `mc-${ACCOUNT_ID}x`, ""]) assert.equal(readIdentifier(wide), null, wide);
	});

	test("a rate is a share between 0 and 1, and anything else is left out", () => {
		assert.equal(readRate({ doubleValue: 0.0012 }), 0.0012);
		assert.equal(readRate({ floatValue: 0.003 }), 0.003);
		assert.equal(readRate({ doubleValue: 0 }), 0);
		for (const value of [{ doubleValue: 1.2 }, { doubleValue: -0.1 }, { doubleValue: Number.NaN }, { stringValue: "0.1" }, { intValue: "1" }, null, undefined]) {
			assert.equal(readRate(value), null, JSON.stringify(value));
		}
	});

	test("the daily query asks for the domain's spam rate and its feedback IDs by DKIM signer, over the week up to yesterday", () => {
		assert.deepEqual(getLookback(new Date("2026-10-15T01:00:00Z")), { start: "2026-10-08", end: "2026-10-14" });
		assert.deepEqual(getLookback(new Date("2026-03-01T23:00:00Z"), 2), { start: "2026-02-27", end: "2026-02-28" });
		assert.deepEqual(buildDailyQuery({ start: "2026-10-08", end: "2026-10-14" }), {
			metricDefinitions: [
				{ name: "spam_rate", baseMetric: { standardMetric: "SPAM_RATE" } },
				{ name: "feedback_loop_ids", baseMetric: { standardMetric: "FEEDBACK_LOOP_ID" }, filter: 'aggregation_key_type = "ALL_DKIM"' },
			],
			timeQuery: { dateRanges: { dateRanges: [{ start: { year: 2026, month: 10, day: 8 }, end: { year: 2026, month: 10, day: 14 } }] } },
			aggregationGranularity: "DAILY",
		});
	});

	test("the newest day with data wins, with its identifiers once each and only those a filter can quote", () => {
		const rows = [
			{ metric: "spam_rate", value: { doubleValue: 0.002 }, date: { year: 2026, month: 10, day: 12 } },
			{ metric: "spam_rate", value: { doubleValue: 0.0004 }, date: { year: 2026, month: 10, day: 13 } },
			{ metric: "feedback_loop_ids", value: { stringList: { values: [`mc-${ACCOUNT_ID}`, "postshiba", `mc-${ACCOUNT_ID}`, 'x" OR "y', 7] } }, date: { year: 2026, month: 10, day: 13 } },
			{ metric: "spam_rate", value: { doubleValue: 0.001 }, date: null },
		];
		assert.deepEqual(readLatestDay(rows), { day: "2026-10-13", spamRate: 0.0004, identifiers: [`mc-${ACCOUNT_ID}`, "postshiba"] });
		assert.deepEqual(readDays(rows).map(({ day, spamRate }) => [day, spamRate]), [["2026-10-12", 0.002], ["2026-10-13", 0.0004]], "every day, oldest first");
		assert.deepEqual(readLatestDay([{ metric: "feedback_loop_ids", value: { stringList: { values: ["postshiba"] } }, date: { year: 2026, month: 10, day: 9 } }]), {
			day: "2026-10-09",
			spamRate: null,
			identifiers: ["postshiba"],
		});
		assert.equal(readLatestDay([]), null);
		assert.equal(readLatestDay(undefined), null);
	});

	test("the days kept: Gmail's newer answer for a day replaces it, a day without a rate keeps what it had, the last 120 stay", () => {
		const kept = [{ day: "2026-10-12", spamRate: 0.001 }, { day: "2026-10-13", spamRate: 0.002 }];
		const read = [{ day: "2026-10-14", spamRate: 0 }, { day: "2026-10-12", spamRate: 0.0005 }, { day: "2026-10-13", spamRate: null }];
		assert.deepEqual(mergeDailyRates(kept, read), [
			{ day: "2026-10-12", spamRate: 0.0005 },
			{ day: "2026-10-13", spamRate: 0.002 },
			{ day: "2026-10-14", spamRate: 0 },
		]);
		const many = Array.from({ length: POSTMASTER.keepDays + 5 }, (_, index) => ({ day: toDay(Date.UTC(2026, 0, 1) + index * DAY_MS), spamRate: 0 }));
		const merged = mergeDailyRates(undefined, many);
		assert.equal(merged.length, POSTMASTER.keepDays);
		assert.equal(merged[0].day, many[5].day, "the oldest go");
		assert.deepEqual(mergeDailyRates(null, undefined), []);
	});

	test("each identifier's rate comes from a query of its own metric, 20 a query", () => {
		const identifiers = Array.from({ length: 45 }, (_, index) => `id-${index}`);
		const queries = buildIdentifierQueries({ day: "2026-10-13", identifiers });
		assert.deepEqual(queries.map(({ identifiers: group }) => group.length), [20, 20, 5]);
		assert.deepEqual(queries[1].query.metricDefinitions[0], {
			name: "feedback_loop_0",
			baseMetric: { standardMetric: "FEEDBACK_LOOP_SPAM_RATE" },
			filter: 'feedback_loop_id = "id-20" AND aggregation_key_type = "ALL_DKIM"',
		});
		assert.deepEqual(queries[0].query.timeQuery, { dateList: { dates: [{ year: 2026, month: 10, day: 13 }] } });
		const rows = [
			{ metric: "feedback_loop_1", value: { doubleValue: 0.004 } },
			{ metric: "feedback_loop_0", value: { doubleValue: 2 } },
			{ metric: "feedback_loop_9", value: { doubleValue: 0.001 } },
		];
		assert.deepEqual(readIdentifierRates(rows, ["a", "b"]), [{ id: "b", rate: 0.004 }]);
	});
});

describe("thresholds", () => {
	test("an account pauses from LIMITS' complaint pause level and blocks from its block level, 0.3%", () => {
		assert.equal(POSTMASTER.pauseRate, LIMITS.pause.complaintRate);
		assert.equal(POSTMASTER.blockRate, LIMITS.block.complaintRate);
		assert.equal(POSTMASTER.blockRate, 0.003);
		assert.equal(POSTMASTER.alertRate, 0.001);
		assert.equal(judgeGmailRate(0), null);
		assert.equal(judgeGmailRate(LIMITS.pause.complaintRate - 0.0001), null);
		assert.equal(judgeGmailRate(LIMITS.pause.complaintRate), "pause");
		assert.equal(judgeGmailRate(0.0029), "pause");
		assert.equal(judgeGmailRate(0.003), "block", "at the block level, not only over it");
		assert.equal(judgeGmailRate(0.02), "block");
		assert.equal(describeGmailRate(0.0042), "Gmail reported a spam rate of 0.42% for your emails (Google Postmaster Tools)");
	});

	test("each account is judged on its highest flag; a blocked account, or one unblocked after that day, is left alone", () => {
		const other = "6a00000000000000000000a2";
		const flags = [
			{ id: CAMPAIGN_ID, rate: 0.004, accountId: ACCOUNT_ID },
			{ id: `mc-${ACCOUNT_ID}`, rate: 0.0012, accountId: ACCOUNT_ID },
			{ id: `mc-${other}`, rate: 0.0015, accountId: other },
			{ id: "postshiba", rate: 0.01, accountId: null, isWide: true },
		];
		const active = new Map([
			[ACCOUNT_ID, { status: "active" }],
			[other, { status: "active" }],
		]);
		assert.deepEqual(planAccountActions({ day: "2026-10-13", flags, accounts: active }), [
			{ accountId: ACCOUNT_ID, id: CAMPAIGN_ID, rate: 0.004, level: "block", action: "block" },
			{ accountId: other, id: `mc-${other}`, rate: 0.0015, level: "pause", action: "pause" },
		]);
		const blocked = new Map([
			[ACCOUNT_ID, { status: "paused" }],
			[other, { status: "active", unblockedAt: new Date("2026-10-13T20:00:00Z") }],
		]);
		assert.deepEqual(
			planAccountActions({ day: "2026-10-13", flags, accounts: blocked }).map(({ action, why }) => [action, why]),
			[
				["skip", "already blocked"],
				["skip", "unblocked after these emails"],
			]
		);
		const unblockedBefore = new Map([[other, { status: "active", unblockedAt: new Date("2026-10-12T23:00:00Z") }]]);
		assert.equal(planAccountActions({ day: "2026-10-13", flags: [flags[2]], accounts: unblockedBefore })[0].action, "pause", "emails sent after the unblock count");
		assert.equal(planAccountActions({ day: "2026-10-13", flags: [{ id: `mc-${other}`, rate: 0.0005, accountId: other }], accounts: active })[0].action, "none");
		assert.equal(planAccountActions({ day: "2026-10-13", flags: [flags[2]], accounts: new Map() })[0].why, "no such account");
	});

	test("the domain's rate, and identifiers of no account, alert at 0.1%", () => {
		const flags = [
			{ id: "postshiba", rate: 0.0011, isWide: true },
			{ id: "mailcheap", rate: 0.0009, isWide: true },
			{ id: `mc-${ACCOUNT_ID}`, rate: 0.05, accountId: ACCOUNT_ID, isWide: false },
		];
		assert.deepEqual(getWideRates({ domain: DOMAIN, spamRate: 0.001, flags }), [
			{ label: DOMAIN, rate: 0.001 },
			{ label: "feedback ID postshiba", rate: 0.0011 },
		]);
		assert.deepEqual(getWideRates({ domain: DOMAIN, spamRate: 0.0009, flags: [] }), []);
		assert.deepEqual(getWideRates({ domain: DOMAIN, spamRate: null, flags: [] }), []);
	});
});

describe("connecting Postmaster Tools", () => {
	test("only an admin starts or finishes the connection; anyone else gets a 404", async () => {
		const user = await signIn("not-an-admin@example.com");
		assert.equal(await as(user, () => catchNotFound(m.connectRoute.GET())), true);
		assert.equal(await as(user, () => catchNotFound(m.callbackRoute.GET(callback({ code: "code-1", state: "state" })))), true);
		assert.equal(await m.PostmasterConnection.exists({ _id: "postmaster" }), null);
	});

	test("without Google's client or the encryption key, the admin page names what's missing and Connect goes nowhere", async () => {
		await withEnv({ GOOGLE_CLIENT_SECRET: "", CREDENTIALS_ENCRYPTION_KEY: "" }, async () => {
			assert.equal(await as(admin, () => catchRedirect(m.connectRoute.GET())), "/admin?postmaster=missing");
			const html = renderToStaticMarkup(await m.CardPostmaster({}));
			assert.match(html, /Set GOOGLE_CLIENT_SECRET, CREDENTIALS_ENCRYPTION_KEY to read Gmail/);
		});
		await withEnv({ POSTMASTER_DOMAIN: "", SHARED_DOMAIN: "" }, async () => {
			assert.deepEqual(m.postmaster.getPostmasterSetup().missing, ["POSTMASTER_DOMAIN"]);
		});
		assert.equal(m.postmaster.getPostmasterSetup({ ...GOOGLE_ENV, POSTMASTER_DOMAIN: "", SHARED_DOMAIN: "mailcheap.ai" }).domain, "mailcheap.ai", "the shared domain by default");
	});

	test("before a connection, the admin page shows Connect with the redirect URI to add to the OAuth client", async () => {
		const html = renderToStaticMarkup(await m.CardPostmaster({}));
		assert.match(html, /href="\/api\/admin\/postmaster\/connect"/);
		assert.match(html, /http:\/\/localhost:3000\/api\/admin\/postmaster\/callback/);
		assert.match(html, new RegExp(`has ${DOMAIN.replace(".", "\\.")} in Postmaster Tools`));
	});

	test("Connect opens Google's consent screen for Postmaster Tools' read scope, offline, with PKCE and a state only this browser holds", async () => {
		const url = new URL(await as(admin, () => catchRedirect(m.connectRoute.GET())));
		assert.equal(`${url.origin}${url.pathname}`, "https://accounts.google.com/o/oauth2/v2/auth");
		const params = url.searchParams;
		assert.equal(params.get("client_id"), GOOGLE_ENV.GOOGLE_CLIENT_ID);
		assert.equal(params.get("redirect_uri"), "http://localhost:3000/api/admin/postmaster/callback");
		assert.equal(params.get("response_type"), "code");
		assert.deepEqual(params.get("scope").split(" "), ["openid", "email", SCOPE]);
		assert.equal(params.get("access_type"), "offline");
		assert.equal(params.get("prompt"), "consent", "or Google sends no refresh token on a second connection");
		assert.equal(params.get("code_challenge_method"), "S256");
		assert.match(params.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
		const [state, verifier] = admin.jar.get(m.postmaster.STATE_COOKIE).split(".");
		assert.equal(params.get("state"), state);
		assert.ok(verifier.length >= 43 && !url.href.includes(verifier), "the verifier stays in the cookie");
	});

	test("Google's answer stores the refresh token encrypted, and nothing a page reads includes it", async () => {
		assert.equal(await connect(admin, { email: "owner@example.com" }), "/admin?postmaster=connected");
		assert.equal(admin.jar.has(m.postmaster.STATE_COOKIE), false, "the state is used once");
		const stored = await connection();
		const [refreshToken] = [...google.state.refreshTokens.keys()].slice(-1);
		assert.notEqual(stored.refreshToken, refreshToken);
		assert.match(stored.refreshToken, /^v1\./);
		assert.equal(decryptSecret(stored.refreshToken, { context: "google-postmaster" }), refreshToken);
		assert.throws(() => decryptSecret(stored.refreshToken, { context: "postshiba-smtp:x:y" }), /doesn't decrypt/);
		assert.equal(stored.email, "owner@example.com");
		assert.equal(stored.connectedBy, "admin@example.com");
		assert.equal(stored.problem, undefined);

		const status = await m.postmaster.getPostmasterStatus();
		assert.equal(status.connection.refreshToken, undefined, "left out of every read but the check's");
		const html = renderToStaticMarkup(await m.CardPostmaster({ notice: "connected" }));
		assert.ok(!html.includes(refreshToken) && !html.includes(stored.refreshToken));
		assert.match(html, /Connected\. Gmail&#x27;s spam rates are read once a day\./);
		assert.match(html, /owner@example\.com/);
	});

	test("another state, a canceled consent screen or Postmaster Tools left unticked changes nothing", async () => {
		const before = (await connection()).refreshToken;
		const url = await as(admin, () => catchRedirect(m.connectRoute.GET()));
		const forged = google.approve(url);
		assert.equal(await as(admin, () => catchRedirect(m.callbackRoute.GET(callback({ code: forged.code, state: "someone-elses-state" })))), "/admin?postmaster=expired");
		assert.equal(await as(admin, () => catchRedirect(m.callbackRoute.GET(callback({ code: forged.code, state: forged.state })))), "/admin?postmaster=expired", "the cookie went with the first answer");

		const canceled = google.approve(await as(admin, () => catchRedirect(m.connectRoute.GET())));
		assert.equal(await as(admin, () => catchRedirect(m.callbackRoute.GET(callback({ error: "access_denied", state: canceled.state })))), "/admin?postmaster=denied");

		assert.equal(await connect(admin, { scopes: ["openid", "email"] }), "/admin?postmaster=scope");
		assert.equal((await connection()).refreshToken, before);
	});
});

describe("the daily check", () => {
	test("runs only with CRON_SECRET", async () => {
		const call = (authorization) => m.cronRoute.GET(new Request("http://localhost:3000/api/cron/postmaster", { headers: authorization ? { authorization } : {} }));
		assert.equal((await withEnv({ CRON_SECRET: "" }, () => call(`Bearer ${CRON_SECRET}`))).status, 503);
		for (const authorization of [undefined, CRON_SECRET, `Bearer ${CRON_SECRET}x`]) assert.equal((await call(authorization)).status, 401);
		const response = await call(`Bearer ${CRON_SECRET}`);
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { postmaster: { skipped: "no data from Gmail" } });
	});

	test("without its settings, or with no connected account, it does nothing and asks Google nothing", async () => {
		const before = { queries: google.state.queries.length, tokens: google.state.tokenRequests.length, telegram: telegramMessages.length };
		await withEnv({ GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" }, async () => {
			assert.deepEqual(await check(), { skipped: "Postmaster Tools isn't set up" });
		});
		const saved = await m.PostmasterConnection.findById("postmaster").select("+refreshToken").lean();
		await m.PostmasterConnection.deleteOne({ _id: "postmaster" });
		try {
			assert.deepEqual(await check(), { skipped: "Postmaster Tools isn't connected" });
		} finally {
			await m.PostmasterConnection.collection.insertOne(saved);
		}
		assert.deepEqual(
			{ queries: google.state.queries.length, tokens: google.state.tokenRequests.length, telegram: telegramMessages.length },
			before
		);
	});

	test("a domain Gmail has no data for yet passes quietly", async () => {
		const before = { telegram: telegramMessages.length, emails: platformEmails.length };
		assert.deepEqual(await check(), { skipped: "no data from Gmail" });
		assert.deepEqual({ telegram: telegramMessages.length, emails: platformEmails.length }, before);
		assert.ok((await connection()).checkedAt);
	});

	test("the domain at 0.1% alerts the admins once a day of data, on Telegram and by email; under it, nothing", async () => {
		const day = daysAgo(3);
		google.setDay(DOMAIN, day, { spamRate: 0.0013 });
		const before = { telegram: telegramMessages.length, emails: platformEmails.length };
		const result = await check();
		assert.deepEqual(result, { day, spamRate: 0.0013, alerted: true, flagged: [] });
		assert.deepEqual(firstLines(telegramMessages.slice(before.telegram)), ["<b>MailCheap</b> · Gmail spam rate is high"]);
		assert.match(telegramMessages.at(-1).text, new RegExp(`Google Postmaster Tools, ${day}: ${DOMAIN.replace(".", "\\.")} at 0\\.13%, over 0\\.10%\\.`));
		assert.deepEqual(toAdmins(platformEmails.slice(before.emails)).map(({ subject }) => subject), ["[MailCheap] Gmail spam rate is high"]);

		assert.deepEqual(await check(), { skipped: `nothing newer than ${day}` }, "the same day is never acted on twice");
		assert.equal(telegramMessages.length - before.telegram, 1);

		google.setDay(DOMAIN, daysAgo(2), { spamRate: 0.0009 });
		assert.equal((await check()).alerted, false);
		assert.equal(telegramMessages.length - before.telegram, 1, "under 0.1%");
	});

	test("an account flagged between the pause and block levels: its sends pause and its owner hears why; a send resumed from such a pause goes on", async () => {
		const user = await customer("gmail-pause@example.com", [{}, { ratesAcceptedAt: new Date() }]);
		const idle = await customer("gmail-idle@example.com", []);
		const day = daysAgo(1);
		google.setDay(DOMAIN, day, { spamRate: 0.0005, identifiers: { [`mc-${user.accountId}`]: 0.0015, [`mc-${idle.accountId}`]: 0.001, [`mc-${admin.accountId}`]: 0.0002 } });
		const before = { telegram: telegramMessages.length, emails: platformEmails.length };

		const { flagged } = await check();
		assert.deepEqual(
			flagged.map(({ id, action }) => [id, action]),
			[
				[`mc-${user.accountId}`, "paused"],
				[`mc-${idle.accountId}`, "warned"],
				[`mc-${admin.accountId}`, "none"],
			]
		);
		const paused = await campaignOf(user);
		assert.equal(paused.status, "paused");
		assert.equal(paused.pauseCode, "high_rates", "resuming it accepts the rates, as for a send's own");
		assert.equal(
			paused.pauseReason,
			"Gmail reported a spam rate of 0.15% for your emails (Google Postmaster Tools). Check that your contacts asked for your emails before you resume: at 0.30%, the account is blocked."
		);
		assert.equal((await campaignOf(user, 1)).status, "sending", "its owner resumed it from a rates pause already");
		assert.equal((await accountOf(user)).status, "active", "not blocked");

		assert.deepEqual(to(user, platformEmails.slice(before.emails)).map(({ subject }) => subject), ["[MailCheap] Campaign paused"]);
		const [warning] = to(idle, platformEmails.slice(before.emails));
		assert.equal(warning.subject, "[MailCheap] Gmail reports spam complaints");
		assert.match(warning.text, /Gmail reported a spam rate of 0\.10% for your emails \(Google Postmaster Tools\)\. Nothing is paused, but at 0\.30% the account is blocked/);
		assert.equal(telegramMessages.length, before.telegram, "pauses and warnings go to the owners only");
		assert.equal(to(admin, platformEmails.slice(before.emails)).length, 0);
	});

	test("an account at 0.3% is blocked through the block path, with Gmail's reason, and never blocked twice", async () => {
		const user = await customer("gmail-block@example.com");
		const day = daysAgo(0);
		google.setDay(DOMAIN, day, { identifiers: { [`mc-${user.accountId}`]: 0.0042 } });
		const before = { telegram: telegramMessages.length, emails: platformEmails.length };

		const { flagged } = await check(new Date(Date.now() + DAY_MS));
		assert.deepEqual(flagged, [{ id: `mc-${user.accountId}`, rate: 0.0042, accountId: String(user.accountId), action: "blocked" }]);
		const account = await accountOf(user);
		assert.equal(account.status, "paused");
		assert.equal(account.pausedBy, "gmail");
		assert.equal(account.pauseReason, "Gmail reported a spam rate of 0.42% for your emails (Google Postmaster Tools)");
		assert.equal((await campaignOf(user)).pauseCode, "account_blocked");
		assert.deepEqual(firstLines(telegramMessages.slice(before.telegram)), ["<b>MailCheap</b> · Account blocked"]);
		assert.match(telegramMessages.at(-1).text, /blocked by Gmail's spam rate: Gmail reported a spam rate of 0\.42% for your emails \(Google Postmaster Tools\)/);
		assert.deepEqual(toAdmins(platformEmails.slice(before.emails)).map(({ subject }) => subject), ["[MailCheap] Account blocked"]);
		assert.match(toAdmins(platformEmails.slice(before.emails))[0].text, new RegExp(`feedback ID mc-${user.accountId} at 0\\.42%, the block level is 0\\.30%`));
		assert.deepEqual(to(user, platformEmails.slice(before.emails)).map(({ subject }) => subject), ["[MailCheap] Account blocked"]);

		const next = toDay(Date.now() + DAY_MS);
		google.setDay(DOMAIN, next, { identifiers: { [`mc-${user.accountId}`]: 0.006 } });
		const again = await check(new Date(Date.now() + 2 * DAY_MS));
		assert.deepEqual(again.flagged.map(({ action }) => action), ["skip"], "already blocked");
		assert.equal(telegramMessages.length - before.telegram, 1);
		assert.equal((await accountOf(user)).pausedAt.getTime(), account.pausedAt.getTime());
	});

	test("once an admin unblocks it, Gmail's data on the emails before then doesn't block it again", async () => {
		const user = await customer("gmail-unblocked@example.com");
		await m.blocks.blockAccount(user.accountId, { reason: "Checked by hand", by: "admin" });
		assert.equal(await m.blocks.unblockAccount(user.accountId), true);
		const day = toDay(Date.now() + 2 * DAY_MS);
		google.setDay(DOMAIN, day, { identifiers: { [`mc-${user.accountId}`]: 0.01 } });
		const { unblockedAt } = await accountOf(user);
		assert.ok(unblockedAt);

		await m.Account.updateOne({ _id: user.accountId }, { $set: { unblockedAt: new Date(Date.parse(`${day}T09:00:00Z`)) } });
		const result = await check(new Date(Date.now() + 3 * DAY_MS));
		assert.deepEqual(result.flagged.map(({ action }) => action), ["skip"]);
		assert.equal((await accountOf(user)).status, "active");
	});

	test("a flagged campaign or newsletter names its account; an id that names nothing, nobody; identifiers of every account alert", async () => {
		const byCampaign = await customer("gmail-campaign@example.com");
		const byNewsletter = await customer("gmail-newsletter@example.com");
		const gone = new mongoose.Types.ObjectId().toString();
		const day = toDay(Date.now() + 3 * DAY_MS);
		google.setDay(DOMAIN, day, {
			spamRate: 0.0002,
			identifiers: { [String(byCampaign.campaignIds[0])]: 0.0035, [String(byNewsletter.newsletterId)]: 0.0011, [gone]: 0.02, postshiba: 0.0016 },
		});
		const before = { telegram: telegramMessages.length };
		const { flagged, alerted } = await check(new Date(Date.now() + 4 * DAY_MS));
		assert.deepEqual(
			flagged.map(({ id, accountId, action }) => [id, accountId, action]),
			[
				[String(byCampaign.campaignIds[0]), String(byCampaign.accountId), "blocked"],
				[String(byNewsletter.newsletterId), String(byNewsletter.accountId), "paused"],
				[gone, null, "unknown"],
				["postshiba", null, "wide"],
			]
		);
		assert.equal((await accountOf(byCampaign)).pausedBy, "gmail");
		assert.equal((await campaignOf(byNewsletter)).status, "paused");
		assert.equal(alerted, true);
		assert.deepEqual(firstLines(telegramMessages.slice(before.telegram)), ["<b>MailCheap</b> · Account blocked", "<b>MailCheap</b> · Gmail spam rate is high"]);
		assert.match(telegramMessages.at(-1).text, /feedback ID postshiba at 0\.16%/);
		assert.doesNotMatch(telegramMessages.at(-1).text, new RegExp(gone), "an id of nothing isn't every account's");

		const stored = await connection();
		assert.equal(stored.lastDay, day);
		assert.deepEqual(stored.lastRun.flagged.map(({ action }) => action), ["blocked", "paused", "unknown", "wide"]);
		const html = renderToStaticMarkup(await m.CardPostmaster({}));
		assert.match(html, /4 feedback IDs/);
		assert.match(html, /Every account/);
	});

	test("Google refusing the token or the domain alerts once until it works again; an outage waits quietly for the next day", async () => {
		const before = { telegram: telegramMessages.length, emails: platformEmails.length };
		google.fail(/oauth2\.googleapis\.com\/token$/, 503, { error: "backend_error" });
		assert.match((await check()).failed, /Google token refresh: 503/);
		assert.equal(telegramMessages.length, before.telegram, "an outage isn't broken credentials");

		google.revokeRefreshTokens();
		const refused = await check();
		assert.match(refused.refused, /Google token refresh: 400 invalid_grant \(Token has been expired or revoked\.\)/);
		assert.equal(refused.alerted, true);
		assert.deepEqual(firstLines(telegramMessages.slice(before.telegram)), ["<b>MailCheap</b> · Postmaster Tools refused MailCheap"]);
		assert.ok(!telegramMessages.at(-1).text.includes("1//refresh-"), "no token in the alert");
		assert.deepEqual(await check(), { refused: refused.refused });
		assert.equal(telegramMessages.length - before.telegram, 1, "one note, however many days it stays broken");
		assert.match(renderToStaticMarkup(await m.CardPostmaster({})), /Postmaster Tools refused: Google token refresh: 400 invalid_grant/);

		assert.equal(await connect(admin), "/admin?postmaster=connected");
		assert.equal((await connection()).problem, undefined, "a new connection ends it");
		google.setAccess(DOMAIN, false);
		const denied = await check();
		assert.match(denied.refused, /Google Postmaster Tools: 403 PERMISSION_DENIED/);
		assert.equal(telegramMessages.length - before.telegram, 2, "a new stretch, a new note");
		google.setAccess(DOMAIN, true);
		await check();
		assert.equal((await connection()).problem, undefined, "working again ends it");
	});

	test("a stored token that no longer decrypts counts as refused, and pages of Gmail's answer are all read", async () => {
		google.state.pageSize = 2;
		try {
			const user = await customer("gmail-pages@example.com");
			const day = toDay(Date.now() + 5 * DAY_MS);
			google.setDay(DOMAIN, day, { spamRate: 0.0001, identifiers: { [`mc-${user.accountId}`]: 0.0009, mailcheap: 0.0001 } });
			const queries = google.state.queries.length;
			const { flagged } = await check(new Date(Date.now() + 6 * DAY_MS));
			assert.ok(google.state.queries.length - queries > 2, "more than one page each");
			assert.deepEqual(flagged.map(({ id, action }) => [id, action]), [
				[`mc-${user.accountId}`, "paused"],
				["mailcheap", "wide"],
			]);
		} finally {
			google.state.pageSize = 200;
		}
		await withEnv({ CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") }, async () => {
			assert.match((await check()).refused, /The stored refresh token doesn't decrypt/);
		});
	});

	test("keeps the spam rate of every day it reads, with nothing newer to act on too, Gmail's newer answer for a day winning", async () => {
		const [older, newer] = [daysAgo(6), daysAgo(5)];
		google.setDay(DOMAIN, older, { spamRate: 0.0002 });
		google.setDay(DOMAIN, newer, { spamRate: 0 });
		const rates = async () => new Map((await connection()).days.map(({ day, spamRate }) => [day, spamRate]));
		assert.match((await check()).skipped, /^nothing newer than /);
		assert.deepEqual([(await rates()).get(older), (await rates()).get(newer)], [0.0002, 0]);

		google.setDay(DOMAIN, older, { spamRate: 0.0004 });
		await check();
		assert.equal((await rates()).get(older), 0.0004);
		const days = (await connection()).days.map(({ day }) => day);
		assert.deepEqual(days, [...days].sort(), "oldest first");
	});
});
