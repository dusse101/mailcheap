import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { getAccountRateProblem } from "../lib/sending-rules.js";
import { getSesEventPlan } from "../lib/ses-event-mapping.js";
import { buildSigningString } from "../lib/sns.js";
import { getTenantEventPlan, getTenantName } from "../lib/tenant-event-rules.js";
import { activate, as, catchRedirect, form, jsonRequest, platformEmails, signIn, startTestApp } from "./helpers/app.mjs";
import { state } from "./stubs/ses.mjs";

const TENANT_ARN = (name) => `arn:aws:ses:us-east-1:111122223333:tenant/${name}/tn-0123`;

function tenantEvent(type, name, detail = {}) {
	return { source: "aws.ses", "detail-type": type, time: "2026-10-12T08:00:00Z", resources: [TENANT_ARN(name)], detail };
}

test("tenant events name their tenant in the resources", () => {
	assert.equal(getTenantName({ resources: ["arn:aws:ses:us-east-1:111122223333:configuration-set/x", TENANT_ARN("mc-abc")] }), "mc-abc");
	assert.equal(getTenantName({ resources: ["arn:aws:ses:us-east-1:111122223333:tenant/../x"] }), null);
	assert.equal(getTenantName({}), null);
});

test("disabled sending and high-impact findings pause; the rest is recorded", () => {
	const disabled = getTenantEventPlan(tenantEvent("Sending Status Disabled", "mc-a", { data: { record: { status: "DISABLED", cause: "Bounce rate over 15%" } } }));
	assert.deepEqual({ status: disabled.status, pause: disabled.pause }, { status: "DISABLED", pause: "SES paused sending: Bounce rate over 15%" });
	assert.equal(getTenantEventPlan(tenantEvent("Sending Status Enabled", "mc-a")).pause, undefined);

	const high = getTenantEventPlan(tenantEvent("Advisor Recommendation Status Open", "mc-a", { metadata: { impact: "HIGH", type: "BOUNCE" } }));
	assert.equal(high.pause, "SES finding: BOUNCE (high impact)");
	const low = getTenantEventPlan(tenantEvent("Advisor Recommendation Status Open", "mc-a", { metadata: { impact: "LOW", type: "DMARC" } }));
	assert.deepEqual({ finding: low.finding, pause: low.pause }, { finding: "DMARC (low impact)", pause: undefined });
	assert.equal(getTenantEventPlan(tenantEvent("Advisor Recommendation Status Closed", "mc-a")).finding, null);

	assert.equal(getTenantEventPlan({ ...tenantEvent("Sending Status Disabled", "mc-a"), source: "aws.s3" }), null);
	assert.equal(getTenantEventPlan(tenantEvent("Something else", "mc-a")), null);
});

test("the 7-day check holds a send's levels over the account's last 7 days", () => {
	const level = (counts) => getAccountRateProblem(counts)?.level ?? null;
	assert.equal(level({ sent: 1000, delivered: 975, bounced: 25, complained: 1 }), null, "exactly 2.5%, and one complaint");
	assert.equal(level({ sent: 1000, delivered: 965, bounced: 26 }), "pause");
	assert.equal(level({ sent: 200, delivered: 200, complained: 2 }), "pause", "2 complaints warn, they don't block");
	assert.equal(getAccountRateProblem({ sent: 200, complained: 3 }).reason, "Complaint rate of 1.50% over the last 7 days (limit 0.30%)");
	assert.equal(level({ sent: 5000, delivered: 4900, complained: 3 }), null, "3 in 5,000 is under both");
});

test("SES events carry their account in a tag", () => {
	const id = "64f1a2b3c4d5e6f7a8b9c0d1";
	const plan = getSesEventPlan({ eventType: "Delivery", mail: { messageId: "x", tags: { account_id: [id.toUpperCase()], message_id: [id] } } });
	assert.equal(plan.accountId, id);
	assert.equal(getSesEventPlan({ eventType: "Delivery", mail: { tags: { account_id: ["{}"] } } }).accountId, null);
});

