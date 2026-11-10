import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createConfirmToken } from "../lib/confirmation.js";
import { createUnsubscribeToken } from "../lib/unsubscribe.js";
import { activate, anonymous, as, callApi, catchRedirect, form, signIn, startTestApp, withEnv } from "./helpers/app.mjs";
import { flushAfter } from "./stubs/next-server.mjs";
import { sent as sesEmails } from "./stubs/ses.mjs";

// A pending reader who opts out has to end up out: the link, the mail app's button and the provider's event all
// answered "you're unsubscribed" while the contact stayed pending, with nothing recorded.
let app;
let m;
let user;
let visitor = 0;

async function customer(email) {
	const signedIn = await signIn(email);
	await activate(signedIn);
	signedIn.slug = email.split("@")[0];
	const url = await as(signedIn, () =>
		catchRedirect(m.newsletters.saveNewsletter(null, form({ name: `${signedIn.slug} news`, slug: signedIn.slug, postalAddress: "1 Main St, Paris" })))
	);
	signedIn.newsletterId = url.split("/").at(-1);
	signedIn.key = (await as(signedIn, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;
	signedIn.signupsKey = (await as(signedIn, () => m.apiKeys.createApiKey(null, form({ name: "Site", level: "signups" })))).key;
	const saved = await callApi("PATCH", `/api/v1/newsletters/${signedIn.slug}`, { key: signedIn.key, body: { requireConfirmation: true } });
	assert.equal(saved.status, 200, JSON.stringify(saved.body));
	return signedIn;
}

function signUp(email, extra = {}) {
	return callApi("POST", "/api/v1/contacts", {
		key: user.signupsKey,
		body: { newsletter: user.slug, email, source: "website", ip: `203.0.113.${++visitor % 250}`, ...extra },
	});
}

async function pending(email) {
	const response = await signUp(email);
	assert.equal(response.status, 201, JSON.stringify(response.body));
	await flushAfter();
	const contact = await find(email);
	assert.equal(contact.status, "pending");
	return contact;
}

function find(email) {
	return m.Contact.findOne({ accountId: user.accountId, email }).lean();
}

function unsubscribeRequest(contact, body) {
	const token = createUnsubscribeToken({ contactId: contact._id, newsletterId: user.newsletterId });
	return { token, request: new Request(`http://localhost:3000/api/unsubscribe?token=${token}`, { method: "POST", ...(body && { body }) }) };
}

function assertLeft(contact, via) {
	assert.equal(contact.status, "unsubscribed");
	assert.ok(contact.unsubscribedAt);
	const change = contact.statusChanges.at(-1);
	assert.deepEqual([change.from, change.to, change.via], ["pending", "unsubscribed", via]);
}

before(async () => {
	app = await startTestApp();
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		unsubscribeRoute: await import("../app/api/unsubscribe/route.js"),
		unsubscribePage: await import("../app/unsubscribe/page.js"),
		confirmRoute: await import("../app/api/confirm/route.js"),
		events: await import("../lib/email-events.js"),
		Contact: (await import("../models/Contact.js")).default,
		Message: (await import("../models/Message.js")).default,
		Suppression: (await import("../models/Suppression.js")).default,
	};
	user = await customer("unsub-pending@example.com");
});

after(() => app?.stop());

describe("unsubscribing while pending", () => {
	test("the page's form moves them to unsubscribed", async () => {
		const contact = await pending("page@example.org");
		const { request } = unsubscribeRequest(contact, new URLSearchParams({ source: "page" }));
		const response = await m.unsubscribeRoute.POST(request);
		assert.equal(response.status, 303);
		assert.match(response.headers.get("location"), /status=done/);
		assertLeft(await find("page@example.org"), "link");
	});

	test("the mail app's one-click button moves them to unsubscribed", async () => {
		const contact = await pending("oneclick@example.org");
		const response = await m.unsubscribeRoute.POST(unsubscribeRequest(contact).request);
		assert.equal(response.status, 200);
		assertLeft(await find("oneclick@example.org"), "mail-app");
	});

	test("the provider's unsubscribe event moves them to unsubscribed", async () => {
		const contact = await pending("provider@example.org");
		const message = await m.Message.findOne({ accountId: user.accountId, contactId: contact._id, kind: "confirmation" }).lean();
		await m.events.handleEmailEvent({
			type: "unsubscribe",
			accountId: String(user.accountId),
			messageId: String(message._id),
			email: message.email,
			emails: [message.email],
		});
		assertLeft(await find("provider@example.org"), "provider");
	});

	test("the page asks them instead of saying it's done, and says so once it is", async () => {
		const contact = await pending("asked@example.org");
		const { token, request } = unsubscribeRequest(contact, new URLSearchParams({ source: "page" }));
		const render = async () =>
			renderToStaticMarkup(
				await anonymous(() => withEnv({ PUBLIC_PAGES_BRAND: "" }, () => m.unsubscribePage.default({ searchParams: Promise.resolve({ token }) })))
			);
		assert.match(await render(), /action="\/api\/unsubscribe\?token=/, "nothing has happened yet, so it shows the button");
		assert.equal((await find("asked@example.org")).status, "pending", "opening the page changes nothing");
		await m.unsubscribeRoute.POST(request);
		assert.equal(/action="\/api\/unsubscribe\?token=/.test(await render()), false);
	});

	test("opening the unsubscribe link alone changes nothing", async () => {
		const contact = await pending("scanner@example.org");
		const token = createUnsubscribeToken({ contactId: contact._id, newsletterId: user.newsletterId });
		const response = m.unsubscribeRoute.GET(new Request(`http://localhost:3000/api/unsubscribe?token=${token}`));
		assert.equal(response.status, 303);
		assert.equal((await find("scanner@example.org")).status, "pending");
	});

	test("their old confirmation link no longer adds them, and only signing up again with consent brings them back", async () => {
		const contact = await pending("changed-mind@example.org");
		await m.unsubscribeRoute.POST(unsubscribeRequest(contact).request);
		const token = createConfirmToken({ contactId: contact._id, newsletterId: user.newsletterId });
		await anonymous(() =>
			m.confirmRoute.POST(
				new Request("http://localhost:3000/api/confirm", {
					method: "POST",
					headers: { origin: "http://localhost:3000" },
					body: new URLSearchParams({ token }),
				})
			)
		);
		assert.equal((await find("changed-mind@example.org")).status, "unsubscribed");

		const before = sesEmails.length;
		const plain = await signUp("changed-mind@example.org");
		assert.equal(plain.body.status, "unsubscribed", "signing up without resubscribe changes nothing");
		await flushAfter();
		assert.equal(sesEmails.length, before);

		// Past the resend wait, so the fresh confirmation email isn't held back.
		await m.Message.collection.updateMany({ contactId: contact._id, kind: "confirmation" }, { $set: { createdAt: new Date(Date.now() - 11 * 60 * 1000) } });
		const again = await signUp("changed-mind@example.org", { resubscribe: true });
		assert.equal(again.body.status, "pending");
		await flushAfter();
		assert.equal(sesEmails.slice(before).filter((email) => email.to === "changed-mind@example.org").length, 1);
	});

	test("a bounced or complained contact stays as it is", async () => {
		for (const status of ["bounced", "complained"]) {
			const email = `${status}@example.org`;
			const contact = await pending(email);
			await m.Contact.collection.updateOne({ _id: contact._id }, { $set: { status } });
			const response = await m.unsubscribeRoute.POST(unsubscribeRequest(contact).request);
			assert.equal(response.status, 200);
			assert.equal((await find(email)).status, status);
		}
	});
});
