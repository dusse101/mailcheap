import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createUnsubscribeToken } from "../lib/unsubscribe.js";
import { activate, as, callApi, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";
import { flushAfter } from "./stubs/next-server.mjs";
import { sent as sesEmails } from "./stubs/ses.mjs";

// Signing up again with resubscribe: true, as tacoandtell.com's form does: someone who unsubscribed or went dormant goes
// back to pending and gets a fresh confirmation email, and only its button makes them active again. Bounces,
// complaints and suppressed addresses stay where they are, and nothing a stranger types can make anyone active.
let app;
let m;
let visitor = 0;

async function customer(email) {
	const user = await signIn(email);
	await activate(user);
	user.slug = email.split("@")[0];
	const url = await as(user, () =>
		catchRedirect(m.newsletters.saveNewsletter(null, form({ name: `${user.slug} news`, slug: user.slug, postalAddress: "1 Main St, Paris" })))
	);
	user.newsletterId = url.split("/").at(-1);
	user.key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;
	user.signupsKey = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Site", level: "signups" })))).key;
	const confirm = await callApi("PATCH", `/api/v1/newsletters/${user.slug}`, { key: user.key, body: { requireConfirmation: true } });
	assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
	return user;
}

function signUp(user, email, fields = { resubscribe: true }) {
	return callApi("POST", "/api/v1/contacts", {
		key: user.signupsKey,
		body: { newsletter: user.slug, email, source: "website", ip: `192.0.2.${++visitor % 250}`, ...fields },
	});
}

async function importRows(user, rows) {
	const result = await as(user, () => m.contacts.importContacts({ newsletterId: user.newsletterId, consent: true, rows }));
	assert.ok(result.importId, JSON.stringify(result));
}

function findContact(user, email) {
	return m.Contact.findOne({ accountId: user.accountId, newsletterId: user.newsletterId, email }).lean();
}

async function unsubscribeByLink(user, email) {
	const contact = await findContact(user, email);
	const token = createUnsubscribeToken({ contactId: contact._id, newsletterId: user.newsletterId });
	const response = await m.unsubscribeRoute.POST(new Request(`http://localhost:3000/api/unsubscribe?token=${token}`, { method: "POST" }));
	assert.equal(response.status, 200);
	assert.equal((await findContact(user, email)).status, "unsubscribed");
}

// The confirmation emails sent since `from`, by address.
function confirmationsSince(from) {
	return sesEmails
		.slice(from)
		.filter(({ subject }) => /^Confirm your subscription/.test(subject))
		.map(({ to }) => to);
}

function pastResendWindow(user) {
	return m.Message.collection.updateMany(
		{ accountId: user.accountId, kind: "confirmation" },
		{ $set: { createdAt: new Date(Date.now() - 3_600_000) } }
	);
}

before(async () => {
	app = await startTestApp({ QSTASH_CURRENT_SIGNING_KEY: "sig-current", QSTASH_NEXT_SIGNING_KEY: "sig-next" });
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		contacts: await import("../app/(app)/contacts/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		unsubscribeRoute: await import("../app/api/unsubscribe/route.js"),
		globalSuppressions: await import("../lib/global-suppressions.js"),
		Contact: (await import("../models/Contact.js")).default,
		DeletedContact: (await import("../models/DeletedContact.js")).default,
		Message: (await import("../models/Message.js")).default,
		Suppression: (await import("../models/Suppression.js")).default,
	};
});

after(() => app?.stop());

describe("signing up again after leaving", () => {
	test("someone who unsubscribed by the email's link goes back to pending with one fresh confirmation email", async () => {
		const user = await customer("resub-link@example.com");
		await importRows(user, [{ email: "left@example.org", status: "active" }]);
		await unsubscribeByLink(user, "left@example.org");
		assert.equal(await m.Suppression.countDocuments({ accountId: user.accountId }), 0, "the link writes no suppression");
		assert.equal(await m.DeletedContact.countDocuments({ accountId: user.accountId }), 0, "nor a deleted contact's hash");
		const before = sesEmails.length;

		const stock = await signUp(user, "left@example.org", {});
		assert.deepEqual([stock.status, stock.body.created, stock.body.status], [200, false, "unsubscribed"], "without resubscribe, nothing changes");
		await flushAfter();
		assert.deepEqual(confirmationsSince(before), []);

		const again = await signUp(user, "left@example.org");
		assert.deepEqual([again.status, again.body.created, again.body.status], [200, false, "pending"]);
		await flushAfter();
		assert.deepEqual(confirmationsSince(before), ["left@example.org"]);
		const contact = await findContact(user, "left@example.org");
		assert.equal(contact.status, "pending", "only the confirmation button makes them active");
		assert.equal(contact.unsubscribedAt, undefined);
		assert.equal(contact.confirmedAt, undefined);

		const third = await signUp(user, "left@example.org");
		assert.equal(third.body.status, "pending");
		await flushAfter();
		assert.deepEqual(confirmationsSince(before), ["left@example.org"], "signing up again at once sends no second email");
	});

	test("a dormant contact goes back to pending and gets the confirmation email", async () => {
		const user = await customer("resub-dormant@example.com");
		await importRows(user, [{ email: "quiet@example.org", status: "dormant" }]);
		const before = sesEmails.length;

		const again = await signUp(user, "quiet@example.org");
		assert.deepEqual([again.body.created, again.body.status], [false, "pending"]);
		await flushAfter();
		assert.deepEqual(confirmationsSince(before), ["quiet@example.org"]);
	});

	test("an active contact stays active with no email, and a pending one gets the confirmation again past its window", async () => {
		const user = await customer("resub-current@example.com");
		await importRows(user, [{ email: "reader@example.org", status: "active" }]);
		const before = sesEmails.length;

		const active = await signUp(user, "reader@example.org");
		assert.deepEqual([active.body.created, active.body.status], [false, "active"]);
		await flushAfter();
		assert.equal(sesEmails.length, before, "no email for someone already getting the newsletter");

		const first = await signUp(user, "new@example.org");
		assert.deepEqual([first.status, first.body.created, first.body.status], [201, true, "pending"]);
		await flushAfter();
		const throttled = await signUp(user, "new@example.org");
		assert.equal(throttled.body.status, "pending");
		await flushAfter();
		assert.deepEqual(confirmationsSince(before), ["new@example.org"], "within the window, once");

		await pastResendWindow(user);
		assert.equal((await signUp(user, "new@example.org")).body.status, "pending");
		await flushAfter();
		assert.deepEqual(confirmationsSince(before), ["new@example.org", "new@example.org"]);
	});

	test("bounced and complained contacts, and anyone on the account's suppression list, stay blocked with no email", async () => {
		const user = await customer("resub-blocked@example.com");
		await importRows(user, [
			{ email: "bounced@example.org", status: "bounced" },
			{ email: "complained@example.org", status: "complained" },
			{ email: "left-bounce@example.org", status: "unsubscribed" },
			{ email: "left-complaint@example.org", status: "unsubscribed" },
			{ email: "left-provider@example.org", status: "unsubscribed" },
			{ email: "left-manual@example.org", status: "unsubscribed" },
		]);
		// An address that later bounced, complained or was refused elsewhere on the account, after its contact here left.
		for (const reason of ["bounce", "complaint", "provider", "manual"]) {
			await m.Suppression.create({ accountId: user.accountId, email: `left-${reason}@example.org`, reason });
		}
		const before = sesEmails.length;

		const expected = {
			"bounced@example.org": "bounced",
			"complained@example.org": "complained",
			"left-bounce@example.org": "unsubscribed",
			"left-complaint@example.org": "unsubscribed",
			"left-provider@example.org": "unsubscribed",
			"left-manual@example.org": "unsubscribed",
		};
		for (const [email, status] of Object.entries(expected)) {
			const again = await signUp(user, email);
			assert.deepEqual([again.status, again.body.status], [200, status], email);
		}
		await flushAfter();
		assert.equal(sesEmails.length, before, "no confirmation email for any of them");
		const contacts = await m.Contact.find({ accountId: user.accountId }).lean();
		assert.deepEqual(Object.fromEntries(contacts.map(({ email, status }) => [email, status])), expected);
	});

	test("an address MailCheap knows can't receive email is refused, and its contact stays unsubscribed", async () => {
		const user = await customer("resub-global@example.com");
		await importRows(user, [{ email: "gone@example.org", status: "unsubscribed" }]);
		await m.globalSuppressions.suppressGlobally({ emails: ["gone@example.org"], reason: "bounce", detail: "bounce/5.1.1" });
		const before = sesEmails.length;

		const again = await signUp(user, "gone@example.org");
		assert.deepEqual([again.status, again.body.error.code], [400, "validation_failed"]);
		await flushAfter();
		assert.equal(sesEmails.length, before);
		assert.equal((await findContact(user, "gone@example.org")).status, "unsubscribed");
	});

	test("a contact deleted after it unsubscribed, bounced or complained stays out", async () => {
		const user = await customer("resub-deleted@example.com");
		await importRows(user, [
			{ email: "left@example.org", status: "unsubscribed" },
			{ email: "bounced@example.org", status: "bounced" },
			{ email: "complained@example.org", status: "complained" },
		]);
		for (const email of ["left", "bounced", "complained"]) {
			const contact = await findContact(user, `${email}@example.org`);
			assert.deepEqual(await as(user, () => m.contacts.deleteContact(String(contact._id))), { ok: true });
		}
		const before = sesEmails.length;

		for (const [email, status] of [["left", "unsubscribed"], ["bounced", "bounced"], ["complained", "complained"]]) {
			const again = await signUp(user, `${email}@example.org`);
			assert.deepEqual([again.body.created, again.body.status], [true, status], email);
		}
		await flushAfter();
		assert.equal(sesEmails.length, before);
	});

	test("a stranger signing someone else up again can't make them active, whatever the body says", async () => {
		const user = await customer("resub-stranger@example.com");
		await importRows(user, [{ email: "victim@example.org", status: "active" }]);
		await unsubscribeByLink(user, "victim@example.org");
		const before = sesEmails.length;

		for (let attempt = 0; attempt < 4; attempt++) {
			const again = await signUp(user, "victim@example.org", { resubscribe: true, consent: true });
			assert.equal(again.body.status, "pending");
		}
		await flushAfter();
		assert.deepEqual(confirmationsSince(before), ["victim@example.org"], "one confirmation email at most");
		const contact = await findContact(user, "victim@example.org");
		assert.equal(contact.status, "pending");
		assert.equal(contact.consent, undefined, "an API signup never carries consent");
	});
});
