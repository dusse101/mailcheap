import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";
import { renderToStaticMarkup } from "react-dom/server";
import { activate, anonymous, as, catchNotFound, signIn, startTestApp } from "./helpers/app.mjs";

const HOUR_MS = 3_600_000;

let app;
let m;
let admin;
let customer;
let campaignId;
let messageIds;

before(async () => {
	app = await startTestApp({ ADMIN_EMAILS: "ops@example.com" });
	m = {
		page: (await import("../app/admin/campaigns/[id]/page.js")).default,
		tracking: await import("../lib/tracking.js"),
	};
	admin = await signIn("ops@example.com");
	customer = await signIn("customer@example.com");
	await activate(customer, { plan: "growth" });

	const db = mongoose.connection.db;
	const startedAt = new Date(Date.now() - 30 * HOUR_MS);
	const { insertedId: newsletterId } = await db.collection("newsletters").insertOne({
		accountId: customer.accountId,
		name: "Field notes",
		slug: "field-notes-admin",
		fromName: "Jane",
		fromEmail: "jane@field-notes.example.com",
	});
	// A designed email pasted from a sent one: it still carries another message's open pixel and tracked link.
	const pasted = m.tracking.addTracking('<html><body><p>Hello</p><a href="https://example.com/article">Read</a></body></html>', {
		baseUrl: "https://field-notes.example.com",
		messageId: new mongoose.Types.ObjectId(),
	});
	({ insertedId: campaignId } = await db.collection("campaigns").insertOne({
		accountId: customer.accountId,
		newsletterId,
		subject: "Spring issue",
		previewText: "What grew this month",
		format: "html",
		html: pasted,
		status: "sent",
		source: "dashboard",
		createdAt: startedAt,
		startedAt,
		sentAt: new Date(startedAt.getTime() + HOUR_MS),
		stats: { recipients: 2, sent: 2, delivered: 2, opened: 1, clicked: 0, bounced: 0, complained: 0, unsubscribed: 0 },
	}));
	const message = (email, fields) => ({
		accountId: customer.accountId,
		campaignId,
		contactId: new mongoose.Types.ObjectId(),
		kind: "campaign",
		email,
		provider: "gmail",
		sentAt: startedAt,
		deliveredAt: startedAt,
		...fields,
	});
	const { insertedIds } = await db.collection("messages").insertMany([
		message("reader-one@example.org", { openedAt: new Date(startedAt.getTime() + HOUR_MS) }),
		message("reader-two@example.org", {}),
	]);
	messageIds = Object.values(insertedIds);
});

after(() => app?.stop());

function open(id) {
	return m.page({ params: Promise.resolve({ id: String(id) }) });
}

test("a campaign's admin page is a 404 to anyone outside ADMIN_EMAILS, signed in or not, like a campaign that doesn't exist", async () => {
	assert.equal(await as(customer, () => catchNotFound(open(campaignId))), true, "even the campaign's owner");
	assert.equal(await anonymous(() => catchNotFound(open(campaignId))), true);
	assert.equal(await as(admin, () => catchNotFound(open(new mongoose.Types.ObjectId()))), true);
	assert.equal(await as(admin, () => catchNotFound(open("not-an-id"))), true);
});

test("the admin sees the owner's report with the account, newsletter and audience, and never a contact", async () => {
	const markup = renderToStaticMarkup(await as(admin, () => open(campaignId)));
	for (const text of ["Spring issue", "customer@example.com", "Growth · monthly", "Field notes", "jane@field-notes.example.com", "Everyone · 2 recipients", "Not on the website", "What grew this month"]) {
		assert.ok(markup.includes(text), text);
	}
	assert.ok(markup.includes(`/admin?account=${customer.accountId}`), "the account links to its row");
	assert.ok(!markup.includes("reader-one@example.org") && !markup.includes("reader-two@example.org"));
	assert.ok(!/Send to more|Pause|Resume|Duplicate/.test(markup), "none of the owner's actions");
});

test("looking at the email counts as no open or click: tracking is stripped and no message changes", async () => {
	const before = await mongoose.connection.db.collection("messages").find({ _id: { $in: messageIds } }).toArray();
	const markup = renderToStaticMarkup(await as(admin, () => open(campaignId)));
	const frame = markup.match(/<iframe[^>]*srcDoc="([^"]*)"/i)?.[1] ?? markup.match(/<iframe[^>]*srcdoc="([^"]*)"/i)?.[1];
	assert.ok(frame, "the email shows in a frame");
	assert.match(markup, /<iframe[^>]*sandbox=""/i, "with no permissions");
	assert.ok(!/\/o\/[a-f0-9]{24}\./.test(frame), "no open pixel");
	assert.ok(!/\/c\/[a-f0-9]{24}\./.test(frame), "no tracked link");
	assert.ok(frame.includes("https://example.com/article"), "the link points where it leads");
	const afterward = await mongoose.connection.db.collection("messages").find({ _id: { $in: messageIds } }).toArray();
	assert.deepEqual(afterward, before);
});

test("removeTracking takes out open pixels on any host and points tracked links at their destination", () => {
	const html = m.tracking.addTracking('<p><a href="https://example.com/a?x=1&amp;y=2">A</a></p>', {
		baseUrl: "https://news.example.org",
		messageId: new mongoose.Types.ObjectId(),
	});
	const clean = m.tracking.removeTracking(html);
	assert.ok(!clean.includes("/o/") && !clean.includes("/c/"));
	assert.ok(clean.includes('href="https://example.com/a?x=1&amp;y=2"'));
	assert.equal(m.tracking.removeTracking("<p>No tracking</p>"), "<p>No tracking</p>");
});
