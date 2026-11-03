import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getEmailOutcome } from "../lib/email-outcome.js";
import { activate, as, callApi, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";

const HOUR = 3_600_000;

describe("an email's outcome", () => {
	test("is the furthest it got, or what stopped it, and a sent email its inbox never took isn't delivered", () => {
		const sentAt = new Date();
		assert.equal(getEmailOutcome({ status: "delivered", sentAt, deliveredAt: sentAt, openedAt: sentAt, clickedAt: sentAt }), "clicked");
		assert.equal(getEmailOutcome({ status: "complained", sentAt, deliveredAt: sentAt, openedAt: sentAt, complainedAt: sentAt }), "complained");
		assert.equal(getEmailOutcome({ status: "bounced", sentAt, bouncedAt: sentAt }), "bounced");
		assert.equal(getEmailOutcome({ status: "sent", sentAt, error: "Soft bounce: Mailbox Unavailable" }), "undelivered");
		assert.equal(getEmailOutcome({ status: "failed", sentAt, error: "Dropped by PostShiba: Bounced Address" }), "undelivered");
		assert.equal(getEmailOutcome({ status: "sent", sentAt }), "sent", "still on its way");
		assert.equal(getEmailOutcome({ status: "failed", error: "Timed out" }), "unsent", "never handed over");
		assert.equal(getEmailOutcome({ status: "queued" }), "waiting");
	});
});

describe("a campaign's recipients", () => {
	let app;
	let m;
	let user;
	let campaign;
	const people = {};

	before(async () => {
		app = await startTestApp();
		m = {
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			apiKeys: await import("../app/(app)/api-keys/actions.js"),
			campaignPage: await import("../app/(app)/campaigns/[id]/page.js"),
			unsubscribeRoute: await import("../app/api/unsubscribe/route.js"),
			events: await import("../lib/email-events.js"),
			linkStats: await import("../lib/link-stats.js"),
			unsubscribeTokens: await import("../lib/unsubscribe.js"),
			CampaignReport: (await import("../components/CampaignReport.jsx")).default,
			TooltipProvider: (await import("../components/ui/tooltip.jsx")).TooltipProvider,
			Campaign: (await import("../models/Campaign.js")).default,
			CampaignLink: (await import("../models/CampaignLink.js")).default,
			Contact: (await import("../models/Contact.js")).default,
			Message: (await import("../models/Message.js")).default,
		};
		user = await customer("recipients@example.com");

		const sentAt = new Date(Date.now() - 24 * HOUR);
		const later = (hours) => new Date(sentAt.getTime() + hours * HOUR);
		campaign = await m.Campaign.create({
			accountId: user.accountId,
			newsletterId: user.newsletterId,
			subject: "Spring issue",
			format: "markdown",
			markdown: "Hi",
			status: "sent",
			startedAt: sentAt,
			sentAt,
		});
		const links = ["https://example.com/story?utm_source=mailcheap", "https://example.net/shop"].map((url) => m.linkStats.normalizeLink(url));
		const keys = links.map((url) => m.linkStats.getLinkKey(url));
		for (const [index, url] of links.entries()) {
			await m.CampaignLink.create({ accountId: user.accountId, campaignId: campaign._id, key: keys[index], url, clicks: 1, clickers: 1 });
		}
		const delivered = { status: "delivered", sentAt, deliveredAt: sentAt };
		// In the order they joined, which is the list's.
		const emails = [
			["ada", { ...delivered, openedAt: later(1), clickedAt: later(2), clickedLinks: keys }, "Ada"],
			["ben", { ...delivered, openedAt: later(3) }],
			["cy", delivered],
			["dee", { status: "bounced", sentAt, bouncedAt: sentAt }],
			["eve", { status: "sent", sentAt, error: "Soft bounce: Mailbox Unavailable, The recipient's inbox is out of storage space" }],
			["fay", { status: "sent", sentAt }],
			["gus", { ...delivered, openedAt: later(4), unsubscribedAt: later(5) }],
			["hal", delivered],
			["ivy", { status: "queued" }],
		];
		for (const [name, fields, firstName] of emails) {
			const contact = await m.Contact.create({ accountId: user.accountId, newsletterId: user.newsletterId, email: `${name}@example.org`, firstName, status: "active" });
			people[name] = contact;
			await m.Message.create({ accountId: user.accountId, newsletterId: user.newsletterId, campaignId: campaign._id, contactId: contact._id, kind: "campaign", email: contact.email, ...fields });
		}
		await m.Message.create({ accountId: user.accountId, newsletterId: user.newsletterId, campaignId: campaign._id, contactId: people.cy._id, kind: "last-chance", email: "cy@example.org", ...delivered });
		await m.Contact.deleteOne({ accountId: user.accountId, _id: people.hal._id });
	});

	after(() => app?.stop());

	async function customer(email) {
		const signedIn = await signIn(email);
		await activate(signedIn);
		const slug = email.split("@")[0];
		const url = await as(signedIn, () =>
			catchRedirect(m.newsletters.saveNewsletter(null, form({ name: `${slug} news`, slug, postalAddress: "1 Main St, Paris" })))
		);
		signedIn.newsletterId = url.split("/").at(-1);
		signedIn.key = (await as(signedIn, () => m.apiKeys.createApiKey(null, form({ name: "Full", level: "full" })))).key;
		return signedIn;
	}

	const list = (query = "") => callApi("GET", `/api/v1/campaigns/${campaign._id}/recipients${query}`, { key: user.key });
	const names = (body) => body.recipients.map(({ email }) => email?.split("@")[0] ?? null);

	test("list_campaign_recipients lists everyone it went to in the order they joined, with what each did and how many each filter picks", async () => {
		const { status, body } = await list();
		assert.equal(status, 200, JSON.stringify(body));
		assert.deepEqual(names(body), ["ada", "ben", "cy", "dee", "eve", "fay", "gus", null], "an email still waiting and the last-chance email aren't the issue's");
		assert.deepEqual(body.counts, { all: 8, opened: 3, clicked: 1, unopened: 2, undelivered: 2, bounced: 1, unsubscribed: 1 });
		assert.deepEqual(
			body.recipients.map(({ outcome }) => outcome),
			["clicked", "opened", "delivered", "bounced", "undelivered", "sent", "opened", "delivered"]
		);
		const [ada] = body.recipients;
		assert.deepEqual([ada.contactId, ada.firstName], [String(people.ada._id), "Ada"]);
		assert.deepEqual(ada.clickedLinks.toSorted(), ["https://example.com/story", "https://example.net/shop"], "without tracking parameters");
		assert.ok(ada.openedAt && ada.clickedAt && ada.deliveredAt);
		assert.ok(body.recipients[6].unsubscribedAt, "Gus unsubscribed through it");
		assert.deepEqual(body.recipients.at(-1), { ...body.recipients.at(-1), contactId: null, email: null }, "a deleted contact keeps no address");
		assert.ok(!JSON.stringify(body).includes("storage space"), "the inbox's own words stay out");
		assert.equal(body.nextCursor, null);
	});

	test("each filter picks its recipients, page by page", async () => {
		assert.deepEqual(names((await list("?filter=opened")).body), ["ada", "ben", "gus"]);
		assert.deepEqual(names((await list("?filter=clicked")).body), ["ada"]);
		assert.deepEqual(names((await list("?filter=unopened")).body), ["cy", null]);
		assert.deepEqual(names((await list("?filter=undelivered")).body), ["eve", "fay"]);
		assert.deepEqual(names((await list("?filter=bounced")).body), ["dee"]);
		assert.deepEqual(names((await list("?filter=unsubscribed")).body), ["gus"]);

		const first = (await list("?limit=3")).body;
		assert.deepEqual(names(first), ["ada", "ben", "cy"]);
		assert.equal(first.nextCursor, String(people.cy._id));
		const second = (await list(`?limit=3&cursor=${first.nextCursor}`)).body;
		assert.deepEqual(names(second), ["dee", "eve", "fay"]);
		const last = (await list(`?limit=3&cursor=${second.nextCursor}`)).body;
		assert.deepEqual(names(last), ["gus", null]);
		assert.equal(last.nextCursor, null);

		assert.equal((await list("?cursor=nope")).body.error.code, "validation_failed");
		assert.equal((await list("?filter=everyone")).body.error.code, "validation_failed");
	});

	test("another account's campaign isn't found", async () => {
		const other = await customer("recipients-other@example.com");
		const foreign = await callApi("GET", `/api/v1/campaigns/${campaign._id}/recipients`, { key: other.key });
		assert.equal(foreign.status, 404);
	});

	async function renderPage(searchParams = {}) {
		const element = await as(user, () => m.campaignPage.default({ params: Promise.resolve({ id: String(campaign._id) }), searchParams: Promise.resolve(searchParams) }));
		return renderToStaticMarkup(createElement(m.TooltipProvider, null, element));
	}

	// The label of the tab open on the page.
	function openTab(html) {
		const [, inner] = /<button[^>]*role="tab"[^>]*aria-selected="true"[^>]*>([\s\S]*?)<\/button>/.exec(html) ?? [];
		return inner?.replace(/<[^>]*>/g, "");
	}

	test("the campaign's page lists them in its Recipients tab, a filter at a time, each opening their contact", async () => {
		const html = await renderPage();
		assert.match(html, /role="tab"[^>]*>(<svg[\s\S]*?<\/svg>)?Recipients<\/button>/);
		assert.equal(openTab(html), "Timeline", "the page opens on its timeline");
		for (const label of ["Everyone", "Opened", "Clicked", "Didn&#x27;t open", "Not delivered", "Bounced", "Unsubscribed"]) {
			assert.ok(html.includes(`>${label}<`), label);
		}
		assert.ok(html.includes(`href="/contacts/${people.ada._id}"`) && html.includes(">Ada<"), "Ada by her first name, opening her page");
		assert.ok(html.includes("ada@example.org"), "her address under her name");
		assert.ok(html.includes("Deleted contact") && !html.includes("hal@example.org"));
		assert.ok(html.includes(">Not delivered<") && html.includes(">Unsubscribed<"));
		assert.ok(html.includes('href="https://example.com/story"'), "the links she clicked");
		assert.ok(html.includes('href="/help/sending#recipients"'));

		const clicked = await renderPage({ recipients: "clicked" });
		assert.equal(openTab(clicked), "Recipients", "a filter keeps the page on its recipients");
		assert.equal(openTab(await renderPage({ shown: "100" })), "Recipients", "and so does Show more");
		assert.match(clicked, /aria-current="page"[^>]*>Clicked</);
		assert.ok(clicked.includes(">Ada<") && !clicked.includes("ben@example.org"));
		assert.ok(clicked.includes(`href="/campaigns/${campaign._id}?recipients=opened"`));
		assert.match(await renderPage({ recipients: "nobody" }), /aria-current="page"[^>]*>Everyone</, "an unknown filter shows everyone");
	});

	test("an admin's read-only report never lists them", () => {
		const html = renderToStaticMarkup(
			createElement(m.CampaignReport, {
				campaign: { _id: String(campaign._id), subject: "Spring issue", status: "sent", format: "markdown", markdown: "Hi", stats: { sent: 1, delivered: 1 } },
				newsletter: { name: "Weekly", fromName: "Weekly", fromEmail: "hi@example.com" },
				providers: [],
				links: null,
				recipients: { filter: "all", counts: { all: 1 }, recipients: [], hasMore: false, shown: 50, step: 50 },
				timeZone: "UTC",
				readOnly: true,
			})
		);
		assert.ok(!html.includes("Recipients"));
	});

	test("an unsubscribe counts on the email it came through: the latest issue for a link, the one the provider names for its own", async () => {
		const reader = await m.Contact.create({ accountId: user.accountId, newsletterId: user.newsletterId, email: "leaving@example.org", status: "active" });
		const sentAt = new Date(Date.now() - 2 * HOUR);
		const issue = await m.Campaign.create({ accountId: user.accountId, newsletterId: user.newsletterId, subject: "Latest", status: "sent", startedAt: sentAt, sentAt });
		const email = await m.Message.create({ accountId: user.accountId, newsletterId: user.newsletterId, campaignId: issue._id, contactId: reader._id, kind: "campaign", email: reader.email, status: "delivered", sentAt, deliveredAt: sentAt });
		const token = m.unsubscribeTokens.createUnsubscribeToken({ contactId: reader._id, newsletterId: user.newsletterId });
		function leave() {
			const body = new FormData();
			body.set("source", "page");
			return m.unsubscribeRoute.POST(new Request(`http://localhost:3000/api/unsubscribe?token=${token}`, { method: "POST", body }));
		}
		await leave();
		const { unsubscribedAt } = await m.Message.findOne({ accountId: user.accountId, _id: email._id }).lean();
		assert.ok(unsubscribedAt);
		assert.equal((await m.Campaign.findOne({ accountId: user.accountId, _id: issue._id }).lean()).stats.unsubscribed, 1);
		await m.Contact.updateOne({ accountId: user.accountId, _id: reader._id }, { $set: { status: "active" } });
		await leave();
		assert.equal((await m.Campaign.findOne({ accountId: user.accountId, _id: issue._id }).lean()).stats.unsubscribed, 1, "once per email");
		assert.deepEqual((await m.Message.findOne({ accountId: user.accountId, _id: email._id }).lean()).unsubscribedAt, unsubscribedAt, "the first time stays");

		const other = await m.Contact.create({ accountId: user.accountId, newsletterId: user.newsletterId, email: "provider@example.org", status: "active" });
		const named = await m.Message.create({ accountId: user.accountId, newsletterId: user.newsletterId, campaignId: campaign._id, contactId: other._id, kind: "campaign", email: other.email, status: "delivered", sentAt, deliveredAt: sentAt });
		await m.events.handleEmailEvent({ type: "unsubscribe", accountId: String(user.accountId), messageId: String(named._id), email: other.email, emails: [other.email] });
		assert.ok((await m.Message.findOne({ accountId: user.accountId, _id: named._id }).lean()).unsubscribedAt);
	});
});
