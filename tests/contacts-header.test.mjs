import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LIST_STARTED_AT, SEGMENTS_FROM, getContactsHeader } from "../lib/contacts-header.js";
import { as, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";

// The actions at the top of the Contacts page follow how far along the newsletter's list is (lib/contacts-header.js):
// the stages, the page that counts the list for them, and the help center that says where each action is.
const ONE = { buttons: ["fields", "add", "import"], menu: ["fields", "export", "help"] };
const TWO = { buttons: ["segments", "fields", "add", "import"], menu: ["segments", "fields", "export", "help"] };
const LIST = { buttons: ["segments", "fields", "import"], menu: ["add", "segments", "fields", "export", "help"] };

test("an empty list has Import and a ⋯ menu with the fields, as its card has Add contact and there's nothing to export", () => {
	assert.deepEqual(getContactsHeader(0), { buttons: ["import"], menu: ["fields", "help"] });
});

test("one or two contacts make Fields and Add contact buttons, and put Export in the menu", () => {
	assert.deepEqual(getContactsHeader(1), ONE);
	assert.deepEqual(getContactsHeader(2), TWO);
});

test("from 2 contacts, segments have people to tell apart: Segments is a button, in the menu on phones", () => {
	assert.equal(SEGMENTS_FROM, 2);
	for (const count of [0, 1]) assert.ok(!getContactsHeader(count).buttons.includes("segments"), `${count}`);
	for (const count of [2, 3, 20]) {
		const { buttons, menu } = getContactsHeader(count);
		assert.equal(buttons[0], "segments", `${count}`);
		assert.ok(menu.includes("segments"), `${count}`);
	}
});

test("from 3 contacts, the list came from an import or signups, and Add contact moves into the menu", () => {
	assert.equal(LIST_STARTED_AT, 3);
	assert.deepEqual(getContactsHeader(3), LIST);
	assert.deepEqual(getContactsHeader(20), LIST);
	assert.deepEqual(getContactsHeader(50_000), LIST);
});

test("at every stage, Import is a button, each action has one place, and the menu ends on the help article", () => {
	for (const count of [0, 1, 2, 3, 20]) {
		const { buttons, menu } = getContactsHeader(count);
		assert.ok(buttons.includes("import"), `${count}`);
		assert.equal(menu.at(-1), "help", `${count}`);
		assert.ok(menu.includes("fields"), `${count}: Fields is in the menu, on phones at least`);
		assert.equal(buttons.includes("add") || menu.includes("add"), count > 0, `${count}`);
		assert.ok(!(buttons.includes("add") && menu.includes("add")), `${count}`);
		assert.equal(menu.includes("export"), count > 0, `${count}`);
	}
});

describe("the Contacts page", () => {
	let app;
	let m;
	let user;
	let newsletterId;

	before(async () => {
		app = await startTestApp();
		m = {
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			contactsPage: await import("../app/(app)/contacts/page.js"),
			helpPage: await import("../app/(site)/help/contacts/page.js"),
			Contact: (await import("../models/Contact.js")).default,
			TooltipProvider: (await import("../components/ui/tooltip.jsx")).TooltipProvider,
		};
		user = await signIn("contacts-header@example.com");
		const url = await as(user, () =>
			catchRedirect(m.newsletters.saveNewsletter(null, form({ name: "Header news", slug: "header-news", postalAddress: "1 Main St, Paris" })))
		);
		newsletterId = url.split("/").at(-1);
	});

	after(() => app?.stop());

	async function render(searchParams = {}) {
		const page = await as(user, () => m.contactsPage.default({ searchParams: Promise.resolve(searchParams) }));
		return renderToStaticMarkup(createElement(m.TooltipProvider, null, page));
	}

	// The header's buttons and links by their text, or the ⋯ button by its label.
	function readHeader(html) {
		const [, header] = html.match(/<header[^>]*>([\s\S]*?)<\/header>/);
		return [...header.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)].map(
			([, , attributes, content]) => attributes.match(/aria-label="([^"]+)"/)?.[1] ?? content.replace(/<[^>]+>/g, "").trim()
		);
	}

	function addContacts(emails, status = "active") {
		return m.Contact.insertMany(emails.map((email) => ({ accountId: user.accountId, newsletterId, email, status, source: "manual" })));
	}

	test("follows the whole list, of every status, whatever the search or the status tab shows", async () => {
		const empty = await render();
		assert.deepEqual(readHeader(empty), ["Import", "More"]);
		assert.match(empty, /Add yourself as a contact/, "the card under it has Add contact");

		await addContacts(["reader1@example.com"]);
		assert.deepEqual(readHeader(await render()), ["Fields", "Add contact", "Import", "More"], "one contact: no segments yet");

		await addContacts(["reader2@example.com"]);
		const few = await render();
		assert.deepEqual(readHeader(few), ["Segments", "Fields", "Add contact", "Import", "More"]);
		assert.match(few.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*Fields<\/button>/)[0], /max-sm:hidden/, "on phones, Fields is in the menu");
		assert.match(few.match(/<a[^>]*href="\/contacts\/segments"[^>]*>/)[0], /max-sm:hidden/, "and so is Segments");
		const nobody = await render({ q: "nobody" });
		assert.deepEqual(readHeader(nobody), ["Segments", "Fields", "Add contact", "Import", "More"], "a search that finds no one");
		assert.match(nobody, /No contacts match/);

		await addContacts(["reader3@example.com", "reader4@example.com", "reader5@example.com"], "unsubscribed");
		const list = ["Segments", "Fields", "Import", "More"];
		assert.deepEqual(readHeader(await render()), list);
		assert.deepEqual(readHeader(await render({ q: "reader1" })), list, "a search that finds fewer than 3");
		assert.deepEqual(readHeader(await render({ status: "bounced" })), list, "a status with no one");
		assert.deepEqual(readHeader(await render({ source: "nowhere" })), list, "a source with no one");
		assert.deepEqual(readHeader(await render({ signedUpBefore: "2000-01-01" })), list, "a signup date with no one");
	});

	test("the help center says where each action is, and from how many contacts Add contact is in the menu", () => {
		const text = renderToStaticMarkup(createElement(m.helpPage.default)).replace(/<[^>]+>/g, "");
		assert.match(text, /Click Fields at the top of the Contacts page\. Before your list has contacts, and on a phone, it&#x27;s Contact fields in the ⋯ menu there\./);
		assert.match(text, new RegExp(`Once your list has ${LIST_STARTED_AT} contacts, Add contact is in the ⋯ menu at the top of the page\\.`));
		assert.match(text, new RegExp(`Once your list has ${SEGMENTS_FROM} contacts, Segments at the top of the Contacts page opens yours,`));
		assert.match(text, /Export, in the ⋯ menu at the top of the Contacts page, downloads the contacts that match your filters/);
		assert.match(text, /They join at once, without a confirmation email, and get your welcome email if it&#x27;s on\./);
	});
});
