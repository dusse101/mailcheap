import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { toPreviewFrame, toPreviewHtml } from "../lib/email-preview.js";
import { gravatarHash } from "../lib/gravatar.js";
import { SAMPLE_READER, fillForReader } from "../lib/merge-tags.js";
import { renderEmail } from "../lib/render-email.js";
import { TEST_CONTACT_ID, buildRecipientEmail } from "../lib/sending-rules.js";
import { verifyUnsubscribeToken } from "../lib/unsubscribe.js";
import { activate, as, callApi, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";

process.env.BETTER_AUTH_SECRET = "test-session-secret-with-at-least-32-characters";
process.env.APP_URL = "https://mail.example.com";

const NEWSLETTER = { _id: "74f1a2b3c4d5e6f7a8b9c0d2", name: "Field notes", fromEmail: "jane@example.net", postalAddress: "1 Main St, Paris" };
const CAMPAIGN = {
	format: "rich",
	subject: "{{first_name|Friend}}, issue 12",
	previewText: "For {{ first_name | you }}",
	html: "<p>Hi {{first_name|there}}, {{FIRST_NAME}}!</p><p>Tom &amp; {{first_name|Jerry &amp; co}}</p>",
};

function bodyOf(html) {
	return /<td class="body">([\s\S]*?)<\/td><\/tr>/.exec(html)?.[1];
}

function preheaderOf(html) {
	return /<div [^>]*data-preheader>([\s\S]*?)<\/div>/.exec(html)?.[1];
}

describe("the preview's reader", () => {
	test("a reader's preview reads as their own copy of the email: the subject, the preview text and the content", () => {
		// As the campaign editor renders its preview, from the draft.
		const frame = toPreviewFrame(renderEmail({ ...CAMPAIGN, newsletter: NEWSLETTER }).html);
		const names = ["Jo & Co", '<img src=x onerror="alert(1)">', "Zoë", "Ana\r\nBcc: x@example.com", "", "   ", undefined];
		for (const firstName of names) {
			const sent = buildRecipientEmail({ campaign: CAMPAIGN, newsletter: NEWSLETTER, contact: { _id: "64f1a2b3c4d5e6f7a8b9c0d1", email: "jo@example.com", firstName } });
			const shown = fillForReader({ subject: CAMPAIGN.subject, previewText: CAMPAIGN.previewText, html: frame }, { firstName });
			assert.equal(shown.subject, sent.subject, JSON.stringify(firstName));
			assert.equal(bodyOf(shown.html), bodyOf(sent.html), JSON.stringify(firstName));
			assert.equal(preheaderOf(shown.html), preheaderOf(sent.html), JSON.stringify(firstName));
			assert.ok(!shown.html.includes("{{"), JSON.stringify(firstName));
		}
	});

	test("names are escaped in HTML, the subject stays on one line, and readers without a name get the fallbacks", () => {
		const frame = toPreviewFrame(renderEmail({ ...CAMPAIGN, newsletter: NEWSLETTER }).html);
		const hostile = fillForReader({ subject: CAMPAIGN.subject, html: frame }, { firstName: '<img src=x onerror="alert(1)">' });
		assert.ok(hostile.html.includes("Hi &lt;img src=x onerror=&quot;alert(1)&quot;&gt;,"));
		assert.ok(!hostile.html.includes("<img src=x"));
		assert.equal(fillForReader({ subject: CAMPAIGN.subject }, { firstName: "Ana\r\nBcc: x@example.com" }).subject, "Ana Bcc: x@example.com, issue 12");

		const nameless = fillForReader({ subject: CAMPAIGN.subject, previewText: CAMPAIGN.previewText, html: frame }, { firstName: null });
		assert.equal(nameless.subject, "Friend, issue 12");
		assert.equal(nameless.previewText, "For you");
		assert.ok(bodyOf(nameless.html).includes("<p>Hi there, !</p><p>Tom &amp; Jerry &amp; co</p>"), bodyOf(nameless.html));

		const sample = fillForReader({ subject: CAMPAIGN.subject, previewText: CAMPAIGN.previewText }, SAMPLE_READER);
		assert.deepEqual([sample.subject, sample.previewText], ["Jane, issue 12", "For Jane"]);
	});

	test("a preview's unsubscribe link goes nowhere, and the sample's preview greets Jane", () => {
		const html = renderEmail({ ...CAMPAIGN, newsletter: NEWSLETTER }).html;
		assert.ok(toPreviewFrame(html).includes('href="#"'));
		assert.ok(toPreviewFrame(html).includes("{{first_name|there}}"), "the frame keeps the tags for the reader it shows");
		assert.ok(bodyOf(toPreviewHtml(html)).startsWith("<p>Hi Jane, Jane!</p>"));
	});
});

describe("picking a contact to preview as", () => {
	let app;
	let m;
	let user;
	let campaignId;
	let otherNewsletterId;

	async function newsletter(owner, slug) {
		const url = await as(owner, () =>
			catchRedirect(
				m.newsletters.saveNewsletter(null, form({ name: slug, slug, fromName: "Field notes", fromEmail: `hello@${slug}.mailcheapmail.com`, postalAddress: "1 Main St, Paris" }))
			)
		);
		return url.split("/").at(-1);
	}

	function find(query, newsletterId = user.newsletterId) {
		return as(user, () => m.campaigns.findPreviewContacts(newsletterId, query));
	}

	async function emails(query) {
		const result = await find(query);
		assert.ok(result.contacts, JSON.stringify(result));
		return result.contacts.map(({ email }) => email);
	}

	before(async () => {
		app = await startTestApp();
		m = {
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			campaigns: await import("../app/(app)/campaigns/actions.js"),
			apiKeys: await import("../app/(app)/api-keys/actions.js"),
			Contact: (await import("../models/Contact.js")).default,
			Message: (await import("../models/Message.js")).default,
		};
		user = await signIn("preview-reader@example.com");
		await activate(user);
		user.newsletterId = await newsletter(user, "preview-reader");
		otherNewsletterId = await newsletter(user, "preview-reader-two");
		user.key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;

		const daysAgo = (days) => new Date(Date.now() - days * 86_400_000);
		const contact = (fields) => ({ accountId: user.accountId, newsletterId: user.newsletterId, status: "active", ...fields });
		await m.Contact.insertMany([
			contact({ email: "jo@example.com", firstName: "Jo", subscribedAt: daysAgo(5) }),
			contact({ email: "joanna@example.com", firstName: "Joanna", tags: ["vip"], subscribedAt: daysAgo(1) }),
			contact({ email: "sam@example.com", firstName: "JOSEPHINE", subscribedAt: daysAgo(2) }),
			contact({ email: "nameless@example.com", subscribedAt: daysAgo(3) }),
			contact({ email: "a.b@example.com", subscribedAt: daysAgo(4) }),
			contact({ email: "axb@example.com", subscribedAt: daysAgo(6) }),
			contact({ email: "regex@example.com", firstName: "(.*)[x]", subscribedAt: daysAgo(7) }),
			contact({ email: "html@example.com", firstName: "<b>Bo</b> & co", subscribedAt: daysAgo(8) }),
			contact({ email: "dana@example.net", firstName: "Dana", subscribedAt: daysAgo(9) }),
			contact({ email: "johnny@example.com", firstName: "Johnny", status: "unsubscribed", subscribedAt: daysAgo(0) }),
			contact({ email: "jon@example.com", firstName: "Jon", status: "bounced", subscribedAt: daysAgo(0) }),
			contact({ email: "jolene@example.com", firstName: "Jolene", newsletterId: otherNewsletterId, subscribedAt: daysAgo(0) }),
		]);

		const url = await as(user, () => catchRedirect(m.campaigns.createCampaign(user.newsletterId)));
		campaignId = url.split("/").at(-1);
		const saved = await as(user, () =>
			m.campaigns.saveCampaign(campaignId, { subject: CAMPAIGN.subject, previewText: CAMPAIGN.previewText, body: CAMPAIGN.html })
		);
		assert.deepEqual(saved, { ok: true });
	});

	after(() => app?.stop());

	test("the picker finds the newsletter's active contacts by any part of their address or first name, newest first", async () => {
		assert.deepEqual(await emails("jo"), ["joanna@example.com", "sam@example.com", "jo@example.com"], "addresses and names, in any case");
		assert.deepEqual(await emails("JOSE"), ["sam@example.com"]);
		assert.deepEqual(await emails("  jo@ "), ["jo@example.com"]);
		assert.deepEqual(await emails("anna"), ["joanna@example.com"], "not only the start");
		assert.deepEqual(await emails("@example.net"), ["dana@example.net"], "everyone at a domain");
		assert.deepEqual(await emails("*@EXAMPLE.NET"), ["dana@example.net"]);
		assert.deepEqual(await emails("d*a@*.net"), ["dana@example.net"], "a * stands for any characters");
		assert.deepEqual(await emails("x*@example.net"), [], "in order: example's x comes after the @");
		assert.deepEqual(await emails(""), [
			"joanna@example.com",
			"sam@example.com",
			"nameless@example.com",
			"a.b@example.com",
			"jo@example.com",
			"axb@example.com",
			"regex@example.com",
			"html@example.com",
		]);
		const [joanna] = (await find("joanna")).contacts;
		assert.deepEqual(
			joanna,
			{
				id: joanna.id,
				email: "joanna@example.com",
				firstName: "Joanna",
				fields: {},
				tags: ["vip"],
				segments: {},
				gravatarHash: gravatarHash("joanna@example.com"),
			},
			"only what the preview fills in, the tags and segments its sections read, and the hash its picture comes from"
		);
		assert.deepEqual((await find("nameless")).contacts[0].firstName, null);
	});

	test("unsubscribed, bounced and another newsletter's contacts aren't offered", async () => {
		assert.deepEqual(await emails("john"), []);
		assert.deepEqual(await emails("jon"), []);
		assert.deepEqual(await emails("jolene"), []);
		assert.deepEqual((await find("jolene", otherNewsletterId)).contacts.map(({ email }) => email), ["jolene@example.com"]);
		assert.match((await find("jo", "")).error, /newsletter/, "a newsletter is needed");
	});

	test("what's typed is only ever text, where * stands for any characters: never a pattern or an operator", async () => {
		assert.deepEqual(await emails("a.b"), ["a.b@example.com"], "a dot is a dot");
		assert.deepEqual(await emails("a*b"), ["a.b@example.com", "axb@example.com"], "a * is any characters");
		assert.deepEqual(await emails("(.*)"), ["regex@example.com"], "brackets match themselves");
		assert.deepEqual(await emails("[x]"), ["regex@example.com"]);
		assert.deepEqual(await emails("*"), await emails(""), "a * alone is anyone");
		for (const query of ["\\", "+?", "^$", "a{2,}", "$where", "[x]|.", "x|", "(?>", ".*?", ")*("]) {
			assert.deepEqual(await emails(query), [], query);
		}
		assert.deepEqual((await find({ $gt: "" })).contacts, [], "an object is read as text");
		assert.deepEqual((await find({ $regex: ".*" })).contacts, []);
		const viaApi = await callApi("GET", `/api/v1/contacts/search?newsletter=${user.newsletterId}&query[$gt]=&query=[a-z]`, { key: user.key });
		assert.equal(viaApi.status, 200, JSON.stringify(viaApi.body));
		assert.deepEqual(viaApi.body.contacts, []);
	});

	test("search_contacts answers the API with each contact's profile, within its filters", async () => {
		const response = await callApi("GET", `/api/v1/contacts/search?query=JO&newsletter=preview-reader&status=active&limit=2`, { key: user.key });
		assert.equal(response.status, 200, JSON.stringify(response.body));
		assert.deepEqual(response.body.contacts.map(({ email, firstName, tags }) => [email, firstName, tags]), [
			["joanna@example.com", "Joanna", ["vip"]],
			["sam@example.com", "JOSEPHINE", []],
		]);
		const everywhere = await callApi("GET", "/api/v1/contacts/search?query=jol", { key: user.key });
		assert.deepEqual(everywhere.body.contacts.map(({ email }) => email), ["jolene@example.com"], "every newsletter without one");
		const bounced = await callApi("GET", "/api/v1/contacts/search?query=jon&status=bounced", { key: user.key });
		assert.deepEqual(bounced.body.contacts.map(({ email }) => email), ["jon@example.com"]);
		assert.equal((await callApi("GET", "/api/v1/contacts/search?limit=21", { key: user.key })).status, 400);
	});

	test("preview_campaign shows the saved campaign as a contact gets it, and sends nothing", async () => {
		const messages = await m.Message.countDocuments({ accountId: user.accountId });
		const preview = await callApi("GET", `/api/v1/campaigns/${campaignId}/preview?contact=Joanna@Example.com`, { key: user.key });
		assert.equal(preview.status, 200, JSON.stringify(preview.body));
		assert.deepEqual(preview.body.contact, { id: preview.body.contact.id, email: "joanna@example.com", firstName: "Joanna", status: "active", fields: {} });
		assert.equal(preview.body.subject, "Joanna, issue 12");
		assert.equal(preview.body.previewText, "For Joanna");
		assert.ok(preview.body.html.includes("<p>Hi Joanna, Joanna!</p>"), preview.body.html);
		assert.ok(preview.body.text.includes("Hi Joanna, Joanna!"));
		const token = /\/unsubscribe\?token=([^"&]+)/.exec(preview.body.html)[1];
		assert.equal(verifyUnsubscribeToken(token).contactId, TEST_CONTACT_ID, "its unsubscribe link matches nobody");
		assert.equal(await m.Message.countDocuments({ accountId: user.accountId }), messages, "nothing sent");

		const byId = await callApi("GET", `/api/v1/campaigns/${campaignId}/preview?contact=${preview.body.contact.id}`, { key: user.key });
		assert.equal(byId.body.subject, "Joanna, issue 12");
		const escaped = await callApi("GET", `/api/v1/campaigns/${campaignId}/preview?contact=html@example.com`, { key: user.key });
		assert.ok(escaped.body.html.includes("Hi &lt;b&gt;Bo&lt;/b&gt; &amp; co,"), "a contact's name is text in the email");
		assert.equal(escaped.body.subject, "<b>Bo</b> & co, issue 12");
		const nameless = await callApi("GET", `/api/v1/campaigns/${campaignId}/preview?contact=nameless@example.com`, { key: user.key });
		assert.deepEqual([nameless.body.subject, nameless.body.previewText], ["Friend, issue 12", "For you"]);
		const sample = await callApi("GET", `/api/v1/campaigns/${campaignId}/preview`, { key: user.key });
		assert.deepEqual([sample.body.contact, sample.body.subject], [null, "Jane, issue 12"]);
	});

	test("preview_campaign only takes a contact of the campaign's newsletter", async () => {
		for (const contact of ["jolene@example.com", "nobody@example.com", "000000000000000000000000"]) {
			const response = await callApi("GET", `/api/v1/campaigns/${campaignId}/preview?contact=${contact}`, { key: user.key });
			assert.deepEqual([response.status, response.body.error], [404, { code: "not_found", message: "Contact not found" }], contact);
		}
	});
});
