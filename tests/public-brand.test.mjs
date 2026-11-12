import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createConfirmToken } from "../lib/confirmation.js";
import { getPublicBrand } from "../lib/public-brand.js";
import { createUnsubscribeToken } from "../lib/unsubscribe.js";
import { activate, anonymous, as, catchRedirect, form, signIn, startTestApp, withEnv } from "./helpers/app.mjs";
import { flushAfter } from "./stubs/next-server.mjs";

// The confirm page confirms from its script, as upstream's does. With PUBLIC_PAGES_BRAND set, the confirm, keep and unsubscribe pages wear the brand; without it they're the stock pages.
// The keep page's own behavior is tests/keep.test.mjs.
let app;
let m;
let user;

before(async () => {
	app = await startTestApp();
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		confirm: await import("../app/confirm/actions.js"),
		confirmPage: await import("../app/confirm/page.js"),
		keepPage: await import("../app/keep/page.js"),
		unsubscribePage: await import("../app/unsubscribe/page.js"),
		Contact: (await import("../models/Contact.js")).default,
	};
	user = await signIn("brand-owner@example.com");
	await activate(user);
	const url = await as(user, () =>
		catchRedirect(
			m.newsletters.saveNewsletter(
				null,
				form({
					name: "Field notes",
					slug: "field-notes-brand",
					fromEmail: "hello@field-notes-brand.mailcheapmail.com",
					postalAddress: "1 Main St, Paris",
					archiveEnabled: "on",
					requireConfirmation: "on",
				})
			)
		)
	);
	user.newsletterId = url.split("/").at(-1);
});

after(() => app?.stop());

function pendingContact(email) {
	return m.Contact.create({ accountId: user.accountId, newsletterId: user.newsletterId, email, status: "pending" });
}

async function statusOf(contact) {
	return (await m.Contact.findOne({ accountId: user.accountId, _id: contact._id }).select({ status: 1 }).lean()).status;
}

async function renderPage(page, searchParams) {
	return renderToStaticMarkup(await anonymous(() => page.default({ searchParams: Promise.resolve(searchParams) })));
}

const BRAND = { PUBLIC_PAGES_BRAND: "tacoandtell" };