describe("per-account events", () => {
	let app;
	let m;
	let alice;
	let bob;
	const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
	const CERT_URL = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-0123456789abcdef0123456789abcdef.pem";
	const TOPIC = "arn:aws:sns:us-east-1:111122223333:mailcheap-ses-tenants";

	function signed(message) {
		const unsigned = { SigningCertURL: CERT_URL, SignatureVersion: "2", ...message };
		return { ...unsigned, Signature: crypto.createSign("RSA-SHA256").update(buildSigningString(unsigned)).sign(privateKey, "base64") };
	}

	function snsNotification(event, overrides = {}) {
		return signed({
			Type: "Notification",
			MessageId: crypto.randomUUID(),
			TopicArn: TOPIC,
			Message: JSON.stringify(event),
			Timestamp: new Date().toISOString(),
			...overrides,
		});
	}

	async function customer(email, slug) {
		const user = await signIn(email);
		await activate(user);
		const url = await as(user, () => catchRedirect(m.newsletters.saveNewsletter(null, form({ name: slug, slug, postalAddress: "1 Main St" }))));
		user.newsletterId = url.split("/").at(-1);
		await m.tenants.provisionTenant(user.accountId);
		return user;
	}

	function bounce({ user, message, email = message.email }) {
		return m.events.handleSesEvent({
			eventType: "Bounce",
			mail: { messageId: message.providerMessageId, destination: [email], tags: { account_id: [String(user.accountId)], message_id: [String(message._id)] } },
			bounce: { bounceType: "Permanent", bounceSubType: "General", bouncedRecipients: [{ emailAddress: email }] },
		});
	}

	async function sentMessages(user, count, fields = () => ({})) {
		const now = Date.now();
		const docs = Array.from({ length: count }, (_, index) => ({
			kind: "campaign",
			accountId: user.accountId,
			newsletterId: user.newsletterId,
			campaignId: new mongoose.Types.ObjectId(),
			contactId: new mongoose.Types.ObjectId(),
			email: `r${index}@${user.newsletterId}.example.org`,
			status: "delivered",
			providerMessageId: `ses-${user.accountId}-${index}-${now}`,
			sentAt: new Date(now - 3_600_000),
			deliveredAt: new Date(now - 3_500_000),
			...fields(index),
		}));
		return m.Message.insertMany(docs);
	}

	before(async () => {
		app = await startTestApp({ SES_TENANT_SNS_TOPIC_ARN: TOPIC });
		m = {
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			admin: await import("../app/admin/actions.js"),
			events: await import("../lib/ses-events.js"),
			tenants: await import("../lib/tenants.js"),
			tenantRoute: await import("../app/api/webhooks/ses-tenants/route.js"),
			Account: (await import("../models/Account.js")).default,
			Message: (await import("../models/Message.js")).default,
			Suppression: (await import("../models/Suppression.js")).default,
			Event: (await import("../models/Event.js")).default,
		};
		const fetch = globalThis.fetch;
		globalThis.fetch = async (input, init) =>
			String(input) === CERT_URL ? new Response(publicKey.export({ type: "spki", format: "pem" })) : fetch(input, init);
		alice = await customer("alice-events@example.com", "alice-events");
		bob = await customer("bob-events@example.com", "bob-events");
	});

	after(() => app?.stop());

	test("a bounce is recorded in the account its tag names, and suppressed there only", async () => {
		const [message] = await sentMessages(alice, 1);
		const spoofed = await m.events.handleSesEvent({
			eventType: "Bounce",
			mail: { messageId: message.providerMessageId, destination: [message.email], tags: { account_id: [String(bob.accountId)], message_id: [String(message._id)] } },
			bounce: { bounceType: "Permanent", bouncedRecipients: [{ emailAddress: message.email }] },
		});
		assert.deepEqual(spoofed, { handled: true, messageId: null }, "another account's tag finds nothing");
		const untagged = await m.events.handleSesEvent({ eventType: "Bounce", mail: { messageId: message.providerMessageId }, bounce: { bounceType: "Permanent" } });
		assert.deepEqual(untagged, { handled: true, messageId: null });

		assert.deepEqual(await bounce({ user: alice, message }), { handled: true, messageId: String(message._id) });
		assert.equal((await m.Message.findOne({ accountId: alice.accountId, _id: message._id }).lean()).status, "bounced");
		assert.ok(await m.Suppression.exists({ accountId: alice.accountId, email: message.email }));
		assert.equal(await m.Suppression.countDocuments({ accountId: bob.accountId }), 0);
		assert.equal(await m.Event.countDocuments({ accountId: bob.accountId }), 0);
	});

	test("bounces over 7 days warn the owner at the pause level, and block the account at the block level", async () => {
		const user = await customer("bouncy@example.com", "bouncy");
		const messages = await sentMessages(user, 600, (index) => (index < 15 ? { bouncedAt: new Date(), status: "bounced" } : {}));
		await m.Account.updateOne({ _id: user.accountId }, { $unset: { health: 1 } });
		const emailsBefore = platformEmails.length;
		await bounce({ user, message: messages[599] });

		const warned = await m.Account.findById(user.accountId).lean();
		assert.equal(warned.status, "active", "16 bounces of 600, at 2.67%: nothing stops");
		assert.equal(warned.health.sent, 600);
		assert.ok(Math.abs(warned.health.bounceRate - 16 / 600) < 1e-9);
		const emails = platformEmails.slice(emailsBefore);
		const warning = emails.find(({ subject }) => subject === "[MailCheap] Bounces or complaints are high");
		assert.deepEqual(warning.to, ["bouncy@example.com"]);
		assert.match(warning.text, /Bounce rate of 2.67% over the last 7 days \(limit 2.50%\)\. Nothing is paused, but at 5.00% with 10 bounces the account is blocked/);
		assert.equal(emails.some(({ to }) => to.includes("admin@example.com")), false, "the admins only hear of blocks");

		await m.Message.updateMany({ accountId: user.accountId, _id: { $in: messages.slice(15, 36).map(({ _id }) => _id) } }, { $set: { bouncedAt: new Date(), status: "bounced" } });
		await m.Account.updateOne({ _id: user.accountId }, { $unset: { "health.checkedAt": 1 } });
		await bounce({ user, message: messages[598] });
		const account = await m.Account.findById(user.accountId).lean();
		assert.equal(account.status, "paused");
		assert.equal(account.pausedBy, "rates");
		assert.equal(account.pauseReason, "Bounce rate of 6.33% over the last 7 days (limit 5.00%)", "38 bounces of 600");

		const admin = await signIn("admin@example.com");
		assert.deepEqual(await as(admin, () => m.admin.unblockAccountAction(String(user.accountId))), { ok: true });
		const resumed = await m.Account.findById(user.accountId).lean();
		assert.equal(resumed.status, "active");
		assert.equal(resumed.pausedBy, undefined);
		assert.equal(state.reinstated.includes(resumed.ses.tenantArn), false, "only SES pauses need SES to reinstate");
	});

	test("SES pausing a tenant blocks its account; enabling it again doesn't, and unblocking reinstates the tenant", async () => {
		const name = `mc-${bob.accountId}`;
		const response = await m.tenantRoute.POST(
			jsonRequest("/api/webhooks/ses-tenants", {
				method: "POST",
				body: snsNotification(tenantEvent("Sending Status Disabled", name, { data: { record: { status: "DISABLED", cause: "Complaint rate" } } })),
			})
		);
		assert.equal(response.status, 200);
		const paused = await m.Account.findById(bob.accountId).lean();
		assert.equal(paused.status, "paused");
		assert.equal(paused.pausedBy, "ses");
		assert.equal(paused.pauseReason, "SES paused sending: Complaint rate");
		assert.equal(paused.ses.tenantStatus, "DISABLED");
		assert.equal((await m.Account.findById(alice.accountId).lean()).status, "active", "other accounts keep sending");

		const enabled = await m.tenantRoute.POST(
			jsonRequest("/api/webhooks/ses-tenants", { method: "POST", body: snsNotification(tenantEvent("Sending Status Enabled", name, { data: { record: { status: "ENABLED" } } })) })
		);
		assert.equal(enabled.status, 200);
		const stillBlocked = await m.Account.findById(bob.accountId).lean();
		assert.deepEqual([stillBlocked.status, stillBlocked.ses.tenantStatus], ["paused", "ENABLED"], "only an admin unblocks it");

		const admin = await signIn("admin@example.com");
		assert.deepEqual(await as(admin, () => m.admin.unblockAccountAction(String(bob.accountId))), { ok: true });
		assert.ok(state.reinstated.includes(paused.ses.tenantArn));
		assert.equal((await m.Account.findById(bob.accountId).lean()).ses.tenantStatus, "REINSTATED");
	});

	test("the tenant route only takes signed messages from its topic", async () => {
		const event = tenantEvent("Sending Status Disabled", `mc-${alice.accountId}`);
		const post = (body) => m.tenantRoute.POST(jsonRequest("/api/webhooks/ses-tenants", { method: "POST", body }));
		assert.equal((await post(snsNotification(event, { TopicArn: "arn:aws:sns:us-east-1:111122223333:other" }))).status, 403);
		assert.equal((await post({ ...snsNotification(event), Message: JSON.stringify({ ...event, detail: { forged: true } }) })).status, 400);
		assert.equal((await m.Account.findById(alice.accountId).lean()).status, "active");
	});
});
