import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { getEventPlan } from "../lib/email-event-rules.js";
import { normalizePostshibaEvent, verifyPostshibaSignature } from "../lib/email-provider/postshiba-events.js";
import { activate, catchRedirect, form, as, signIn, startTestApp } from "./helpers/app.mjs";
import { POSTSHIBA, POSTSHIBA_ENV } from "./helpers/postshiba.mjs";

const SECRET = POSTSHIBA.webhookSecret;
const ACCOUNT_ID = "64f1a2b3c4d5e6f7a8b9c0d1";
const MESSAGE_ID = "74f1a2b3c4d5e6f7a8b9c0d2";

function sign(body, { secret = SECRET, timestamp = Math.floor(Date.now() / 1000) } = {}) {
	return { timestamp: String(timestamp), signature: `sha256=${crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}` };
}

function postshibaEvent(event, fields = {}) {
	return {
		event,
		email: "Reader@Example.org",
		timestamp: 1_790_000_000,
		sg_event_id: `capsule-${crypto.randomUUID()}`,
		sg_message_id: "abc@postshiba.test",
		"smtp-id": "<abc@postshiba.test>",
		tenant_id: `mc-${ACCOUNT_ID}`,
		account_id: ACCOUNT_ID,
		message_id: MESSAGE_ID,
		unique_args: { account_id: ACCOUNT_ID, message_id: MESSAGE_ID, kind: "campaign" },
		...fields,
	};
}

test("a signature is sha256= and the hex HMAC of the timestamp and the exact body, at most 5 minutes old", () => {
	const body = JSON.stringify([postshibaEvent("delivered")]);
	const now = Date.now();
	const { timestamp, signature } = sign(body);
	assert.equal(verifyPostshibaSignature({ body, timestamp, signature, secret: SECRET, now }), true);
	assert.equal(verifyPostshibaSignature({ body: Buffer.from(body), timestamp, signature, secret: SECRET, now }), true, "raw bytes too");

	assert.equal(verifyPostshibaSignature({ body, timestamp, signature, secret: "another-secret", now }), false, "bad secret");
	assert.equal(verifyPostshibaSignature({ body: body.replace("delivered", "bounce"), timestamp, signature, secret: SECRET, now }), false, "changed body");
	assert.equal(verifyPostshibaSignature({ body, timestamp, signature: signature.slice(7), secret: SECRET, now }), false, "no prefix");
	assert.equal(verifyPostshibaSignature({ body, timestamp, signature: "sha256=not-hex", secret: SECRET, now }), false);
	assert.equal(verifyPostshibaSignature({ body, timestamp: String(Number(timestamp) + 1), signature, secret: SECRET, now }), false, "the timestamp is signed");
	assert.equal(verifyPostshibaSignature({ body, timestamp, signature, secret: "", now }), false, "no secret, no trust");
	assert.equal(verifyPostshibaSignature({ body, timestamp: null, signature, secret: SECRET, now }), false);

	const stale = sign(body, { timestamp: Math.floor(now / 1000) - 301 });
	assert.equal(verifyPostshibaSignature({ body, ...stale, secret: SECRET, now }), false, "stale");
	const future = sign(body, { timestamp: Math.floor(now / 1000) + 301 });
	assert.equal(verifyPostshibaSignature({ body, ...future, secret: SECRET, now }), false, "from the future");
	const recent = sign(body, { timestamp: Math.floor(now / 1000) - 299 });
	assert.equal(verifyPostshibaSignature({ body, ...recent, secret: SECRET, now }), true);
});

