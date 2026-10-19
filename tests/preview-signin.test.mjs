import assert from "node:assert/strict";
import { test } from "node:test";
import { getAppUrl, getConfigProblems, isProductionDeployment } from "../lib/config.js";
import { register } from "../instrumentation.js";
import { platformSent } from "./stubs/ses.mjs";

const STRONG = { BETTER_AUTH_SECRET: "s".repeat(32), SUPPRESSION_HASH_KEY: "k".repeat(32) };
const BRANCH = "mailcheap-git-feature-team.vercel.app";
const DEPLOYMENT = "mailcheap-abc123-team.vercel.app";
const PRODUCTION = "app.example.com";
const CODE = "123456";

// Names this file changes, put back afterwards. null deletes the variable.
const ENV_NAMES = [
	"NODE_ENV",
	"VERCEL_ENV",
	"VERCEL_URL",
	"VERCEL_BRANCH_URL",
	"VERCEL_PROJECT_PRODUCTION_URL",
	"APP_URL",
	"PREVIEW_SIGNIN_CODE_LOG",
	"RESEND_API_KEY",
	"MAILCHEAP_CLOUD",
	"ALLOWED_EMAILS",
	"ADMIN_EMAILS",
	"EMAIL_FROM",
	"EMAIL_PROVIDER",
	"SES_ACCESS_KEY_ID",
	"SES_SECRET_ACCESS_KEY",
	"POSTSHIBA_API_KEY",
	"POSTSHIBA_TEAM_ID",
	"POSTSHIBA_BULK_CLUSTER_ID",
];

