import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, test } from "node:test";
import { createConfirmToken } from "../lib/confirmation.js";
import { createKeepToken } from "../lib/last-chance.js";
import { activate, anonymous, as, catchRedirect, form, signIn, startTestApp, withEnv } from "./helpers/app.mjs";

// The keep link only shows a button: opening it never keeps, so link scanners can't answer a last-chance email.
// The button posts to /api/keep. With PUBLIC_PAGES_BRAND set, the page wears the brand; without it, it's the stock page.
let app;
let m;
let user;
let octet = 20;

const BRAND = { PUBLIC_PAGES_BRAND: "tacoandtell" };
const DAY_MS = 24 * 60 * 60 * 1000;

before(async () => {
	app = await startTestApp();
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		keep: await import("../app/keep/actions.js"),
		keepRoute: await import("../app/api/keep/route.js"),
		keepPage: await import("../app/keep/page.js"),
		Contact: (await import("../models/Contact.js")).default,
		Suppression: (await import("../models/Suppression.js")).default,
		proxy: (await import("../proxy.js")).proxy,
		NextRequest: (await import("next/server")).NextRequest,
	};
	user = await signIn("keep-owner@example.com");
	await activate(user);
	const url = await as(user, () =>
		catchRedirect(
			m.newsletters.saveNewsletter(
				null,
				form({
					name: "Field notes",
					slug: "field-notes-keep",
					fromEmail: "hello@field-notes-keep.mailcheapmail.com",
					postalAddress: "1 Main St, Paris",
					archiveEnabled: "on",
				})
			)
		)
	);
	user.newsletterId = url.split("/").at(-1);
});

after(() => app?.stop());

function ipHeaders(extra = {}) {
	octet += 1;
	return { "x-forwarded-for": `203.0.113.${octet}`, ...extra };
}

function waitingContact(email, extra = {}) {
	const now = Date.now();
	return m.Contact.create({
		accountId: user.accountId,
		newsletterId: user.newsletterId,
		email,
		status: "active",
		subscribedAt: new Date(now - 400 * DAY_MS),
		ignoredIssues: 6,
		lastEngagedAt: new Date(now - 200 * DAY_MS),
		lastChanceAt: new Date(now - 30 * DAY_MS),
		...extra,
	});
}

function tokenFor(contact) {
	return createKeepToken({ contactId: contact._id, newsletterId: user.newsletterId });
}

async function load(contact) {
	return m.Contact.findOne({ accountId: user.accountId, _id: contact._id })
		.select({ status: 1, ignoredIssues: 1, lastEngagedAt: 1, lastChanceAt: 1, lastOpenAt: 1 })
		.lean();
}

async function renderPage(searchParams, env = { PUBLIC_PAGES_BRAND: "" }) {
	const { renderToStaticMarkup } = await import("react-dom/server");
	return withEnv(env, () =>
		anonymous(async () => renderToStaticMarkup(await m.keepPage.default({ searchParams: Promise.resolve(searchParams) })))
	);
}

function post(token, headers = {}) {
	return m.keepRoute.POST(
		new Request("http://localhost:3000/api/keep", {
			method: "POST",
			headers: ipHeaders(headers),
			body: new URLSearchParams({ token: token ?? "" }),
		})
	);
}

function assertNoTokenInLinks(html, token) {
	for (const [, href] of html.matchAll(/href="([^"]*)"/g)) {
		assert.equal(href.includes(token), false, href);
		assert.equal(href.includes("token="), false, href);
	}
	assert.doesNotMatch(html, /action="\/api\/keep\?/);
}