test("PostShiba's events take the one event shape, with the account and message from unique args", () => {
	const delivered = normalizePostshibaEvent(postshibaEvent("delivered", { response: "250 2.0.0 OK" }));
	assert.equal(delivered.type, "delivered");
	assert.equal(delivered.accountId, ACCOUNT_ID);
	assert.equal(delivered.messageId, MESSAGE_ID);
	assert.equal(delivered.providerMessageId, "abc@postshiba.test");
	const late = normalizePostshibaEvent(postshibaEvent("bounce", { sg_message_id: "C1BEAFF0-CE5C-11F1-8357-D2AEA50A6CD7" }));
	assert.equal(late.providerMessageId, "c1beaff0ce5c11f18357d2aea50a6cd7", "a late event's hyphenated id is the id other events give");
	assert.match(delivered.providerEventId, /^capsule-/);
	assert.equal(delivered.tenant, `mc-${ACCOUNT_ID}`);
	assert.equal(delivered.email, "reader@example.org");
	assert.deepEqual(delivered.occurredAt, new Date(1_790_000_000_000));
	assert.deepEqual(getEventPlan(delivered).status, { to: "delivered", from: ["queued", "sent", "failed"] });

	const hard = getEventPlan(normalizePostshibaEvent(postshibaEvent("bounce", { type: "bounce", status: "5.1.1", reason: "550 5.1.1 user unknown", bounce_classification: "Invalid Address" })));
	assert.equal(hard.error, "Hard bounce: Invalid Address, 550 5.1.1 user unknown");
	assert.deepEqual(hard.suppression, {
		emails: ["reader@example.org"],
		reason: "bounce",
		detail: "bounce/5.1.1",
		contactStatus: "bounced",
		contactStatusFrom: ["active", "dormant", "unsubscribed"],
	});
	const blocked = getEventPlan(normalizePostshibaEvent(postshibaEvent("bounce", { type: "blocked", reason: "550 5.7.1 reputation" })));
	assert.deepEqual([blocked.suppression, blocked.error], [null, "Soft bounce: 550 5.7.1 reputation"]);
	assert.equal(getEventPlan(normalizePostshibaEvent(postshibaEvent("bounce", { type: "bounce", reason: "expired" }))).suppression, null, "expired isn't the address");
	const flushed = getEventPlan(normalizePostshibaEvent(postshibaEvent("bounce", { type: "bounce", reason: "flushed by sender" })));
	assert.deepEqual([flushed.suppression, flushed.status, flushed.error], [null, null, "Soft bounce: flushed by sender"], "a flushed queue isn't the address");
	assert.equal(getEventPlan(normalizePostshibaEvent(postshibaEvent("bounce", {}))).suppression, null, "no type: PostShiba suppresses it if it was hard");

	const complaint = getEventPlan(normalizePostshibaEvent(postshibaEvent("spamreport", { attribution: "verified" })));
	assert.deepEqual([complaint.suppression.reason, complaint.suppression.detail, complaint.status.to], ["complaint", "spamreport (verified)", "complained"]);
	assert.equal(getEventPlan(normalizePostshibaEvent(postshibaEvent("unsubscribe"))).unsubscribe, true);

	const dropped = getEventPlan(normalizePostshibaEvent(postshibaEvent("dropped", { reason: "Bounced Address" })));
	assert.equal(dropped.error, "Dropped by PostShiba: Bounced Address");
	assert.equal(dropped.suppression.reason, "provider");
	assert.equal(getEventPlan(normalizePostshibaEvent(postshibaEvent("dropped", { reason: "Invalid" }))).suppression, null);
	const deferred = getEventPlan(normalizePostshibaEvent(postshibaEvent("deferred", { reason: "421 try later", attempt: "2" })));
	assert.deepEqual([deferred.status, deferred.isRecorded], [null, true]);
	assert.equal(normalizePostshibaEvent(postshibaEvent("processed")).type, "sent");

	for (const value of [null, [], "bounce", { event: "open" }, { event: "click" }, { event: "constructor" }, { event: "__proto__" }]) {
		assert.equal(normalizePostshibaEvent(value), null, JSON.stringify(value));
	}
	const spoofed = normalizePostshibaEvent(postshibaEvent("delivered", { unique_args: { account_id: { $ne: null }, message_id: "../x" }, account_id: undefined, message_id: undefined }));
	assert.deepEqual([spoofed.accountId, spoofed.messageId], [null, null]);
});

