import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { checkImportRows } from "../lib/contact-import.js";
import { activate, as, callApi, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";
import { domainsWithoutMail } from "./stubs/mail-domains.mjs";

// What an import leaves out stays listed for its account, with why. Role addresses and throwaway inboxes, which
// MailCheap only judges from the address, come back when the account vouches for them; the rest would bounce, or the
// person asked not to get the emails, so they stay out.

test("the rows left out keep their address and reason, and the contact they'd be only when they can come back", () => {
	const { contacts, leftOut } = checkImportRows([
		{ email: "jane@acme.com", status: "active" },
		{ email: "JANE@acme.com", status: "active" },
		{ email: "not-an-email", status: "active" },
		{ email: "info@acme.com", status: "active", firstName: "Acme", subscribedAt: "2023-04-02T00:00:00Z" },
		{ email: "x@mailinator.com", status: "dormant" },
		{ email: "ken@gmial.com", status: "active" },
		{ email: "sales@other.com", status: "unsubscribed" },
	]);
	assert.deepEqual(
		contacts.map(({ email }) => email),
		["jane@acme.com", "sales@other.com"]
	);
	assert.deepEqual(
		leftOut.map(({ email, reason }) => [email, reason]),
		[
			["info@acme.com", "role"],
			["x@mailinator.com", "disposable"],
			["ken@gmial.com", "typo"],
		],
		"neither the invalid row nor the duplicate"
	);
	assert.equal(leftOut[0].contact.firstName, "Acme");
	assert.equal(leftOut[0].contact.subscribedAt.toISOString(), "2023-04-02T00:00:00.000Z");
	assert.equal(leftOut[1].contact.status, "dormant");
	assert.equal(leftOut[2].contact, undefined);
});

describe("left-out contacts", () => {
	let app;
	let m;
	let user;
	let importId;
	let added;

	before(async () => {
		app = await startTestApp();
		m = {
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			contacts: await import("../app/(app)/contacts/actions.js"),
			apiKeys: await import("../app/(app)/api-keys/actions.js"),
			globalSuppressions: await import("../lib/global-suppressions.js"),
			Contact: (await import("../models/Contact.js")).default,
			LeftOutContact: (await import("../models/LeftOutContact.js")).default,
			Suppression: (await import("../models/Suppression.js")).default,
		};
		user = await customer("left-out@example.com");
		user.key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;

		await m.Suppression.create({ accountId: user.accountId, email: "bounced@example.org", reason: "bounce" });
		await m.globalSuppressions.suppressGlobally({ emails: ["dead@example.org", "office@dead-inbox.example"], reason: "bounce", detail: "test" });
		domainsWithoutMail.add("closed-shop.example");
		domainsWithoutMail.add("shut-down.example");
		const result = await as(user, () =>
			m.contacts.importContacts({
				newsletterId: user.newsletterId,
				consent: true,
				fileName: "trade.csv",
				rows: [
					{ email: "ann@example.org", status: "active" },
					{
						email: "info@greengrow.example",
						status: "active",
						firstName: "Green",
						subscribedAt: "2023-05-04T08:00:00Z",
						emailsReceived: 30,
						openRate: 0.4,
						opens: 12,
						tags: ["installer"],
					},
					{ email: "support@greengrow.example", status: "active" },
					{ email: "sales@shut-down.example", status: "active" },
					{ email: "office@dead-inbox.example", status: "active" },
					{ email: "bob@mailinator.com", status: "active" },
					{ email: "ken@gmial.com", status: "active" },
					{ email: "spamtrap@example.org", status: "active" },
					{ email: "bounced@example.org", status: "active" },
					{ email: "dead@example.org", status: "active" },
					{ email: "gus@closed-shop.example", status: "active" },
					{ email: "broken", status: "active" },
					{ email: "ann@example.org", status: "active" },
				],
			})
		);
		assert.equal(result.status, "done", JSON.stringify(result));
		assert.deepEqual(result.dropped, { invalid: 1, typo: 1, trap: 1, role: 4, disposable: 1, spamDomain: 0, duplicate: 1, suppressed: 1, undeliverable: 1, noMail: 1 });
		importId = result.importId;
		added = result.created;
	});

	after(() => app?.stop());

	async function customer(email) {
		const signedIn = await signIn(email);
		await activate(signedIn);
		const slug = email.split("@")[0];
		const url = await as(signedIn, () => catchRedirect(m.newsletters.saveNewsletter(null, form({ name: slug, slug, postalAddress: "1 Main St, Paris" }))));
		signedIn.newsletterId = url.split("/").at(-1);
		return signedIn;
	}

	function listed(contacts) {
		return contacts.map(({ email, reason, canBringBack }) => [email, reason, canBringBack]);
	}

	test("lists who and why, the ones that can come back first, never the never-email list", async () => {
		const page = await as(user, () => m.contacts.getLeftOut(importId));
		assert.deepEqual(listed(page.contacts), [
			["bob@mailinator.com", "disposable", true],
			["info@greengrow.example", "role", true],
			["office@dead-inbox.example", "role", true],
			["sales@shut-down.example", "role", true],
			["support@greengrow.example", "role", true],
			["bounced@example.org", "suppressed", false],
			["gus@closed-shop.example", "noMail", false],
			["ken@gmial.com", "typo", false],
			["spamtrap@example.org", "trap", false],
		]);
		assert.equal(page.nextCursor, null);
		assert.equal(page.contacts[0].broughtBackAt, null);
		assert.match(page.contacts[0].gravatarHash, /^[0-9a-f]{64}$/, "the hash its picture comes from, made on the server");

		const stored = await m.LeftOutContact.find({ accountId: user.accountId, importId }).lean();
		assert.ok(
			stored.every(({ createdAt }) => createdAt instanceof Date),
			"each expires a week after"
		);
		assert.ok(
			stored.filter(({ canBringBack }) => !canBringBack).every(({ contact }) => contact === undefined),
			"the ones that stay out keep only their address"
		);

		const searched = await as(user, () => m.contacts.getLeftOut(importId, { search: "GreenGrow" }));
		assert.deepEqual(
			searched.contacts.map(({ email }) => email),
			["info@greengrow.example", "support@greengrow.example"]
		);
		const wildcard = await as(user, () => m.contacts.getLeftOut(importId, { search: "*@example.org" }));
		assert.deepEqual(
			wildcard.contacts.map(({ email }) => email),
			["bounced@example.org", "spamtrap@example.org"]
		);
		assert.deepEqual((await as(user, () => m.contacts.getLeftOut(importId, { search: "nobody" }))).contacts, []);
	});

	test("pages through the API from one cursor to the next", async () => {
		const pages = [];
		let cursor = null;
		do {
			const response = await callApi("GET", `/contacts/imports/${importId}/left-out?limit=4${cursor ? `&cursor=${cursor}` : ""}`, { key: user.key });
			assert.equal(response.status, 200, JSON.stringify(response.body));
			pages.push(response.body.contacts.map(({ email }) => email));
			cursor = response.body.nextCursor;
		} while (cursor);
		assert.deepEqual(pages, [
			["bob@mailinator.com", "info@greengrow.example", "office@dead-inbox.example", "sales@shut-down.example"],
			["support@greengrow.example", "bounced@example.org", "gus@closed-shop.example", "ken@gmial.com"],
			["spamtrap@example.org"],
		]);
		const broken = await callApi("GET", `/contacts/imports/${importId}/left-out?cursor=nope`, { key: user.key });
		assert.equal(broken.status, 400);
	});

	test("a role address comes back with its row, once, and the import's counts follow", async () => {
		const result = await as(user, () => m.contacts.bringBackContact(importId, "info@greengrow.example"));
		assert.equal(result.broughtBack, true);
		assert.equal(result.error, undefined);
		assert.equal(result.import.created, added + 1);
		assert.equal(result.import.dropped.role, 3);

		const contact = await m.Contact.findOne({ accountId: user.accountId, email: "info@greengrow.example" }).lean();
		assert.equal(contact.status, "active");
		assert.equal(contact.source, "import");
		assert.equal(String(contact.importId), importId);
		assert.equal(String(contact.newsletterId), user.newsletterId);
		assert.equal(contact.firstName, "Green");
		assert.equal(contact.subscribedAt.toISOString(), "2023-05-04T08:00:00.000Z");
		assert.deepEqual(contact.imported, { emailsReceived: 30, openRate: 0.4 });
		assert.equal(contact.stats.opens, 12);
		assert.deepEqual(contact.tags, ["installer"]);

		const again = await as(user, () => m.contacts.bringBackContact(importId, "info@greengrow.example"));
		assert.equal(again.broughtBack, true);
		assert.equal(again.import.created, added + 1, "counted once");
		assert.equal(await m.Contact.countDocuments({ accountId: user.accountId, email: "info@greengrow.example" }), 1);

		const page = await as(user, () => m.contacts.getLeftOut(importId, { search: "info@" }));
		assert.ok(page.contacts[0].broughtBackAt, "the list says it's back");
	});

	test("what would bounce, or whose person said no, stays out, with why", async () => {
		const bringBack = (email) => as(user, () => m.contacts.bringBackContact(importId, email));
		await m.Suppression.create({ accountId: user.accountId, email: "support@greengrow.example", reason: "complaint" });
		for (const [email, error] of [
			["ken@gmial.com", "Only role addresses and throwaway inboxes can be brought back"],
			["bounced@example.org", "Only role addresses and throwaway inboxes can be brought back"],
			["support@greengrow.example", "This address unsubscribed, bounced or complained before"],
			["sales@shut-down.example", "This email's domain can't receive email"],
			["office@dead-inbox.example", "This address can't receive email"],
			["ann@example.org", "This import didn't leave this address out"],
		]) {
			const result = await bringBack(email);
			assert.deepEqual({ broughtBack: result.broughtBack, error: result.error }, { broughtBack: false, error }, email);
		}
		for (const email of ["ken@gmial.com", "bounced@example.org", "support@greengrow.example", "sales@shut-down.example", "office@dead-inbox.example"]) {
			assert.equal(await m.Contact.exists({ accountId: user.accountId, email }), null, email);
		}
		const page = await as(user, () => m.contacts.getLeftOut(importId, { search: "greengrow" }));
		assert.equal(page.contacts.find(({ email }) => email === "support@greengrow.example").broughtBackAt, null);
	});

	test("through the API, several at once, each answering on its own", async () => {
		const response = await callApi("POST", `/contacts/imports/${importId}/left-out`, {
			key: user.key,
			body: { emails: ["Bob@Mailinator.com", "ken@gmial.com"] },
		});
		assert.equal(response.status, 200, JSON.stringify(response.body));
		assert.deepEqual(response.body.contacts, [
			{ email: "bob@mailinator.com", broughtBack: true, error: null },
			{ email: "ken@gmial.com", broughtBack: false, error: "Only role addresses and throwaway inboxes can be brought back" },
		]);
		assert.equal(response.body.import.dropped.disposable, 0);
		assert.equal((await m.Contact.findOne({ accountId: user.accountId, email: "bob@mailinator.com" }).lean()).status, "active");
	});

	test("another account's import is out of reach", async () => {
		const other = await customer("left-out-other@example.com");
		const { key } = await as(other, () => m.apiKeys.createApiKey(null, form({ name: "Other", level: "full" })));
		assert.equal((await callApi("GET", `/contacts/imports/${importId}/left-out`, { key })).status, 404);
		const bringing = await callApi("POST", `/contacts/imports/${importId}/left-out`, { key, body: { emails: ["support@greengrow.example"] } });
		assert.equal(bringing.status, 404);
		assert.deepEqual(await as(other, () => m.contacts.getLeftOut(importId)), { error: "Import not found" });
		assert.deepEqual(await as(other, () => m.contacts.bringBackContact(importId, "office@dead-inbox.example")), { error: "Import not found" });
		assert.equal(await m.Contact.countDocuments({ accountId: other.accountId }), 0);
	});
});