async function withEnv(values, run) {
	const previous = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
	try {
		for (const name of ENV_NAMES) delete process.env[name];
		Object.assign(process.env, values);
		return await run();
	} finally {
		for (const [name, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
}

async function capturingInfo(run) {
	const logged = [];
	const info = console.info;
	console.info = (...args) => logged.push(args.join(" "));
	try {
		return { result: await run(), logged };
	} finally {
		console.info = info;
	}
}

function loggedCode(logged) {
	return logged.some((line) => line.includes(CODE) || line.includes("Code for"));
}

test("a preview uses its own host; production and APP_URL stay on the production path", () => {
	assert.equal(
		getAppUrl({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: BRANCH, VERCEL_URL: DEPLOYMENT, VERCEL_PROJECT_PRODUCTION_URL: PRODUCTION }),
		`https://${BRANCH}`,
		"the branch alias, which is what Better Auth's baseURL and trusted origins then use"
	);
	assert.equal(
		getAppUrl({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: `${BRANCH}/`, VERCEL_URL: DEPLOYMENT }),
		`https://${BRANCH}`,
		"a trailing slash is dropped, as APP_URL's is"
	);
	assert.equal(getAppUrl({ VERCEL_ENV: "preview", VERCEL_URL: DEPLOYMENT, VERCEL_PROJECT_PRODUCTION_URL: PRODUCTION }), `https://${DEPLOYMENT}`);
	assert.equal(getAppUrl({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "  ", VERCEL_URL: DEPLOYMENT }), `https://${DEPLOYMENT}`);
	assert.equal(
		getAppUrl({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: BRANCH, VERCEL_URL: DEPLOYMENT, APP_URL: "https://app.example.com/" }),
		"https://app.example.com",
		"APP_URL wins, including on a preview"
	);
	assert.equal(
		getAppUrl({ VERCEL_ENV: "production", VERCEL_BRANCH_URL: BRANCH, VERCEL_URL: DEPLOYMENT, VERCEL_PROJECT_PRODUCTION_URL: PRODUCTION }),
		`https://${PRODUCTION}`,
		"production ignores the preview hosts"
	);
	assert.equal(
		getAppUrl({ VERCEL_ENV: "production", APP_URL: "https://app.example.com/", VERCEL_BRANCH_URL: BRANCH, VERCEL_PROJECT_PRODUCTION_URL: PRODUCTION }),
		"https://app.example.com"
	);
	assert.equal(getAppUrl({ VERCEL_PROJECT_PRODUCTION_URL: PRODUCTION }), `https://${PRODUCTION}`, "no VERCEL_ENV: the production domain, as before");
	assert.equal(getAppUrl({}), "http://localhost:3000");
	assert.equal(getAppUrl({ VERCEL_ENV: "preview" }), "http://localhost:3000", "a preview with no host falls through");
});

// One test, so the environment changes can't overlap.
test("preview sign-in codes are logged only on an allowlisted preview, and production refuses the flag", async () => {
	const { sendSigninCode } = await import("../lib/platform-email.js");
	const preview = {
		...STRONG,
		NODE_ENV: "production",
		VERCEL_ENV: "preview",
		PREVIEW_SIGNIN_CODE_LOG: "true",
		MAILCHEAP_CLOUD: "",
		ALLOWED_EMAILS: "owner@example.com, @team.example.org",
		ADMIN_EMAILS: "admin@example.com",
		RESEND_API_KEY: "",
		EMAIL_FROM: "",
	};

	await withEnv(preview, async () => {
		assert.equal(isProductionDeployment(), false, "a Vercel preview is not production, even with NODE_ENV=production");
		assert.deepEqual(getConfigProblems(), []);
		assert.doesNotThrow(register);

		const { logged } = await capturingInfo(() => sendSigninCode({ email: "owner@example.com", code: CODE }));
		assert.deepEqual(logged, [`[signin] Code for owner@example.com: ${CODE}`]);

		const admin = await capturingInfo(() => sendSigninCode({ email: "admin@example.com", code: CODE }));
		assert.deepEqual(admin.logged, [`[signin] Code for admin@example.com: ${CODE}`], "ADMIN_EMAILS is on the same allowlist");

		const domain = await capturingInfo(() => sendSigninCode({ email: "anyone@team.example.org", code: CODE }));
		assert.deepEqual(domain.logged, [`[signin] Code for anyone@team.example.org: ${CODE}`]);

		const stranger = await capturingInfo(() =>
			assert.rejects(() => sendSigninCode({ email: "stranger@example.com", code: CODE }), (error) => {
				assert.equal(error.message.includes(CODE), false);
				return true;
			})
		);
		assert.equal(loggedCode(stranger.logged), false, "an address off the allowlist is never logged");

		process.env.MAILCHEAP_CLOUD = "true";
		const cloud = await capturingInfo(() =>
			assert.rejects(() => sendSigninCode({ email: "anyone@anywhere.dev", code: CODE }), (error) => {
				assert.equal(error.message.includes(CODE), false);
				return true;
			})
		);
		assert.equal(loggedCode(cloud.logged), false, "MailCheap Cloud's open sign-up does not widen the log");
		process.env.MAILCHEAP_CLOUD = "";

		delete process.env.PREVIEW_SIGNIN_CODE_LOG;
		const noFlag = await capturingInfo(() =>
			assert.rejects(() => sendSigninCode({ email: "owner@example.com", code: CODE }), (error) => {
				assert.equal(error.message.includes(CODE), false);
				return true;
			})
		);
		assert.equal(loggedCode(noFlag.logged), false, "the flag has to be exactly true");
		process.env.PREVIEW_SIGNIN_CODE_LOG = "yes";
		const wrongFlag = await capturingInfo(() => assert.rejects(() => sendSigninCode({ email: "owner@example.com", code: CODE })));
		assert.equal(loggedCode(wrongFlag.logged), false);
		process.env.PREVIEW_SIGNIN_CODE_LOG = "true";

		process.env.RESEND_API_KEY = "re_preview";
		process.env.EMAIL_FROM = "MailCheap <login@mail.example.com>";
		const calls = [];
		const previousFetch = globalThis.fetch;
		globalThis.fetch = async (input, init) => {
			calls.push(String(input?.url ?? input));
			assert.equal(String(init.body).includes(CODE), true);
			return Response.json({ id: "email_preview" });
		};
		try {
			const resend = await capturingInfo(() => sendSigninCode({ email: "owner@example.com", code: CODE }));
			assert.equal(loggedCode(resend.logged), false, "Resend is configured, so the code is emailed");
			assert.deepEqual(calls, ["https://api.resend.com/emails"]);
		} finally {
			globalThis.fetch = previousFetch;
			delete process.env.RESEND_API_KEY;
			process.env.EMAIL_FROM = "";
		}

		process.env.SES_ACCESS_KEY_ID = "test-ses-key-id";
		process.env.SES_SECRET_ACCESS_KEY = "test-ses-secret";
		process.env.EMAIL_FROM = "MailCheap <login@mail.example.com>";
		const before = platformSent.length;
		const ses = await capturingInfo(() => sendSigninCode({ email: "owner@example.com", code: CODE }));
		assert.equal(loggedCode(ses.logged), false, "an email provider is configured, so the code is not logged");
		assert.equal(platformSent.length, before + 1);
		assert.equal(platformSent.at(-1).to, "owner@example.com");
		assert.equal(platformSent.at(-1).text.includes(CODE), true);
	});

	await withEnv({ ...STRONG, NODE_ENV: "production", VERCEL_ENV: "production", PREVIEW_SIGNIN_CODE_LOG: "true", MAILCHEAP_CLOUD: "", ALLOWED_EMAILS: "owner@example.com" }, async () => {
		assert.equal(isProductionDeployment(), true);
		assert.match(getConfigProblems()[0], /PREVIEW_SIGNIN_CODE_LOG can't be set in production/);
		assert.throws(register, /MailCheap can't start\. PREVIEW_SIGNIN_CODE_LOG can't be set in production/);
		const { logged } = await capturingInfo(() =>
			assert.rejects(() => sendSigninCode({ email: "owner@example.com", code: CODE }), (error) => {
				assert.equal(error.message.includes(CODE), false);
				return true;
			})
		);
		assert.equal(loggedCode(logged), false, "the flag is ignored in production");
	});

	await withEnv({ ...STRONG, NODE_ENV: "development", VERCEL_ENV: "production", PREVIEW_SIGNIN_CODE_LOG: "true", RESEND_API_KEY: "", ALLOWED_EMAILS: "owner@example.com" }, async () => {
		assert.throws(register, /PREVIEW_SIGNIN_CODE_LOG can't be set in production/);
		const { logged } = await capturingInfo(() => assert.rejects(() => sendSigninCode({ email: "owner@example.com", code: CODE })));
		assert.equal(loggedCode(logged), false, "a production deployment never logs a code, even if NODE_ENV is development");
	});

	await withEnv({ ...STRONG, NODE_ENV: "production", PREVIEW_SIGNIN_CODE_LOG: "true", MAILCHEAP_CLOUD: "", ALLOWED_EMAILS: "owner@example.com" }, async () => {
		assert.equal(process.env.VERCEL_ENV, undefined);
		assert.throws(register, /PREVIEW_SIGNIN_CODE_LOG can't be set in production/);
		const { logged } = await capturingInfo(() => assert.rejects(() => sendSigninCode({ email: "owner@example.com", code: CODE })));
		assert.equal(loggedCode(logged), false);
	});

	await withEnv({ ...STRONG, NODE_ENV: "production", PREVIEW_SIGNIN_CODE_LOG: "yes" }, async () => {
		assert.deepEqual(getConfigProblems(), [], "only exactly true is the flag");
		assert.doesNotThrow(register);
	});

	await withEnv({ ...STRONG, NODE_ENV: "development", RESEND_API_KEY: "", VERCEL_ENV: "", PREVIEW_SIGNIN_CODE_LOG: "" }, async () => {
		const { logged } = await capturingInfo(() => sendSigninCode({ email: "dev@example.com", code: CODE }));
		assert.deepEqual(logged, [`[signin] Code for dev@example.com: ${CODE}`], "development still logs without the flag");
	});
});