describe("the PostShiba webhook", () => {
	let app;
	let m;
	let alice;
	let bob;

	async function customer(email, slug) {
		const user = await signIn(email);
		await activate(user);
		const url = await as(user, () => catchRedirect(m.newsletters.saveNewsletter(null, form({ name: slug, slug, postalAddress: "1 Main St" }))));
		user.newsletterId = url.split("/").at(-1);
		user.tenantSlug = `mc-${user.accountId}`;
		await m.Account.updateOne({ _id: user.accountId }, { $set: { postshiba: { tenantId: `Tn-${slug}`, tenantSlug: user.tenantSlug, tenantStatus: "active" } } });
		return user;
	}

	async function sentMessage(user, email, fields = {}) {
		const contact = await m.Contact.create({ accountId: user.accountId, newsletterId: user.newsletterId, email, status: "active" });
		const campaignId = new mongoose.Types.ObjectId();
		await m.Campaign.create({ _id: campaignId, accountId: user.accountId, newsletterId: user.newsletterId, subject: "Issue", status: "sent", startedAt: new Date() });
		const message = await m.Message.create({
			kind: "campaign",
			accountId: user.accountId,
			newsletterId: user.newsletterId,
			campaignId,
			contactId: contact._id,
			email,
			status: "sent",
			sentAt: new Date(),
			...fields,
		});
		return { message, contact, campaignId };
	}

	function eventFor(user, message, event, fields = {}) {
		const args = message ? { account_id: String(user.accountId), message_id: String(message._id), kind: "campaign" } : {};
		return {
			event,
			email: message?.email ?? fields.email,
			timestamp: Math.floor(Date.now() / 1000),
			sg_event_id: `capsule-${crypto.randomUUID()}`,
			sg_message_id: `${crypto.randomUUID()}@postshiba.test`,
			tenant_id: user.tenantSlug,
			...args,
			unique_args: args,
			...fields,
		};
	}

	function post(events, { secret = SECRET, timestamp, body = JSON.stringify(events), headers } = {}) {
		const signed = sign(body, { secret, ...(timestamp && { timestamp }) });
		return m.route.POST(
			new Request("http://localhost:3000/api/webhooks/postshiba", {
				method: "POST",
				headers: headers ?? { "content-type": "application/json", "x-capsule-timestamp": signed.timestamp, "x-capsule-signature": signed.signature },
				body,
			})
		);
	}

	before(async () => {
		app = await startTestApp(POSTSHIBA_ENV);
		m = {
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			route: await import("../app/api/webhooks/postshiba/route.js"),
			Account: (await import("../models/Account.js")).default,
			Campaign: (await import("../models/Campaign.js")).default,
			Contact: (await import("../models/Contact.js")).default,
			Event: (await import("../models/Event.js")).default,
			Message: (await import("../models/Message.js")).default,
			Suppression: (await import("../models/Suppression.js")).default,
		};
		alice = await customer("alice-ps@example.com", "alice-ps");
		bob = await customer("bob-ps@example.com", "bob-ps");
	});

	after(() => app?.stop());

	test("only signed, fresh requests are read", async () => {
		const { message } = await sentMessage(alice, "signed@example.org");
		const events = [eventFor(alice, message, "delivered")];
		assert.equal((await post(events, { secret: "forged" })).status, 401);
		assert.equal((await post(events, { timestamp: Math.floor(Date.now() / 1000) - 600 })).status, 401, "stale");
		assert.equal((await post(events, { headers: { "content-type": "application/json" } })).status, 401, "unsigned");
		assert.equal((await m.Message.findOne({ accountId: alice.accountId, _id: message._id }).lean()).status, "sent", "nothing changed");
		assert.equal((await post({ event: "delivered" })).status, 400, "an array of events");

		const response = await post(events);
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { ok: true, handled: 1 });
		const delivered = await m.Message.findOne({ accountId: alice.accountId, _id: message._id }).lean();
		assert.equal(delivered.status, "delivered");
		assert.equal(delivered.providerMessageId, events[0].sg_message_id, "matched from then on by PostShiba's id");

		const secret = process.env.POSTSHIBA_WEBHOOK_SECRET;
		delete process.env.POSTSHIBA_WEBHOOK_SECRET;
		try {
			assert.equal((await post(events)).status, 503);
		} finally {
			process.env.POSTSHIBA_WEBHOOK_SECRET = secret;
		}
	});

	test("a hard bounce lands in its account only: message, contact, suppression and the account check", async () => {
		const { message, contact } = await sentMessage(alice, "shared-reader@example.org");
		const bobContact = await m.Contact.create({ accountId: bob.accountId, newsletterId: bob.newsletterId, email: "shared-reader@example.org", status: "active" });
		const bounce = eventFor(alice, message, "bounce", { type: "bounce", status: "5.1.1", reason: "550 5.1.1 unknown user" });
		assert.equal((await post([bounce])).status, 200);
		assert.equal((await post([bounce])).status, 200, "redelivered");

		assert.equal((await m.Message.findOne({ accountId: alice.accountId, _id: message._id }).lean()).status, "bounced");
		assert.equal((await m.Contact.findOne({ accountId: alice.accountId, _id: contact._id }).lean()).status, "bounced");
		assert.ok(await m.Suppression.exists({ accountId: alice.accountId, email: "shared-reader@example.org", reason: "bounce" }));
		assert.equal(await m.Event.countDocuments({ accountId: alice.accountId, providerEventId: bounce.sg_event_id }), 1, "recorded once");
		assert.ok((await m.Account.findById(alice.accountId).lean()).health.checkedAt, "the 7-day check ran");

		assert.equal((await m.Contact.findOne({ accountId: bob.accountId, _id: bobContact._id }).lean()).status, "active", "Bob's contact with the same address stays");
		assert.equal(await m.Suppression.countDocuments({ accountId: bob.accountId }), 0);
		assert.equal(await m.Event.countDocuments({ accountId: bob.accountId }), 0);
	});

	test("an event whose tenant isn't the account its unique args name is ignored", async () => {
		const { message } = await sentMessage(alice, "spoof@example.org");
		const spoofed = eventFor(alice, message, "bounce", { type: "bounce", tenant_id: bob.tenantSlug });
		assert.equal((await post([spoofed])).status, 200);
		assert.equal((await m.Message.findOne({ accountId: alice.accountId, _id: message._id }).lean()).status, "sent");
		assert.equal(await m.Suppression.countDocuments({ email: "spoof@example.org" }).setOptions({ crossAccount: true }), 0);

		const { message: bobMessage } = await sentMessage(bob, "bob-only@example.org");
		const crossed = eventFor(alice, bobMessage, "spamreport");
		assert.equal((await post([crossed])).status, 200);
		assert.equal((await m.Message.findOne({ accountId: bob.accountId, _id: bobMessage._id }).lean()).status, "sent", "Bob's message isn't in Alice's account");
		assert.equal(await m.Suppression.countDocuments({ accountId: bob.accountId }), 0);
	});

	test("without unique args the tenant names the account, and suppressions still apply there", async () => {
		await m.Contact.create({ accountId: bob.accountId, newsletterId: bob.newsletterId, email: "no-args@example.org", status: "active" });
		const aliceContact = await m.Contact.create({ accountId: alice.accountId, newsletterId: alice.newsletterId, email: "no-args@example.org", status: "active" });
		const spam = eventFor(bob, null, "spamreport", { email: "no-args@example.org" });
		assert.equal((await post([spam])).status, 200);
		assert.ok(await m.Suppression.exists({ accountId: bob.accountId, email: "no-args@example.org", reason: "complaint" }));
		assert.equal((await m.Contact.findOne({ accountId: bob.accountId, email: "no-args@example.org" }).lean()).status, "complained");
		assert.equal((await m.Contact.findOne({ accountId: alice.accountId, _id: aliceContact._id }).lean()).status, "active");

		assert.equal((await post([eventFor({ tenantSlug: "mc-000000000000000000000000" }, null, "bounce", { email: "x@example.org", type: "bounce" })])).status, 200);
		assert.equal((await post([{ event: "delivered", email: "test@example.com", timestamp: 1, test: true }])).status, 200, "PostShiba's test event");
	});

	test("a late bounce or spam report, without unique args and with its id hyphenated, still lands on its email", async () => {
		const bounceId = "c1beaff0-ce5c-11f1-8357-d2aea50a6cd7";
		const { message, contact, campaignId } = await sentMessage(alice, "late-bounce@example.org");
		assert.equal((await post([eventFor(alice, message, "delivered", { sg_message_id: bounceId.replace(/-/g, "") })])).status, 200);
		const lateBounce = eventFor(alice, null, "bounce", {
			email: "late-bounce@example.org",
			type: "bounce",
			status: "5.1.1",
			reason: "550 5.1.1 user unknown",
			bounce_classification: "Invalid Address",
			sg_message_id: bounceId,
		});
		assert.equal((await post([lateBounce])).status, 200);
		const bounced = await m.Message.findOne({ accountId: alice.accountId, _id: message._id }).lean();
		assert.equal(bounced.status, "bounced");
		assert.ok(bounced.bouncedAt);
		assert.equal((await m.Campaign.findOne({ accountId: alice.accountId, _id: campaignId }).lean()).stats.bounced, 1);
		assert.equal((await m.Contact.findOne({ accountId: alice.accountId, _id: contact._id }).lean()).status, "bounced");

		const complaintId = "d072fe85-cdf3-11f1-8111-d688540e9bd3";
		const { message: read, campaignId: readCampaignId } = await sentMessage(alice, "late-complaint@example.org");
		assert.equal((await post([eventFor(alice, read, "delivered", { sg_message_id: complaintId.replace(/-/g, "") })])).status, 200);
		const lateComplaint = eventFor(alice, null, "spamreport", { email: "late-complaint@example.org", sg_message_id: complaintId.toUpperCase() });
		assert.equal((await post([lateComplaint])).status, 200);
		assert.equal((await m.Message.findOne({ accountId: alice.accountId, _id: read._id }).lean()).status, "complained");
		assert.equal((await m.Campaign.findOne({ accountId: alice.accountId, _id: readCampaignId }).lean()).stats.complained, 1);
	});

	test("PostShiba's own unsubscribe link unsubscribes the address across the account, and a drop of a suppressed address suppresses it", async () => {
		const { message, contact, campaignId } = await sentMessage(alice, "leaving@example.org");
		assert.equal((await post([eventFor(alice, message, "unsubscribe")])).status, 200);
		const left = await m.Contact.findOne({ accountId: alice.accountId, _id: contact._id }).lean();
		assert.equal(left.status, "unsubscribed");
		assert.ok(left.unsubscribedAt);
		assert.equal((await m.Campaign.findOne({ accountId: alice.accountId, _id: campaignId }).lean()).stats.unsubscribed, 1);

		const { message: dropped } = await sentMessage(alice, "dropped@example.org");
		assert.equal((await post([eventFor(alice, dropped, "dropped", { reason: "Bounced Address" })])).status, 200);
		const failed = await m.Message.findOne({ accountId: alice.accountId, _id: dropped._id }).lean();
		assert.deepEqual([failed.status, failed.error], ["failed", "Dropped by PostShiba: Bounced Address"]);
		assert.equal((await m.Suppression.findOne({ accountId: alice.accountId, email: "dropped@example.org" }).lean()).reason, "provider");
	});
});