describe("confirming a subscription", () => {
	for (const [label, env] of [["stock", { PUBLIC_PAGES_BRAND: "" }], ["branded", BRAND]]) {
		test(`the page confirms from its script, so rendering it changes nothing (${label})`, async () => {
			const contact = await pendingContact(`open-${label}@example.org`);
			const token = createConfirmToken({ contactId: contact._id, newsletterId: user.newsletterId });
			const html = await withEnv(env, () => renderPage(m.confirmPage, { token }));
			assert.match(html, /<button[^>]*>Confirm my subscription<\/button>/, label);
			assert.doesNotMatch(html, /<form/, label);
			assert.doesNotMatch(html, /Yes, subscribe me/, label);
			if (label === "branded") assert.match(html, /Confirming your subscription/);
			await flushAfter();
			assert.equal(await statusOf(contact), "pending");
		});
	}

	test("both confirm pages confirm as soon as their script runs", async () => {
		for (const file of ["components/FormConfirm.jsx", "components/FormConfirmBrand.jsx"]) {
			const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
			assert.match(source, /useEffect\(/, file);
			assert.match(source, /confirmSubscription/, file);
			assert.doesNotMatch(source, /\/api\/confirm/, file);
		}
	});

	test("confirming works, and confirming again still says you're in", async () => {
		const contact = await pendingContact("press@example.org");
		const token = createConfirmToken({ contactId: contact._id, newsletterId: user.newsletterId });
		assert.deepEqual(await anonymous(() => m.confirm.confirmSubscription(token)), { ok: true });
		await flushAfter();
		assert.equal(await statusOf(contact), "active");
		assert.deepEqual(await anonymous(() => m.confirm.confirmSubscription(token)), { ok: true });
	});

	test("the confirm page sends no referrer", async () => {
		assert.equal(m.confirmPage.generateMetadata().referrer, "no-referrer");
	});

	test("someone already confirmed sees that on the branded page, and nothing runs again", async () => {
		const contact = await m.Contact.create({
			accountId: user.accountId,
			newsletterId: user.newsletterId,
			email: "already-in@example.org",
			status: "active",
		});
		const token = createConfirmToken({ contactId: contact._id, newsletterId: user.newsletterId });
		const html = await withEnv(BRAND, () => renderPage(m.confirmPage, { token }));
		assert.match(html, /You(?:'|&#x27;)re in! 🌮/);
		assert.match(html, /drag it to Primary/);
		assert.match(html, /Read past issues/);
		assert.match(html, /Back to Taco &amp; Tell/);
		assert.doesNotMatch(html, /<form|<button/);
		assert.equal(await statusOf(contact), "active");
		assert.equal(
			(await m.Contact.findOne({ accountId: user.accountId, _id: contact._id }).select({ confirmedAt: 1 }).lean()).confirmedAt,
			undefined,
			"showing the page does not confirm again"
		);
	});

	test("someone who went dormant sees they're in, and confirming leaves them dormant", async () => {
		const confirmedAt = new Date("2026-01-05T00:00:00Z");
		const lastChanceAt = new Date("2026-08-01T00:00:00Z");
		const contact = await m.Contact.create({
			accountId: user.accountId,
			newsletterId: user.newsletterId,
			email: "gone-quiet@example.org",
			status: "dormant",
			confirmedAt,
			lastChanceAt,
			ignoredIssues: 7,
		});
		const token = createConfirmToken({ contactId: contact._id, newsletterId: user.newsletterId });
		const html = await withEnv(BRAND, () => renderPage(m.confirmPage, { token }));
		assert.match(html, /You(?:'|&#x27;)re in/);
		assert.doesNotMatch(html, /<form|<button/);
		assert.doesNotMatch(html, /isn&#x27;t waiting to confirm/);

		await anonymous(() => m.confirm.confirmSubscription(token));
		await flushAfter();
		const after = await m.Contact.findOne({ accountId: user.accountId, _id: contact._id })
			.select({ status: 1, confirmedAt: 1, lastChanceAt: 1, ignoredIssues: 1 })
			.lean();
		assert.equal(after.status, "dormant", "the keep link or signing up again brings them back, not this");
		assert.deepEqual(after.confirmedAt, confirmedAt);
		assert.deepEqual(after.lastChanceAt, lastChanceAt);
		assert.equal(after.ignoredIssues, 7);
	});

	test("someone who left, bounced or complained is not offered a way back on", async () => {
		for (const status of ["unsubscribed", "bounced", "complained"]) {
			const contact = await m.Contact.create({
				accountId: user.accountId,
				newsletterId: user.newsletterId,
				email: `${status}@example.org`,
				status,
				...(status === "unsubscribed" && { unsubscribedAt: new Date() }),
			});
			const token = createConfirmToken({ contactId: contact._id, newsletterId: user.newsletterId });
			assert.deepEqual(await anonymous(() => m.confirm.confirmSubscription(token)), { error: "invalid" });
			const html = await withEnv(BRAND, () => renderPage(m.confirmPage, { token }));
			assert.match(html, /isn&#x27;t waiting to confirm/, status);
			assert.doesNotMatch(html, /<form|<button/, status);
			await flushAfter();
			assert.equal(await statusOf(contact), status);
		}
	});

	test("a bad, forged or expired token confirms nobody and shows the branded dead-link page", async () => {
		const contact = await pendingContact("bad-token@example.org");
		const token = createConfirmToken({ contactId: contact._id, newsletterId: user.newsletterId }, Date.now() - 31 * 86_400_000);
		for (const bad of ["not-a-token", `${token.slice(0, -2)}xx`, token]) {
			assert.deepEqual(await anonymous(() => m.confirm.confirmSubscription(bad)), { error: "invalid" });
			const html = await withEnv(BRAND, () => renderPage(m.confirmPage, { token: bad }));
			assert.match(html, /This link has gone stale/);
			assert.match(html, /href="https:\/\/tacoandtell\.com\/issues"/);
			assert.doesNotMatch(html, /<form/);
		}
		assert.equal(await statusOf(contact), "pending");
	});
});

describe("the branded pages", () => {
	test("only a known brand applies, and unset keeps MailCheap's titles", async () => {
		assert.equal(getPublicBrand({}), null);
		assert.equal(getPublicBrand({ PUBLIC_PAGES_BRAND: "someone-else" }), null);
		assert.equal(getPublicBrand({ PUBLIC_PAGES_BRAND: "tacoandtell" }).name, "Taco & Tell");
		assert.equal(await withEnv({ PUBLIC_PAGES_BRAND: "" }, () => m.unsubscribePage.generateMetadata().title), "Unsubscribe");
		assert.deepEqual(await withEnv(BRAND, () => m.unsubscribePage.generateMetadata().title), { absolute: "Unsubscribe · Taco & Tell" });
		assert.deepEqual(await withEnv(BRAND, () => m.confirmPage.generateMetadata().title), {
			absolute: "Confirm your subscription · Taco & Tell",
		});
		assert.equal(await withEnv({ PUBLIC_PAGES_BRAND: "" }, () => m.keepPage.generateMetadata().title), "Keep getting the newsletter");
		assert.equal(m.keepPage.generateMetadata().referrer, "strict-origin");
		assert.deepEqual(await withEnv(BRAND, () => m.keepPage.generateMetadata().title), {
			absolute: "Keep getting the newsletter · Taco & Tell",
		});
	});

	test("what replaces the pressed button takes the focus, and the focus ring is easy to see", async () => {
		const { default: PageBrand, PageBrandConfirmInvalid } = await import("../components/PageBrand.jsx");
		const { default: CardNotice } = await import("../components/CardNotice.jsx");
		const { MailCheck } = await import("lucide-react");
		const brand = getPublicBrand(BRAND);
		assert.match(renderToStaticMarkup(createElement(PageBrand, { brand, title: "You're in", focusTitle: true })), /<h1 tabindex="-1">/);
		assert.match(renderToStaticMarkup(createElement(PageBrandConfirmInvalid, { brand, focusTitle: true })), /<h1 tabindex="-1">/);
		assert.match(renderToStaticMarkup(createElement(PageBrand, { brand, title: "Confirm" })), /<h1>/);
		assert.match(renderToStaticMarkup(createElement(CardNotice, { icon: MailCheck, title: "You're in", focusTitle: true })), /<h1 tabindex="-1"/);
		assert.doesNotMatch(renderToStaticMarkup(createElement(CardNotice, { icon: MailCheck, title: "You're in" })), /tabindex/);
		const css = await readFile(new URL("../assets/brands/tacoandtell/brand.css", import.meta.url), "utf8");
		assert.match(css, /\.tt-button:focus-visible[^{]*\{\s*outline: 3px solid var\(--tt-navy\)/);
	});

	test("the unsubscribe page asks first, then says it's done, and a bad link says so", async () => {
		const contact = await m.Contact.create({ accountId: user.accountId, newsletterId: user.newsletterId, email: "leaving@example.org", status: "active" });
		const token = createUnsubscribeToken({ contactId: contact._id, newsletterId: user.newsletterId });

		const asking = await withEnv(BRAND, () => renderPage(m.unsubscribePage, { token }));
		assert.match(asking, /tt-page/);
		assert.match(asking, /Unsubscribe from Taco &amp; Tell\?/);
		assert.match(asking, new RegExp(`action="/api/unsubscribe\\?token=${token}"`));
		assert.equal(await statusOf(contact), "active", "showing the page unsubscribes nobody");

		const done = await withEnv(BRAND, () => renderPage(m.unsubscribePage, { token, status: "done" }));
		assert.match(done, /You&#x27;re unsubscribed/);
		assert.doesNotMatch(done, /<form/);

		const invalid = await withEnv(BRAND, () => renderPage(m.unsubscribePage, { token: "nope" }));
		assert.match(invalid, /This link doesn&#x27;t work/);

		const stock = await withEnv({ PUBLIC_PAGES_BRAND: "" }, () => renderPage(m.unsubscribePage, { token }));
		assert.doesNotMatch(stock, /tt-page/);
	});
});
