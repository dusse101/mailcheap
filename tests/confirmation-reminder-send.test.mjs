import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { verifyConfirmToken } from "../lib/confirmation.js";
import { CONFIRMATION_REMINDER_KIND } from "../lib/confirmation-reminder-rules.js";
import { activate, as, callApi, catchRedirect, form, signIn, startTestApp, withEnv } from "./helpers/app.mjs";
import { flushAfter } from "./stubs/next-server.mjs";
import { state as sesState, sent as sesEmails } from "./stubs/ses.mjs";

// The hourly job's one reminder. Signups still send the confirmation email themselves; this never sends the
// list-cleanup last-chance email, and it sends nothing until CONFIRMATION_REMINDERS names the newsletter.
let app;
let m;
let visitor = 0;
let tail = Promise.resolve();

// These tests share one database and the process environment, so they run one at a time.
function serial(name, fn) {
	test(name, async () => {
		const previous = tail;
		let release;
		tail = new Promise((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			await fn();
		} finally {
			release();
		}
	});
}
const HOUR = 60 * 60 * 1000;

async function customer(email, { confirm = true } = {}) {
	const user = await signIn(email);
	await activate(user);
	user.slug = email.split("@")[0];
	const url = await as(user, () =>
		catchRedirect(m.newsletters.saveNewsletter(null, form({ name: `${user.slug} news`, slug: user.slug, postalAddress: "1 Main St, Paris" })))
	);
	user.newsletterId = url.split("/").at(-1);
	user.key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;
	user.signupsKey = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Site", level: "signups" })))).key;
	if (confirm) {
		const saved = await callApi("PATCH", `/api/v1/newsletters/${user.slug}`, { key: user.key, body: { requireConfirmation: true } });
		assert.equal(saved.status, 200, JSON.stringify(saved.body));
	}
	return user;
}

function signUp(user, email) {
	return callApi("POST", "/api/v1/contacts", {
		key: user.signupsKey,
		body: { newsletter: user.slug, email, source: "website", resubscribe: true, ip: `203.0.113.${++visitor % 250}` },
	});
}

async function addPending(user, email) {
	const before = sesEmails.length;
	const response = await signUp(user, email);
	assert.equal(response.status, 201, JSON.stringify(response.body));
	assert.equal(response.body.status, "pending");
	await flushAfter();
	const contact = await m.Contact.findOne({ accountId: user.accountId, email }).lean();
	assert.equal(contact.status, "pending");
	assert.equal(sesEmails.slice(before).filter((message) => message.to === email && message.subject.startsWith("Confirm ")).length, 1);
	return contact;
}

async function age(user, email, { subscribedHours, confirmationHours = subscribedHours, status }) {
	const now = new Date();
	const contact = await m.Contact.findOne({ accountId: user.accountId, email }).lean();
	const subscribedAt = new Date(now.getTime() - subscribedHours * HOUR);
	const confirmationAt = new Date(now.getTime() - confirmationHours * HOUR);
	await m.Contact.collection.updateOne({ _id: contact._id }, { $set: { subscribedAt, ...(status && { status }) } });
	await m.Message.collection.updateMany(
		{ accountId: user.accountId, contactId: contact._id, kind: "confirmation" },
		{ $set: { createdAt: confirmationAt, sentAt: confirmationAt } }
	);
	return m.Contact.findOne({ accountId: user.accountId, email }).lean();
}

function reminderEnv(slugs, since = new Date(Date.now() - 30 * 24 * HOUR)) {
	const map = Object.fromEntries(slugs.map((slug) => [slug, since.toISOString()]));
	return { CONFIRMATION_REMINDERS: JSON.stringify(map) };
}

function run(extra = {}, now = new Date()) {
	// The reminder map is passed in. Writing it to process.env races when two runs overlap.
	const go = () => m.reminders.queueConfirmationReminders({ now, env: { ...process.env, ...extra } });
	return extra.SENDING_ENABLED === undefined ? go() : withEnv({ SENDING_ENABLED: extra.SENDING_ENABLED }, go);
}

function remindersTo(email, from = 0) {
	return sesEmails.slice(from).filter((message) => message.to === email && message.subject.startsWith("Reminder:"));
}

function tokenOf(message) {
	return message?.html?.match(/\/confirm\?token=([^"&]+)/)?.[1] ?? null;
}

before(async () => {
	app = await startTestApp();
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		reminders: await import("../lib/confirmation-reminder.js"),
		globalSuppressions: await import("../lib/global-suppressions.js"),
		Contact: (await import("../models/Contact.js")).default,
		Message: (await import("../models/Message.js")).default,
		Newsletter: (await import("../models/Newsletter.js")).default,
		Suppression: (await import("../models/Suppression.js")).default,
	};
});

after(() => app?.stop());

serial("a pending contact gets one reminder at 24 hours, and not before, after a resend, or once the window has closed", async () => {
	const user = await customer("remind-window@example.com");
	const other = await customer("remind-other@example.com");
	const plain = await customer("remind-plain@example.com", { confirm: false });
	await addPending(user, "young@example.org");
	await addPending(user, "due@example.org");
	await addPending(user, "quiet@example.org");
	await addPending(user, "late@example.org");
	await addPending(user, "held@example.org");
	await addPending(user, "bounced@example.org");
	await addPending(user, "complained@example.org");
	await addPending(user, "left@example.org");
	await addPending(user, "gone@example.org");
	await addPending(user, "fresh@example.org");
	const outsider = await addPending(other, "outsider@example.org");
	await age(user, "young@example.org", { subscribedHours: 23 });
	await age(user, "due@example.org", { subscribedHours: 25 });
	await age(user, "quiet@example.org", { subscribedHours: 40, confirmationHours: 2 });
	await age(user, "late@example.org", { subscribedHours: 80 });
	await age(user, "held@example.org", { subscribedHours: 25 });
	await age(user, "bounced@example.org", { subscribedHours: 25, status: "bounced" });
	await age(user, "complained@example.org", { subscribedHours: 25, status: "complained" });
	await age(user, "left@example.org", { subscribedHours: 25, status: "unsubscribed" });
	const deleted = await age(user, "gone@example.org", { subscribedHours: 25 });
	await age(other, "outsider@example.org", { subscribedHours: 25 });
	await m.Suppression.create({ accountId: user.accountId, email: "held@example.org", reason: "manual" });
	await m.Contact.deleteOne({ accountId: user.accountId, _id: deleted._id });
	await m.Contact.create({
		accountId: plain.accountId,
		newsletterId: plain.newsletterId,
		email: "plain-pending@example.org",
		status: "pending",
		subscribedAt: new Date(Date.now() - 25 * HOUR),
	});
	const before = sesEmails.length;

	const first = await run(reminderEnv([user.slug, plain.slug]));
	assert.equal(first.sent, 1, JSON.stringify(first));
	assert.deepEqual(remindersTo("due@example.org", before).map((message) => message.to), ["due@example.org"]);
	for (const email of ["young@example.org", "quiet@example.org", "late@example.org", "held@example.org", "bounced@example.org", "complained@example.org", "left@example.org", "gone@example.org", "fresh@example.org", "outsider@example.org", "plain-pending@example.org"]) {
		assert.equal(remindersTo(email, before).length, 0, email);
	}
	const due = await m.Contact.findOne({ accountId: user.accountId, email: "due@example.org" }).lean();
	assert.equal(due.status, "pending");
	assert.equal(due.confirmationReminder.state, "sent");
	assert.equal(due.lastChanceAt, undefined);
	assert.equal(await m.Message.countDocuments({ accountId: user.accountId, contactId: due._id, kind: "confirmation" }), 1);
	assert.equal(await m.Message.countDocuments({ accountId: user.accountId, contactId: due._id, kind: CONFIRMATION_REMINDER_KIND }), 1);
	const listed = await callApi("GET", `/api/v1/contacts/${due._id}/emails`, { key: user.key });
	assert.equal(listed.status, 200, JSON.stringify(listed.body));
	assert.ok(listed.body.emails.some((email) => email.kind === CONFIRMATION_REMINDER_KIND));

	const original = sesEmails.find((message) => message.to === "due@example.org" && message.subject.startsWith("Confirm "));
	const reminder = remindersTo("due@example.org", before)[0];
	const reminderToken = tokenOf(reminder);
	assert.ok(verifyConfirmToken(reminderToken));
	assert.notEqual(reminderToken, tokenOf(original));
	const stamped = JSON.parse(Buffer.from(reminderToken.split(".")[0], "base64url").toString());
	assert.ok(Math.abs(stamped.t * 1000 - Date.now()) < 60_000, "the reminder mints its own link");
	assert.match(reminder.subject, /^Reminder: confirm your subscription to remind-window news$/);
	assert.match(reminder.text, /only reminder/);
	assert.equal(/best tacos/i.test(reminder.text), false);

	const again = await run(reminderEnv([user.slug]));
	assert.equal(again.sent, 0);
	assert.equal(remindersTo("due@example.org", before).length, 1, "a second run does not send another");

	await m.Message.collection.updateMany(
		{ accountId: user.accountId, email: "quiet@example.org", kind: "confirmation" },
		{ $set: { createdAt: new Date(Date.now() - 30 * HOUR), sentAt: new Date(Date.now() - 30 * HOUR) } }
	);
	const afterQuiet = await run(reminderEnv([user.slug]));
	assert.equal(afterQuiet.sent, 1);
	assert.equal(remindersTo("quiet@example.org").length, 1, "once the resend is a day old, the one reminder goes out");
	assert.equal(outsider.status, "pending");
	assert.equal(await m.Message.countDocuments({ accountId: other.accountId, kind: CONFIRMATION_REMINDER_KIND }), 0);
	assert.equal(await m.Message.countDocuments({ accountId: plain.accountId, kind: CONFIRMATION_REMINDER_KIND }), 0);
});

serial("two overlapping runs send one reminder", async () => {
	const user = await customer("remind-once@example.com");
	await addPending(user, "once@example.org");
	await age(user, "once@example.org", { subscribedHours: 25 });
	const before = sesEmails.length;
	const [first, second] = await Promise.all([run(reminderEnv([user.slug])), run(reminderEnv([user.slug]))]);
	assert.equal(first.sent + second.sent, 1, JSON.stringify({ first, second }));
	assert.equal(remindersTo("once@example.org", before).length, 1);
	assert.equal(await m.Message.countDocuments({ accountId: user.accountId, email: "once@example.org", kind: CONFIRMATION_REMINDER_KIND }), 1);
});

serial("a confirm that lands as the reminder is claimed suppresses it", async () => {
	const user = await customer("remind-race@example.com");
	const contact = await addPending(user, "race@example.org");
	await age(user, "race@example.org", { subscribedHours: 25 });
	const before = sesEmails.length;
	globalThis.__mailcheapRaceContactId = contact._id;
	try {
		const result = await run(reminderEnv([user.slug]));
		assert.equal(result.sent, 0, JSON.stringify(result));
	} finally {
		globalThis.__mailcheapRaceContactId = null;
	}
	assert.equal(remindersTo("race@example.org", before).length, 0);
	const after = await m.Contact.findOne({ accountId: user.accountId, email: "race@example.org" }).lean();
	assert.equal(after.status, "active");
	assert.equal(after.confirmationReminder.state, "skipped");
	const message = await m.Message.findOne({ accountId: user.accountId, contactId: contact._id, kind: CONFIRMATION_REMINDER_KIND }).lean();
	assert.equal(message.status, "suppressed");
	assert.equal(message.sentAt, undefined);
});

serial("a failed reminder is tried again, and an expired link is not sent", async () => {
	const user = await customer("remind-retry@example.com");
	await addPending(user, "retry@example.org");
	await addPending(user, "stale@example.org");
	await age(user, "retry@example.org", { subscribedHours: 25 });
	await age(user, "stale@example.org", { subscribedHours: 25 });
	const before = sesEmails.length;
	sesState.failNext = { name: "sendSesEmail", times: 2, error: Object.assign(new Error("mailbox down"), { name: "ServiceUnavailable" }) };
	try {
		const failed = await run(reminderEnv([user.slug]));
		assert.equal(failed.sent, 0, JSON.stringify(failed));
		assert.ok(failed.failed >= 1);
	} finally {
		sesState.failNext = null;
	}
	assert.equal(remindersTo("retry@example.org", before).length, 0);
	assert.equal(remindersTo("stale@example.org", before).length, 0);
	const retryContact = await m.Contact.findOne({ accountId: user.accountId, email: "retry@example.org" }).lean();
	assert.equal(retryContact.confirmationReminder.state, "retry");
	assert.equal(
		(await m.Message.findOne({ accountId: user.accountId, contactId: retryContact._id, kind: CONFIRMATION_REMINDER_KIND }).lean()).status,
		"failed"
	);

	const staleContact = await m.Contact.findOne({ accountId: user.accountId, email: "stale@example.org" }).lean();
	await m.Message.collection.updateOne(
		{ accountId: user.accountId, contactId: staleContact._id, kind: CONFIRMATION_REMINDER_KIND },
		{ $set: { createdAt: new Date(Date.now() - 31 * 24 * HOUR) } }
	);
	const second = await run(reminderEnv([user.slug]));
	assert.equal(second.sent, 1, JSON.stringify(second));
	assert.equal(remindersTo("retry@example.org", before).length, 1);
	assert.equal(remindersTo("stale@example.org", before).length, 0);
	assert.equal((await m.Contact.findOne({ accountId: user.accountId, email: "retry@example.org" }).lean()).confirmationReminder.state, "sent");
	assert.equal(await m.Message.countDocuments({ accountId: user.accountId, email: "retry@example.org", kind: CONFIRMATION_REMINDER_KIND }), 1);
	const staleMessage = await m.Message.findOne({ accountId: user.accountId, contactId: staleContact._id, kind: CONFIRMATION_REMINDER_KIND }).lean();
	assert.equal(staleMessage.status, "skipped");
	assert.equal(staleMessage.error, "The confirmation link expired");
	assert.equal((await m.Contact.findOne({ accountId: user.accountId, _id: staleContact._id }).lean()).confirmationReminder.state, "skipped");
});

serial("signing up again after leaving can be reminded once, and the first signup still only gets its confirmation", async () => {
	const user = await customer("remind-cycle@example.com");
	await addPending(user, "cycle@example.org");
	await age(user, "cycle@example.org", { subscribedHours: 25 });
	assert.equal((await run(reminderEnv([user.slug]))).sent, 1);
	await m.Contact.updateOne({ accountId: user.accountId, email: "cycle@example.org" }, { $set: { status: "unsubscribed", unsubscribedAt: new Date() } });
	const before = sesEmails.length;
	const again = await signUp(user, "cycle@example.org");
	assert.equal(again.body.status, "pending");
	await flushAfter();
	assert.equal(sesEmails.slice(before).filter((message) => message.subject.startsWith("Confirm ")).length, 1);
	assert.equal((await run(reminderEnv([user.slug]))).sent, 0, "the new signup is not reminded in the same hour");
	await age(user, "cycle@example.org", { subscribedHours: 25 });
	const reminded = await run(reminderEnv([user.slug]));
	assert.equal(reminded.sent, 1);
	assert.equal(await m.Message.countDocuments({ accountId: user.accountId, email: "cycle@example.org", kind: CONFIRMATION_REMINDER_KIND }), 2);
});

serial("nothing is sent when the setting is missing, invalid, or sending is off, including a global suppression", async () => {
	const user = await customer("remind-off@example.com");
	await addPending(user, "off@example.org");
	await addPending(user, "global@example.org");
	await age(user, "off@example.org", { subscribedHours: 25 });
	await age(user, "global@example.org", { subscribedHours: 25 });
	await m.globalSuppressions.suppressGlobally({ emails: ["global@example.org"], reason: "bounce" });
	const before = sesEmails.length;
	assert.deepEqual(await run({}), { enabled: 0, sent: 0, skipped: 0, failed: 0, deferred: 0 });
	assert.deepEqual(await run({ CONFIRMATION_REMINDERS: "{" }), { enabled: 0, sent: 0, skipped: 0, failed: 0, deferred: 0 });
	assert.deepEqual(await run({ CONFIRMATION_REMINDERS: "{}" }), { enabled: 0, sent: 0, skipped: 0, failed: 0, deferred: 0 });
	const since = new Date(Date.now() - 30 * 24 * HOUR).toISOString();
	const off = await run({ CONFIRMATION_REMINDERS: JSON.stringify({ [user.slug]: since }), SENDING_ENABLED: "false" });
	assert.equal(off.inactive, "sending off");
	assert.equal(off.sent, 0);
	const blocked = await run(reminderEnv([user.slug]));
	assert.equal(blocked.sent, 1);
	assert.equal(remindersTo("off@example.org", before).length, 1);
	assert.equal(remindersTo("global@example.org", before).length, 0);
	assert.equal((await m.Contact.findOne({ accountId: user.accountId, email: "global@example.org" }).lean()).confirmationReminder.state, "skipped");
	assert.equal(await m.Message.countDocuments({ accountId: user.accountId, email: "off@example.org", kind: "confirmation" }), 1);
});
