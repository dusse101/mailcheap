import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";
import { renderToStaticMarkup } from "react-dom/server";
import { activate, anonymous, as, catchNotFound, signIn, startTestApp } from "./helpers/app.mjs";

let app;
let m;
let admin;
let customer;
let newsletterId;

before(async () => {
	app = await startTestApp({ ADMIN_EMAILS: "ops@example.com" });
	m = {
		page: (await import("../app/admin/newsletters/[id]/page.js")).default,
		review: await import("../lib/content-review.js"),
		alerts: await import("../lib/alerts.js"),
	};
	admin = await signIn("ops@example.com");
	customer = await signIn("customer@example.com");
	await activate(customer, { plan: "growth" });

	const newsletter = {
		accountId: customer.accountId,
		name: "Field notes",
		slug: "field-notes-signups",
		fromName: "Jane",
		fromEmail: "jane@field-notes.example.com",
		requireConfirmation: true,
		confirmation: { subject: "Confirm now", previewText: "", markdown: 'Log in to your bank first.\n\n<a href="{{confirm_url}}">Confirm</a>' },
		welcome: { enabled: true, subject: "Welcome aboard", previewText: "", markdown: "Thanks." },
	};
	// The check held its confirmation email, as it would have read it.
	const input = m.review.getReviewInput({
		campaign: { format: "markdown", subject: "Confirm now", previewText: "", markdown: newsletter.confirmation.markdown },
		newsletter,
	});
	const review = {
		hash: m.review.hashReviewInput(input),
		outcome: "block",
		verdict: "violation",
		categories: ["phishing"],
		reasons: ["Asks readers to log in on a fake bank page"],
		confidence: 0.97,
		checkedAt: new Date(),
	};
	({ insertedId: newsletterId } = await mongoose.connection.db.collection("newsletters").insertOne({ ...newsletter, reviews: { confirmation: review } }));
	await mongoose.connection.db.collection("contacts").insertOne({
		accountId: customer.accountId,
		newsletterId,
		email: "reader-one@example.org",
		status: "active",
	});
});

after(() => app?.stop());

function open(id) {
	return m.page({ params: Promise.resolve({ id: String(id) }) });
}

test("a newsletter's admin page is a 404 to anyone outside ADMIN_EMAILS, signed in or not, like a newsletter that doesn't exist", async () => {
	assert.equal(await as(customer, () => catchNotFound(open(newsletterId))), true, "even its owner");
	assert.equal(await anonymous(() => catchNotFound(open(newsletterId))), true);
	assert.equal(await as(admin, () => catchNotFound(open(new mongoose.Types.ObjectId()))), true);
	assert.equal(await as(admin, () => catchNotFound(open("not-an-id"))), true);
});

test("the admin sees the held confirmation email, what the check found and the decision to make, in a frame with no permissions, and never a contact", async () => {
	const markup = renderToStaticMarkup(await as(admin, () => open(newsletterId)));
	for (const text of ["Field notes", "customer@example.com", "Confirm by email first", "Confirmation email", "Waiting for you", "phishing", "Asks readers to log in on a fake bank page", "Approve", "Reject"]) {
		assert.ok(markup.includes(text), text);
	}
	assert.ok(markup.includes("Off: new subscribers get the confirmation email instead."), "the welcome email doesn't go out while signups confirm");
	assert.match(markup, /<iframe[^>]*sandbox=""/i);
	assert.ok(markup.includes("Log in to your bank first"), "the email as its owner wrote it");
	assert.ok(markup.includes(`/admin?account=${customer.accountId}`), "the account links to its row");
	assert.ok(!markup.includes("reader-one@example.org"));
});

test("its alerts include the ones only for the admin page, which are never emailed", async () => {
	await m.alerts.sendAlert({
		accountId: null,
		key: `gmail-backoff:${newsletterId}`,
		title: "Gmail is rate limiting a newsletter",
		detail: `Field notes (field-notes.example.com), account ${customer.accountId}. Gmail answered: 4.7.28 Reputation.`,
		path: `/admin/newsletters/${newsletterId}`,
	});
	const markup = renderToStaticMarkup(await as(admin, () => open(newsletterId)));
	assert.ok(markup.includes("Gmail is rate limiting a newsletter"));
});
