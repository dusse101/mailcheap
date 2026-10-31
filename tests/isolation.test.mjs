import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { activate, anonymous, as, callApi, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";
import { flushAfter } from "./stubs/next-server.mjs";
import { sent as sesEmails } from "./stubs/ses.mjs";

// Bob builds a newsletter with contacts, a campaign, an API key and an upload through his own actions.
// Alice, signed in to her own paid account, then tries to reach each of them every way the app offers.
let app;
let alice;
let bob;
let bobData;
let m;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function createNewsletter(user, { name, slug }) {
	const url = await as(user, () =>
		catchRedirect(
			m.newsletters.saveNewsletter(
				null,
				form({ name, slug, fromName: name, fromEmail: `hello@${slug}.mailcheapmail.com`, postalAddress: "1 Main St, Paris" })
			)
		)
	);
	return url.split("/").at(-1);
}

async function createCampaign(user, newsletterId, subject) {
	const url = await as(user, () => catchRedirect(m.campaigns.createCampaign(newsletterId)));
	const id = url.split("/").at(-1);
	assert.deepEqual(await as(user, () => m.campaigns.saveCampaign(id, { subject, previewText: "Hi", body: "<p>Hello readers</p>" })), {
		ok: true,
	});
	return id;
}

async function upload(user) {
	const request = new Request("http://localhost:3000/api/uploads", {
		method: "POST",
		headers: { "content-type": "image/png", "x-file-name": "cover" },
		body: PNG,
	});
	return as(user, () => m.uploadsRoute.POST(request));
}

async function snapshot() {
	const [newsletter, campaign, contacts, apiKey, uploads] = await Promise.all([
		m.Newsletter.findOne({ accountId: bob.accountId, _id: bobData.newsletterId }).lean(),
		m.Campaign.findOne({ accountId: bob.accountId, _id: bobData.campaignId }).lean(),
		m.Contact.find({ accountId: bob.accountId }).sort({ email: 1 }).lean(),
		m.ApiKey.findOne({ accountId: bob.accountId }).lean(),
		m.Upload.find({ accountId: bob.accountId }).lean(),
	]);
	return JSON.parse(JSON.stringify({ newsletter, campaign, contacts, apiKey, uploads }));
}

before(async () => {
	app = await startTestApp();
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		campaigns: await import("../app/(app)/campaigns/actions.js"),
		contacts: await import("../app/(app)/contacts/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		uploadsRoute: await import("../app/api/uploads/route.js"),
		scope: await import("../lib/account-scope.js"),
		contactQueries: await import("../lib/contacts.js"),
		campaignQueries: await import("../lib/campaign-queries.js"),
		apiKeyQueries: await import("../lib/api-keys.js"),
		usage: await import("../lib/usage.js"),
		Newsletter: (await import("../models/Newsletter.js")).default,
		Campaign: (await import("../models/Campaign.js")).default,
		Contact: (await import("../models/Contact.js")).default,
		ApiKey: (await import("../models/ApiKey.js")).default,
		Upload: (await import("../models/Upload.js")).default,
		Message: (await import("../models/Message.js")).default,
		Suppression: (await import("../models/Suppression.js")).default,
	};

	alice = await signIn("alice@example.com");
	bob = await signIn("bob@example.com");
	await activate(alice);
	await activate(bob);

	const newsletterId = await createNewsletter(bob, { name: "Bob weekly", slug: "bob-weekly" });
	const imported = await as(bob, () =>
		m.contacts.importContacts({
			newsletterId,
			consent: true,
			rows: [
				{ email: "reader1@example.org", status: "active" },
				{ email: "reader2@example.org", status: "active" },
				{ email: "cold@example.org", status: "dormant" },
			],
		})
	);
	assert.equal(imported.created, 3);
	const campaignId = await createCampaign(bob, newsletterId, "Bob's issue");
	const { key: apiKey } = await as(bob, () => m.apiKeys.createApiKey(null, form({ name: "Bob's site" })));
	const uploaded = await upload(bob);
	assert.equal(uploaded.status, 200);
	const reader = await m.Contact.findOne({ accountId: bob.accountId, email: "reader1@example.org" }).lean();
	const dormant = await m.Contact.findOne({ accountId: bob.accountId, email: "cold@example.org" }).lean();
	const apiKeyId = (await m.ApiKey.findOne({ accountId: bob.accountId }).lean())._id.toString();
	bobData = {
		newsletterId,
		campaignId,
		apiKey,
		apiKeyId,
		readerId: reader._id.toString(),
		dormantId: dormant._id.toString(),
		uploadUrl: (await uploaded.json()).url,
	};

	await createNewsletter(alice, { name: "Alice letters", slug: "alice-letters" });
	alice.apiKey = (await as(alice, () => m.apiKeys.createApiKey(null, form({ name: "Alice's site" })))).key;
});

after(() => app?.stop());

describe("server actions refuse another account's data", () => {
	test("newsletters: update, welcome test, new campaign, contact import, adding a contact", async () => {
		const before = await snapshot();
		const update = await as(alice, () =>
			m.newsletters.saveNewsletter(
				null,
				form({
					id: bobData.newsletterId,
					name: "Taken",
					slug: "bob-weekly",
					fromEmail: "attacker@example.com",
					postalAddress: "Nowhere",
				})
			)
		);
		assert.deepEqual(update, { error: "Newsletter not found" });
		assert.match((await as(alice, () => m.newsletters.sendWelcomeTest(bobData.newsletterId))).error, /Newsletter not found/);
		assert.deepEqual(await as(alice, () => m.campaigns.createCampaign(bobData.newsletterId)), { error: "Newsletter not found" });
		assert.deepEqual(
			await as(alice, () =>
				m.contacts.importContacts({ newsletterId: bobData.newsletterId, rows: [{ email: "spam@example.net", status: "active" }] })
			),
			{ error: "Newsletter not found" }
		);
		assert.deepEqual(
			await as(alice, () => m.contacts.addContact(null, form({ newsletterId: bobData.newsletterId, email: "spam@example.net", consent: "on" }))),
			{ error: "Newsletter not found" }
		);
		assert.deepEqual(await as(alice, () => m.campaigns.findPreviewContacts(bobData.newsletterId, "reader")), { error: "Newsletter not found" });
		assert.deepEqual(await snapshot(), before);
		assert.equal(await m.Contact.countDocuments({ accountId: bob.accountId, email: "spam@example.net" }), 0);
		assert.equal(await m.Contact.exists({ newsletterId: bobData.newsletterId, email: "spam@example.net" }).setOptions({ crossAccount: true }), null);
	});

	test("campaigns: every action answers not found and changes nothing", async () => {
		const before = await snapshot();
		const id = bobData.campaignId;
		const attempts = {
			saveCampaign: () => m.campaigns.saveCampaign(id, { subject: "Hacked", previewText: "", body: "<p>x</p>" }),
			sendTestCampaign: () => m.campaigns.sendTestCampaign(id),
			sendCampaign: () => m.campaigns.sendCampaign(id, {}),
			scheduleCampaign: () => m.campaigns.scheduleCampaign(id, { scheduledAt: new Date(Date.now() + 86_400_000).toISOString() }),
			unscheduleCampaign: () => m.campaigns.unscheduleCampaign(id),
			sendCampaignToMore: () => m.campaigns.sendCampaignToMore(id, {}),
			resumeCampaign: () => m.campaigns.resumeCampaign(id),
			pauseCampaign: () => m.campaigns.pauseCampaign(id),
			toggleArchivePin: () => m.campaigns.toggleArchivePin(id),
			duplicateCampaign: () => m.campaigns.duplicateCampaign(id),
			discardCampaign: () => m.campaigns.discardCampaign(id),
			updateArchiveSlug: () => m.campaigns.updateArchiveSlug(id, "stolen"),
			previewCleanup: () => m.campaigns.previewCleanup(id),
		};
		const emailsBefore = sesEmails.length;
		for (const [name, attempt] of Object.entries(attempts)) {
			const result = await as(alice, attempt);
			assert.equal(result?.error, "Campaign not found", name);
		}
		assert.equal(sesEmails.length, emailsBefore, "no test email went out");
		assert.equal(await m.Campaign.countDocuments({ accountId: alice.accountId }), 0, "no copy landed in Alice's account");
		assert.deepEqual(await snapshot(), before);
	});

	test("contacts: status changes and deleting", async () => {
		const before = await snapshot();
		assert.deepEqual(await as(alice, () => m.contacts.setContactStatus(bobData.readerId, "unsubscribed")), {
			error: "Contact not found",
		});
		assert.deepEqual(await as(alice, () => m.contacts.setContactStatus(bobData.dormantId, "active")), {
			error: "Contact not found",
		});
		assert.deepEqual(await as(alice, () => m.contacts.deleteContact(bobData.readerId)), { error: "Contact not found" });
		assert.deepEqual(await snapshot(), before);
	});

	test("API keys: revoking", async () => {
		const before = await snapshot();
		assert.deepEqual(await as(alice, () => m.apiKeys.revokeApiKey(bobData.apiKeyId)), { error: "Key not found" });
		assert.deepEqual(await snapshot(), before);
		const stillWorks = await callApi("GET", "/api/v1/campaigns?newsletter=bob-weekly", { key: bobData.apiKey });
		assert.equal(stillWorks.status, 200);
	});
});

describe("lists only show the account's own data", () => {
	test("newsletters, contacts, campaigns, API keys and uploads", async () => {
		const aliceAccount = { _id: alice.accountId };
		const newsletters = await m.contactQueries.listNewslettersWithActiveCounts(aliceAccount);
		assert.deepEqual(newsletters.map(({ slug }) => slug), ["alice-letters"]);

		const everything = await m.contactQueries.findContactsPage(aliceAccount, {});
		assert.equal(everything.totalAll, 0);
		const filtered = await m.contactQueries.findContactsPage(aliceAccount, { newsletterId: bobData.newsletterId });
		assert.equal(filtered.totalAll, 0, "naming Bob's newsletter in the filter shows nothing");
		const searched = await m.contactQueries.findContactsPage(aliceAccount, { query: "reader" });
		assert.equal(searched.contacts.length, 0);

		const campaigns = await m.Campaign.aggregate(m.campaignQueries.recentCampaignsPipeline({ accountId: alice.accountId, limit: 200 }));
		assert.equal(campaigns.length, 0);

		const keys = await m.apiKeyQueries.listApiKeys(aliceAccount);
		assert.deepEqual(keys.map(({ name }) => name), ["Alice's site"]);
		assert.equal(keys[0].hash, undefined, "the hash never reaches a page");

		assert.equal(await m.Upload.countDocuments(m.scope.scoped(aliceAccount)), 0);
		const usage = await m.usage.getUsage(alice.account);
		assert.equal(usage.subscribers, 0, "Bob's contacts don't count toward Alice's plan");
	});

	test("uploads land in the uploader's folder, and the route needs a paid session", async () => {
		const [bobUpload] = await m.Upload.find({ accountId: bob.accountId }).lean();
		assert.ok(bobUpload.pathname.startsWith(`accounts/${bob.accountId}/images/`));
		assert.ok(bobData.uploadUrl.includes(`accounts/${bob.accountId}/`));

		const aliceUpload = await upload(alice);
		assert.equal(aliceUpload.status, 200);
		const aliceUrl = (await aliceUpload.json()).url;
		assert.ok(aliceUrl.includes(`accounts/${alice.accountId}/`));
		assert.equal(await m.Upload.countDocuments({ accountId: bob.accountId }), 1, "Bob still has his one upload");
		const library = await as(alice, () => m.uploadsRoute.GET(new Request("http://localhost:3000/api/uploads")));
		assert.deepEqual((await library.json()).images.map(({ url }) => url), [aliceUrl], "the picker shows Alice's image, not Bob's");

		const signedOut = await anonymous(() =>
			m.uploadsRoute.POST(new Request("http://localhost:3000/api/uploads", { method: "POST", headers: { "content-type": "image/png" }, body: PNG }))
		);
		assert.equal(signedOut.status, 401);
	});
});

describe("API routes stay inside the key's account", () => {
	test("signing a contact up into another account's newsletter", async () => {
		const response = await callApi("POST", "/api/v1/contacts", {
			key: alice.apiKey,
			body: { newsletter: "bob-weekly", email: "intruder@example.net" },
		});
		assert.equal(response.status, 404);
		assert.deepEqual(response.body, { error: { code: "not_found", message: "Newsletter not found" } });
		assert.equal(await m.Contact.exists({ email: "intruder@example.net" }).setOptions({ crossAccount: true }), null);

		const own = await callApi("POST", "/api/v1/contacts", { key: bobData.apiKey, body: { newsletter: "bob-weekly", email: "fan@example.net" } });
		assert.equal(own.status, 201);
		await flushAfter();
		const fan = await m.Contact.findOne({ accountId: bob.accountId, email: "fan@example.net" }).lean();
		assert.equal(String(fan.newsletterId), bobData.newsletterId);
	});

	test("reading and drafting campaigns", async () => {
		const read = await callApi("GET", "/api/v1/campaigns?newsletter=bob-weekly", { key: alice.apiKey });
		assert.equal(read.status, 404);

		const draft = await callApi("POST", "/api/v1/campaigns", {
			key: alice.apiKey,
			body: { newsletter: "bob-weekly", subject: "Injected", format: "html", content: "<p>x</p>" },
		});
		assert.equal(draft.status, 404);
		assert.equal(await m.Campaign.countDocuments({ accountId: bob.accountId }), 1);

		const preview = await callApi("GET", `/api/v1/campaigns/${bobData.campaignId}/preview?contact=reader1@example.org`, { key: alice.apiKey });
		assert.deepEqual([preview.status, preview.body.error.message], [404, "Campaign not found"]);
	});

	test("searching contacts and previewing as one", async () => {
		const named = await callApi("GET", "/api/v1/contacts/search?newsletter=bob-weekly&query=reader", { key: alice.apiKey });
		assert.deepEqual([named.status, named.body.error.message], [404, "Newsletter not found"]);
		const everywhere = await callApi("GET", "/api/v1/contacts/search?query=reader", { key: alice.apiKey });
		assert.deepEqual(everywhere.body.contacts, [], "without a newsletter, only the key's account");

		const own = await callApi("POST", "/api/v1/campaigns", { key: alice.apiKey, body: { subject: "Hi {{first_name|there}}" } });
		const asBobsReader = await callApi("GET", `/api/v1/campaigns/${own.body.id}/preview?contact=${bobData.readerId}`, { key: alice.apiKey });
		assert.deepEqual([asBobsReader.status, asBobsReader.body.error.message], [404, "Contact not found"]);
		const byAddress = await callApi("GET", `/api/v1/campaigns/${own.body.id}/preview?contact=reader1@example.org`, { key: alice.apiKey });
		assert.equal(byAddress.status, 404);
	});

	test("an unknown or revoked key gets 401", async () => {
		const unknown = await callApi("POST", "/api/v1/contacts", {
			key: `mc_${"x".repeat(43)}`,
			body: { newsletter: "bob-weekly", email: "x@example.net" },
		});
		assert.equal(unknown.status, 401);
	});
});

describe("the scope guard", () => {
	test("a query on customer data without an accountId throws", async () => {
		await assert.rejects(m.Contact.find({ email: "reader1@example.org" }), /Contact query without an accountId/);
		await assert.rejects(m.Campaign.findOne({ _id: bobData.campaignId }), /Campaign query without an accountId/);
		await assert.rejects(m.Newsletter.updateOne({ slug: "bob-weekly" }, { $set: { name: "x" } }), /without an accountId/);
		await assert.rejects(m.Message.countDocuments({}), /Message query without an accountId/);
		await assert.rejects(m.Campaign.aggregate([{ $match: { status: "draft" } }]), /Campaign query without an accountId/);
		await assert.rejects(
			m.Suppression.bulkWrite([{ updateOne: { filter: { email: "a@example.com" }, update: { $set: { reason: "manual" } }, upsert: true } }]),
			/Suppression query without an accountId/
		);
		await assert.rejects(m.Contact.create({ newsletterId: bobData.newsletterId, email: "orphan@example.org" }), /accountId/);
	});

	test("an explicit crossAccount lookup still works, for webhooks and signed links", async () => {
		const found = await m.Campaign.findOne({ _id: bobData.campaignId }).setOptions({ crossAccount: true }).lean();
		assert.equal(String(found.accountId), String(bob.accountId));
		assert.throws(() => m.scope.scoped(undefined), /No account to scope/);
		assert.equal(String(m.scope.scoped({ _id: String(bob.accountId) }).accountId), String(bob.accountId));
	});
});
