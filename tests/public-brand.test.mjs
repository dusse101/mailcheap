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

// The confirm link only shows a button: opening it never confirms, so link scanners can't subscribe anyone. With
// PUBLIC_PAGES_BRAND set, the confirm and unsubscribe pages wear the brand; without it they're the stock pages.
let app;
let m;
let user;

before(async () => {
	app = await startTestApp();
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		confirm: await import("../app/confirm/actions.js"),
		confirmPage: await import("../app/confirm/page.js"),
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
		test(`opening the link shows a button and changes nothing (${label})`, async () => {
			const contact = await pendingContact(`open-${label}@example.org`);
			const token = createConfirmToken({ contactId: contact._id, newsletterId: user.newsletterId });
			const html = await withEnv(env, () => renderPage(m.confirmPage, { token }));
			assert.match(html, /<form/);
			assert.match(html, label === "branded" ? /Yes, subscribe me/ : /Confirm my subscription/);
			await flushAfter();
			assert.equal(await statusOf(contact), "pending");
		});
	}

	test("the confirm forms never submit themselves", async () => {
		for (const file of ["components/FormConfirm.jsx", "components/FormConfirmBrand.jsx"]) {
			const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
			assert.doesNotMatch(source, /requestSubmit|\.submit\(\)|useEffect/, file);
		}
	});

	test("the button's POST confirms, and pressing it again still says you're in", async () => {
		const contact = await pendingContact("press@example.org");
		const token = createConfirmToken({ contactId: contact._id, newsletterId: user.newsletterId });
		assert.deepEqual(await anonymous(() => m.confirm.confirmSubscription(token)), { ok: true });
		await flushAfter();
		assert.equal(await statusOf(contact), "active");
		assert.deepEqual(await anonymous(() => m.confirm.confirmSubscription(token)), { ok: true });
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
