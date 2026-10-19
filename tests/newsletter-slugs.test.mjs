import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { activate, addSentIssue, as, callApi, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";

// A newsletter's slug, as the settings form shows it: checked while it's typed (check_newsletter_slug), unique down to
// the database, and what saving a new one does to the old subdomain.
const APP_URL = "https://mailcheap.ai";
let app;
let m;

async function customer(email, slug) {
	const user = await signIn(email);
	await activate(user);
	const url = await as(user, () =>
		catchRedirect(m.newsletters.saveNewsletter(null, form({ name: slug, slug, postalAddress: "1 Main St, Paris", archiveEnabled: "on" })))
	);
	user.newsletterId = url.split("/").at(-1);
	user.key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;
	return user;
}

function check(user, slug) {
	return as(user, () => m.newsletters.checkSlug(slug, user.newsletterId));
}

function saveSlug(user, slug) {
	return as(user, () =>
		m.newsletters.saveNewsletter(null, form({ id: user.newsletterId, name: "Notes", slug, postalAddress: "1 Main St, Paris", archiveEnabled: "on" }))
	);
}

function visit(url) {
	return m.proxy(new m.NextRequest(url, { headers: { host: new URL(url).host } }));
}

function outcome(response) {
	const rewrite = response.headers.get("x-middleware-rewrite");
	if (rewrite) return { rewrite: new URL(rewrite).pathname };
	if (response.headers.get("x-middleware-next")) return { next: true };
	return { status: response.status };
}

before(async () => {
	app = await startTestApp({ APP_URL, SHARED_DOMAIN: "mailcheap.ai" });
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		archive: await import("../lib/archive-data.js"),
		registry: await import("../lib/actions/registry.js"),
		proxy: (await import("../proxy.js")).proxy,
		NextRequest: (await import("next/server")).NextRequest,
		Newsletter: (await import("../models/Newsletter.js")).default,
	};
});

after(() => app?.stop());

describe("checking a slug", () => {
	test("available, or taken by another newsletter, reserved or invalid, with the messages saving gives", async () => {
		const jane = await customer("slug-jane@example.com", "jane-notes");
		await customer("slug-john@example.com", "john-notes");
		const free = (slug) => ({ slug, available: true, reason: null, message: null });
		assert.deepEqual(await check(jane, "fresh-notes"), free("fresh-notes"));
		assert.deepEqual(await check(jane, "jane-notes"), free("jane-notes"), "its own slug");
		assert.deepEqual(await check(jane, "john-notes"), { slug: "john-notes", available: false, reason: "taken", message: "This slug is already used" });
		assert.deepEqual(await check(jane, "WWW"), {
			slug: "www",
			available: false,
			reason: "reserved",
			message: "www is reserved for MailCheap, pick another slug",
		});
		assert.deepEqual(await check(jane, "notes!"), {
			slug: "notes!",
			available: false,
			reason: "invalid",
			message: "Slug can only use lowercase letters, numbers and dashes",
		});

		assert.deepEqual(await saveSlug(jane, "john-notes"), { error: "This slug is already used" });
		assert.deepEqual(await saveSlug(jane, "www"), { error: "www is reserved for MailCheap, pick another slug" });
	});

	test("from the API too; checking counts toward its own limit, never toward the slug changes", async () => {
		const user = await customer("slug-api@example.com", "api-notes");
		const response = await callApi("GET", `/api/v1/newsletters/slugs/jane-notes?id=${user.newsletterId}`, { key: user.key });
		assert.equal(response.status, 200);
		assert.deepEqual(response.body, { slug: "jane-notes", available: false, reason: "taken", message: "This slug is already used" });

		const { rateLimit, limitDashboard, readOnly } = m.registry.getAction("check_newsletter_slug");
		assert.deepEqual([rateLimit, limitDashboard, readOnly], [{ limit: 300, window: "1 h" }, true, true]);
		for (let index = 0; index < 5; index += 1) assert.equal((await check(user, `api-notes-${index}`)).available, true);
		for (const slug of ["api-notes-1", "api-notes-2", "api-notes-3"]) assert.equal((await saveSlug(user, slug)).ok, true, slug);
	});
});

describe("slugs in the database", () => {
	test("a unique index refuses a second newsletter with a slug, whatever checks it skipped", async () => {
		await m.Newsletter.init();
		const indexes = await m.Newsletter.collection.indexes();
		assert.ok(indexes.some(({ key, unique }) => unique && Object.keys(key).join() === "slug"));
		const twin = () => ({ accountId: new mongoose.Types.ObjectId(), name: "Twin", slug: "twin-notes", fromEmail: "hello@twin-notes.mailcheap.ai" });
		await m.Newsletter.collection.insertOne(twin());
		await assert.rejects(m.Newsletter.collection.insertOne(twin()), { code: 11000 });
	});
});

describe("a new slug", () => {
	test("leaves the old subdomain answering for the links in sent emails, and showing no page", async () => {
		const user = await customer("slug-move@example.com", "old-notes");
		await addSentIssue(user);
		assert.equal((await m.archive.getArchiveNewsletter("old-notes"))?.slug, "old-notes");
		assert.equal((await saveSlug(user, "new-notes")).ok, true);

		for (const path of ["/c/token", "/o/token", "/unsubscribe?token=token", "/api/unsubscribe?token=token", "/confirm?token=token", "/api/confirm?token=token", "/keep?token=token", "/api/keep?token=token"]) {
			assert.deepEqual(outcome(await visit(`https://old-notes.mailcheap.ai${path}`)), { next: true }, path);
		}
		assert.deepEqual(outcome(await visit("https://old-notes.mailcheap.ai/p/first-issue")), { rewrite: "/archive/old-notes/p/first-issue" });
		assert.equal(await m.archive.getArchiveNewsletter("old-notes"), null, "no newsletter has the old slug");
		assert.equal((await m.archive.getArchiveNewsletter("new-notes"))?.slug, "new-notes");
	});
});