describe("keeping a subscription", () => {
	for (const [label, env] of [["stock", { PUBLIC_PAGES_BRAND: "" }], ["branded", BRAND]]) {
		test(`opening the link shows a button and changes nothing (${label})`, async () => {
			const contact = await waitingContact(`open-${label}@example.com`);
			const original = await load(contact);
			const token = tokenFor(contact);
			const html = await renderPage({ token }, env);
			assert.match(html, /method="post"/);
			assert.match(html, /action="\/api\/keep"/);
			assert.ok(html.includes(`name="token" value="${token}"`), label);
			assert.match(html, /Yes, keep sending it/);
			assert.match(html, label === "branded" ? /Keep getting Taco &amp; Tell\?/ : /Keep getting Field notes\?/);
			assert.doesNotMatch(html, /\$ACTION_/);
			assert.equal(label === "branded", html.includes("tt-page"), label);
			assertNoTokenInLinks(html, token);
			const after = await load(contact);
			assert.equal(after.status, "active");
			assert.equal(after.ignoredIssues, original.ignoredIssues);
			assert.deepEqual(after.lastEngagedAt, original.lastEngagedAt);
			assert.deepEqual(after.lastChanceAt, original.lastChanceAt);
		});
	}

	test("the keep forms never submit themselves", async () => {
		for (const file of ["components/FormKeep.jsx", "components/FormKeepBrand.jsx", "app/keep/page.js"]) {
			const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
			assert.doesNotMatch(source, /requestSubmit|\.submit\(\)|useEffect|useActionState/, file);
		}
	});

	test("the keep page asks browsers for the origin only, so the POST still carries Origin", async () => {
		assert.equal(m.keepPage.generateMetadata().referrer, "strict-origin");
		assert.equal(await withEnv({ PUBLIC_PAGES_BRAND: "" }, () => m.keepPage.generateMetadata().title), "Keep getting the newsletter");
		assert.deepEqual(await withEnv(BRAND, () => m.keepPage.generateMetadata().title), {
			absolute: "Keep getting the newsletter · Taco & Tell",
		});
	});

	test("the button's POST keeps and comes back, and another site's POST does not", async () => {
		const contact = await waitingContact("route@example.com");
		const token = tokenFor(contact);
		const url = `http://localhost:3000/api/keep?token=${encodeURIComponent(token)}`;

		const opened = await m.keepRoute.GET(new Request(url));
		assert.equal(opened.status, 303);
		assert.equal(new URL(opened.headers.get("location")).pathname, "/keep");
		assert.equal((await load(contact)).ignoredIssues, 6, "GET keeps nobody");

		const posted = await post(token);
		assert.equal(posted.status, 303);
		const location = new URL(posted.headers.get("location"));
		assert.equal(location.pathname, "/keep");
		assert.equal(location.searchParams.get("token"), token);
		const kept = await load(contact);
		assert.equal(kept.status, "active");
		assert.equal(kept.ignoredIssues, 0);
		assert.ok(kept.lastEngagedAt > kept.lastChanceAt);
		assert.deepEqual(kept.lastChanceAt, contact.lastChanceAt);

		const fromQuery = await waitingContact("route-query@example.com");
		const queryToken = tokenFor(fromQuery);
		const queryPost = await m.keepRoute.POST(
			new Request(`http://localhost:3000/api/keep?token=${encodeURIComponent(queryToken)}`, {
				method: "POST",
				headers: ipHeaders(),
			})
		);
		assert.equal(queryPost.status, 303);
		assert.equal(new URL(queryPost.headers.get("location")).searchParams.get("token"), queryToken);
		assert.equal((await load(fromQuery)).ignoredIssues, 0);

		const again = await post(token, { origin: "http://localhost:3000" });
		assert.equal(again.status, 303);
		assert.equal((await load(contact)).status, "active");
		assert.equal((await load(contact)).ignoredIssues, 0);

		const forwarded = await waitingContact("route-forwarded@example.com");
		const forwardedPost = await post(tokenFor(forwarded), { origin: "https://app.example", "x-forwarded-host": "app.example" });
		assert.equal(forwardedPost.status, 303);
		assert.equal((await load(forwarded)).ignoredIssues, 0);

		for (const origin of ["null", "https://evil.example"]) {
			const refused = await waitingContact(`refused-${origin.length}@example.com`);
			const response = await post(tokenFor(refused), { origin, "x-forwarded-host": "localhost:3000" });
			assert.equal(response.status, 403, origin);
			assert.equal((await load(refused)).ignoredIssues, 6, origin);
			assert.equal((await load(refused)).status, "active", origin);
		}
	});

	test("a refresh after keeping shows that, and does not ask or write again", async () => {
		const contact = await waitingContact("refresh@example.com");
		const token = tokenFor(contact);
		assert.equal((await post(token)).status, 303);
		const kept = await load(contact);
		for (const [label, env, heading] of [
			["stock", { PUBLIC_PAGES_BRAND: "" }, /You(?:'|&#x27;)ll keep getting Field notes/],
			["branded", BRAND, /You(?:'|&#x27;)ll keep getting it/],
		]) {
			const html = await renderPage({ token }, env);
			assert.match(html, heading, label);
			assert.match(html, /<h1 tabindex="-1"/, label);
			assert.doesNotMatch(html, /<form/, label);
			assert.doesNotMatch(html, /Yes, keep sending it/, label);
			assertNoTokenInLinks(html, token);
			assert.equal(html.includes(token), false, label);
		}
		const after = await load(contact);
		assert.equal(after.ignoredIssues, 0);
		assert.deepEqual(after.lastEngagedAt, kept.lastEngagedAt);
		assert.deepEqual(after.lastChanceAt, kept.lastChanceAt);
	});

	test("a dormant reader comes back, and the cleanup count starts over", async () => {
		const contact = await waitingContact("dormant@example.com", { status: "dormant", ignoredIssues: 8 });
		const token = tokenFor(contact);
		const html = await renderPage({ token });
		assert.match(html, /Yes, keep sending it/);
		assert.equal((await load(contact)).status, "dormant", "showing the page brings nobody back");

		const posted = await post(token, { origin: "http://localhost:3000" });
		assert.equal(posted.status, 303);
		const after = await load(contact);
		assert.equal(after.status, "active");
		assert.equal(after.ignoredIssues, 0);
		assert.ok(after.lastEngagedAt > after.lastChanceAt);
		assert.deepEqual(after.lastChanceAt, contact.lastChanceAt);

		const done = await renderPage({ token }, BRAND);
		assert.match(done, /You(?:'|&#x27;)ll keep getting it/);
		assert.doesNotMatch(done, /<form/);
		assert.match(done, /href="https:\/\/tacoandtell\.com\/issues"/);
		assertNoTokenInLinks(done, token);
	});

	test("someone who already answered sees that, and the page leaves them alone", async () => {
		const lastOpenAt = new Date(Date.now() - DAY_MS);
		const contact = await waitingContact("answered@example.com", { ignoredIssues: 0, lastOpenAt });
		const original = await load(contact);
		const token = tokenFor(contact);
		for (const [label, env] of [["stock", { PUBLIC_PAGES_BRAND: "" }], ["branded", BRAND]]) {
			const html = await renderPage({ token }, env);
			assert.match(html, /You(?:'|&#x27;)ll keep getting/, label);
			assert.doesNotMatch(html, /<form/, label);
		}
		const after = await load(contact);
		assert.equal(after.status, "active");
		assert.equal(after.ignoredIssues, 0);
		assert.deepEqual(after.lastOpenAt, lastOpenAt);
		assert.deepEqual(after.lastEngagedAt, original.lastEngagedAt);
	});

	test("a bad, forged or expired token keeps nobody", async () => {
		const contact = await waitingContact("bad-token@example.com");
		const token = tokenFor(contact);
		const [payload, signature] = token.split(".");
		const expired = createKeepToken({ contactId: contact._id, newsletterId: user.newsletterId }, Date.now() - 91 * DAY_MS);
		const other = Buffer.from(JSON.stringify({ c: "64f1a2b3c4d5e6f7a8b9c0a2", n: String(user.newsletterId), t: Math.floor(Date.now() / 1000) })).toString("base64url");
		for (const bad of ["not-a-token", `${payload}.${signature.slice(1)}x`, `${other}.${signature}`, expired, createConfirmToken({ contactId: contact._id, newsletterId: user.newsletterId })]) {
			assert.deepEqual(await anonymous(() => m.keep.keepSending(bad)), { error: "invalid" });
			assert.equal((await post(bad)).status, 303);
			for (const [label, env, copy] of [
				["stock", { PUBLIC_PAGES_BRAND: "" }, /older than 90 days/],
				["branded", BRAND, /These links only work for 90 days/],
			]) {
				const html = await renderPage({ token: bad }, env);
				assert.match(html, /This link (?:doesn(?:'|&#x27;)t work|has gone stale)/, label);
				assert.match(html, copy, `${label} ${bad.slice(0, 12)}`);
				assert.doesNotMatch(html, /<form/, label);
				assert.doesNotMatch(html, /Yes, keep sending it/, label);
				assertNoTokenInLinks(html, bad);
			}
		}
		const after = await load(contact);
		assert.equal(after.status, "active");
		assert.equal(after.ignoredIssues, 6);
	});

	test("someone who left, bounced or complained is not brought back", async () => {
		for (const status of ["unsubscribed", "bounced", "complained", "pending"]) {
			const contact = await waitingContact(`${status}@example.com`, {
				status,
				...(status === "unsubscribed" && { unsubscribedAt: new Date() }),
			});
			const token = tokenFor(contact);
			assert.deepEqual(await anonymous(() => m.keep.keepSending(token)), { error: "invalid" });
			assert.equal((await post(token, { origin: "http://localhost:3000" })).status, 303);
			for (const [label, env, copy] of [
				["stock", { PUBLIC_PAGES_BRAND: "" }, /or you unsubscribed/],
				["branded", BRAND, /isn(?:'|&#x27;)t getting the newsletter/],
			]) {
				const html = await renderPage({ token }, env);
				assert.match(html, copy, `${label} ${status}`);
				assert.doesNotMatch(html, /<form/, `${label} ${status}`);
				assert.doesNotMatch(html, /Yes, keep sending it/, `${label} ${status}`);
				assertNoTokenInLinks(html, token);
			}
			const after = await load(contact);
			assert.equal(after.status, status);
			assert.equal(after.ignoredIssues, 6);
		}
	});

	test("a suppressed dormant address is refused", async () => {
		const contact = await waitingContact("suppressed@example.com", { status: "dormant", ignoredIssues: 9 });
		await m.Suppression.create({ accountId: user.accountId, email: contact.email, reason: "manual" });
		const token = tokenFor(contact);
		assert.deepEqual(await anonymous(() => m.keep.keepSending(token)), { error: "invalid" });
		const html = await renderPage({ token }, BRAND);
		assert.match(html, /can(?:'|&#x27;)t keep you on the list/);
		assert.doesNotMatch(html, /<form/);
		assert.doesNotMatch(html, /Yes, keep sending it/);
		assertNoTokenInLinks(html, token);

		const posted = await post(token, { origin: "http://localhost:3000" });
		assert.equal(posted.status, 303);
		const after = await load(contact);
		assert.equal(after.status, "dormant");
		assert.equal(after.ignoredIssues, 9);
		assert.ok(!after.lastEngagedAt || after.lastEngagedAt < after.lastChanceAt);
	});

	test("too many clicks from one network keep nobody", async () => {
		const contact = await waitingContact("limited@example.com");
		const token = tokenFor(contact);
		const headers = { "x-forwarded-for": "192.0.2.50" };
		for (let index = 0; index < 20; index += 1) {
			const response = await m.keepRoute.POST(
				new Request("http://localhost:3000/api/keep", { method: "POST", headers, body: new URLSearchParams({ token: "not-a-token" }) })
			);
			assert.equal(response.status, 303, String(index));
		}
		const blocked = await m.keepRoute.POST(
			new Request("http://localhost:3000/api/keep", { method: "POST", headers, body: new URLSearchParams({ token }) })
		);
		assert.equal(blocked.status, 429);
		const after = await load(contact);
		assert.equal(after.status, "active");
		assert.equal(after.ignoredIssues, 6);
	});

	test("the page and its POST are public on the app and on a newsletter host", async () => {
		for (const url of [
			"http://localhost:3000/keep?token=token",
			"http://localhost:3000/api/keep?token=token",
			"https://field-notes-keep.mailcheapmail.com/keep?token=token",
			"https://field-notes-keep.mailcheapmail.com/api/keep?token=token",
		]) {
			const response = await m.proxy(new m.NextRequest(url, { headers: { host: new URL(url).host } }));
			assert.ok(response.headers.get("x-middleware-next"), url);
		}
	});

	test("the stock done page links to the archive without the token", async () => {
		const contact = await waitingContact("archive-link@example.com", { ignoredIssues: 0, lastOpenAt: new Date() });
		const token = tokenFor(contact);
		const html = await renderPage({ token });
		assert.match(html, /href="https:\/\/field-notes-keep\.mailcheapmail\.com\/"/);
		assertNoTokenInLinks(html, token);
		assert.doesNotMatch(html, /tt-page/);
	});
});
