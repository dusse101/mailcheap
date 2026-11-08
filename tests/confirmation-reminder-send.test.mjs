import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createUnsubscribeToken } from "../lib/unsubscribe.js";
import { verifyConfirmToken } from "../lib/confirmation.js";
import { CONFIRMATION_REMINDER_KIND } from "../lib/confirmation-reminder-rules.js";
import { activate, as, callApi, catchRedirect, form, signIn, startTestApp, withEnv } from "./helpers/app.mjs";
import { flushAfter } from "./stubs/next-server.mjs";
import { published as qstashJobs } from "./stubs/qstash.mjs";
import { state as sesState, sent as sesEmails } from "./stubs/ses.mjs";

// The daily route's one reminder. Signups still send the confirmation email themselves; this never sends the
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
const IDLE = { enabled: 0, sent: 0, skipped: 0, failed: 0, deferred: 0, alreadySent: 0, noConfirmationSent: 0 };

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

function failing(error, times = 20) {
	sesState.failNext = { name: "sendSesEmail", times, error };
	return () => {
		const left = sesState.failNext?.times ?? 0;
		sesState.failNext = null;
		return times - left;
	};
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
		sending: await import("../lib/sending.js"),
		events: await import("../lib/email-events.js"),
		unsubscribeRoute: await import("../app/api/unsubscribe/route.js"),
		reminderRoute: await import("../app/api/cron/confirmation-reminders/route.js"),
		hourlyRoute: await import("../app/api/cron/hourly/route.js"),
		Domain: (await import("../models/Domain.js")).default,
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
	const updateOne = m.Message.updateOne;
	m.Message.updateOne = function (filter, update, ...rest) {
		if (update?.$set?.status !== "sent") return updateOne.call(this, filter, update, ...rest);
		m.Message.updateOne = updateOne;
		return m.Contact.updateOne(
			{ accountId: user.accountId, _id: contact._id, status: "pending" },
			{ $set: { status: "active", confirmedAt: new Date() } }
		).then(() => updateOne.call(this, filter, update, ...rest));
	};
	try {
		const result = await run(reminderEnv([user.slug]));
		assert.equal(result.sent, 0, JSON.stringify(result));
	} finally {
		m.Message.updateOne = updateOne;
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
	// Unreachable for a new signup, but a backfill retried long after its first try could get here.
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
	assert.deepEqual(await run({}), IDLE);
	assert.deepEqual(await run({ CONFIRMATION_REMINDERS: "{" }), IDLE);
	assert.deepEqual(await run({ CONFIRMATION_REMINDERS: "{}" }), IDLE);
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

serial("someone who unsubscribed while pending gets no reminder, whichever way they did it", async () => {
	const user = await customer("remind-optout@example.com");
	const page = await addPending(user, "out-page@example.org");
	const oneClick = await addPending(user, "out-oneclick@example.org");
	await addPending(user, "out-provider@example.org");
	await addPending(user, "still-in@example.org");
	const post = (contact, body) => {
		const token = createUnsubscribeToken({ contactId: contact._id, newsletterId: user.newsletterId });
		return m.unsubscribeRoute.POST(new Request(`http://localhost:3000/api/unsubscribe?token=${token}`, { method: "POST", ...(body && { body }) }));
	};
	assert.equal((await post(page, new URLSearchParams({ source: "page" }))).status, 303);
	assert.equal((await post(oneClick)).status, 200);
	const providerMessage = await m.Message.findOne({ accountId: user.accountId, email: "out-provider@example.org", kind: "confirmation" }).lean();
	await m.events.handleEmailEvent({
		type: "unsubscribe",
		accountId: String(user.accountId),
		messageId: String(providerMessage._id),
		email: providerMessage.email,
		emails: [providerMessage.email],
	});
	const opted = ["out-page@example.org", "out-oneclick@example.org", "out-provider@example.org"];
	for (const email of [...opted, "still-in@example.org"]) await age(user, email, { subscribedHours: 25 });
	const before = sesEmails.length;
	const result = await run(reminderEnv([user.slug]));
	assert.equal(result.sent, 1, "the one who stayed");
	for (const email of opted) {
		assert.equal(remindersTo(email, before).length, 0, email);
		assert.equal((await m.Contact.findOne({ accountId: user.accountId, email }).lean()).status, "unsubscribed");
	}
	assert.equal(await m.Message.countDocuments({ accountId: user.accountId, email: { $in: opted }, kind: CONFIRMATION_REMINDER_KIND }), 0);
});

serial("a bounce or complaint on the confirmation stops the reminder", async () => {
	const user = await customer("remind-events@example.com");
	for (const [email, fields] of [
		["hard@example.org", { type: "bounce", bounce: "hard", reason: "no such mailbox" }],
		["spam@example.org", { type: "complaint" }],
	]) {
		await addPending(user, email);
		const message = await m.Message.findOne({ accountId: user.accountId, email, kind: "confirmation" }).lean();
		await m.events.handleEmailEvent({ accountId: String(user.accountId), messageId: String(message._id), email, emails: [email], ...fields });
		await age(user, email, { subscribedHours: 25 });
	}
	const before = sesEmails.length;
	const result = await run(reminderEnv([user.slug]));
	assert.equal(result.sent, 0, JSON.stringify(result));
	assert.equal(sesEmails.length, before);
});

serial("a reminder is never the first email: no confirmation that went out, no reminder", async () => {
	const user = await customer("remind-never@example.com");
	const make = (email, overrides = {}) =>
		m.Contact.create({ accountId: user.accountId, newsletterId: user.newsletterId, email, status: "pending", subscribedAt: new Date(Date.now() - 25 * HOUR), ...overrides });
	await make("no-message@example.org");
	for (const [email, status] of [
		["failed-one@example.org", "failed"],
		["dropped-one@example.org", "suppressed"],
		["capped-one@example.org", "skipped"],
		["stale-queue@example.org", "queued"],
	]) {
		const contact = await make(email);
		await m.Message.create({ kind: "confirmation", accountId: user.accountId, newsletterId: user.newsletterId, contactId: contact._id, email, status });
		await m.Message.collection.updateMany({ contactId: contact._id }, { $set: { createdAt: new Date(Date.now() - 25 * HOUR) } });
	}
	const young = await make("young-queue@example.org");
	await m.Message.create({ kind: "confirmation", accountId: user.accountId, newsletterId: user.newsletterId, contactId: young._id, email: "young-queue@example.org", status: "queued" });
	const before = sesEmails.length;
	const result = await run(reminderEnv([user.slug]));
	assert.equal(result.sent, 0, JSON.stringify(result));
	assert.equal(result.noConfirmationSent, 5, "the young queued one is only waiting");
	assert.equal(sesEmails.length, before);
	assert.equal(await m.Message.countDocuments({ accountId: user.accountId, kind: CONFIRMATION_REMINDER_KIND }), 0);
	assert.equal(await m.Contact.countDocuments({ accountId: user.accountId, confirmationReminder: { $exists: true } }), 0, "nothing was claimed");
});

serial("the first throttle stops the run, and the reminder goes out on a later one", async () => {
	const user = await customer("remind-throttle@example.com");
	const emails = ["t1@example.org", "t2@example.org", "t3@example.org"];
	for (const email of emails) {
		await addPending(user, email);
		await age(user, email, { subscribedHours: 25 });
	}
	const before = sesEmails.length;
	const jobs = qstashJobs.length;
	const tried = failing(Object.assign(new Error("slow down"), { name: "ThrottlingException" }));
	let result;
	try {
		result = await run(reminderEnv([user.slug]));
	} finally {
		assert.equal(tried(), 1, "one provider call, not one per contact");
	}
	assert.deepEqual([result.sent, result.failed, result.deferred, result.stopped], [0, 0, 1, "throttled"], JSON.stringify(result));
	assert.equal(qstashJobs.length, jobs + 1, "one retry job, not one per contact");
	const queued = await m.Message.findOne({ accountId: user.accountId, kind: CONFIRMATION_REMINDER_KIND }).lean();
	assert.equal(queued.status, "queued");
	assert.equal(queued.attempts, undefined, "a throttle is not a failed send");

	const later = await run(reminderEnv([user.slug]), new Date(Date.now() + 16 * 60 * 1000));
	assert.equal(later.sent, 3, JSON.stringify(later));
	for (const email of emails) assert.equal(remindersTo(email, before).length, 1, email);
});

serial("three failures in a row stop the run", async () => {
	const user = await customer("remind-outage@example.com");
	for (const index of [1, 2, 3, 4, 5]) {
		await addPending(user, `o${index}@example.org`);
		await age(user, `o${index}@example.org`, { subscribedHours: 25 });
	}
	const tried = failing(Object.assign(new Error("mailbox down"), { name: "InternalFailure" }));
	let result;
	try {
		result = await run(reminderEnv([user.slug]));
	} finally {
		assert.equal(tried(), 3);
	}
	assert.deepEqual([result.sent, result.failed, result.stopped], [0, 3, "failures"], JSON.stringify(result));
	assert.equal(await m.Message.countDocuments({ accountId: user.accountId, kind: CONFIRMATION_REMINDER_KIND }), 3);
});

serial("a reminder that keeps failing is skipped after three tries", async () => {
	const user = await customer("remind-cap@example.com");
	await addPending(user, "cap@example.org");
	await age(user, "cap@example.org", { subscribedHours: 25 });
	const contactOf = () => m.Contact.findOne({ accountId: user.accountId, email: "cap@example.org" }).lean();
	const messageOf = async () => m.Message.findOne({ accountId: user.accountId, email: "cap@example.org", kind: CONFIRMATION_REMINDER_KIND }).lean();
	const error = Object.assign(new Error("mailbox down"), { name: "InternalFailure" });
	for (const attempt of [1, 2, 3]) {
		const tried = failing(error);
		const result = await run(reminderEnv([user.slug]));
		assert.equal(tried(), 1, `try ${attempt}`);
		assert.equal(result.failed, 1, JSON.stringify(result));
		assert.equal((await messageOf()).attempts, attempt);
	}
	const given = await messageOf();
	assert.equal(given.status, "skipped");
	assert.match(given.error, /Gave up after 3/);
	assert.equal((await contactOf()).confirmationReminder.state, "skipped");
	const before = sesEmails.length;
	const after = await run(reminderEnv([user.slug]));
	assert.deepEqual([after.sent, after.failed], [0, 0], "and that's the end of it, even with the provider back");
	assert.equal(sesEmails.length, before);
});

serial("a reminder already sent is counted as that, not as a new send", async () => {
	const user = await customer("remind-honest@example.com");
	await addPending(user, "honest@example.org");
	await age(user, "honest@example.org", { subscribedHours: 25 });
	assert.equal((await run(reminderEnv([user.slug]))).sent, 1);
	const contact = await m.Contact.findOne({ accountId: user.accountId, email: "honest@example.org" }).lean();
	await m.Contact.collection.updateOne({ _id: contact._id }, { $set: { "confirmationReminder.state": "retry" } });
	const before = sesEmails.length;
	const again = await run(reminderEnv([user.slug]));
	assert.deepEqual([again.sent, again.alreadySent], [0, 1], JSON.stringify(again));
	assert.equal(sesEmails.length, before);
});

// The check after the claim reads Contact.exists({ status: "pending" }) and nothing else on this path does.
function breakPendingCheck() {
	const exists = m.Contact.exists;
	let thrown = 0;
	m.Contact.exists = function (filter, ...rest) {
		if (filter?.status === "pending" && filter?._id && !thrown) {
			thrown++;
			m.Contact.exists = exists;
			return Promise.reject(Object.assign(new Error("connection reset"), { name: "MongoNetworkError" }));
		}
		return exists.call(this, filter, ...rest);
	};
	return () => {
		m.Contact.exists = exists;
		return thrown;
	};
}

serial("a database error in the check before sending puts a confirmation back in the queue", async () => {
	const user = await customer("remind-check-confirm@example.com");
	const before = sesEmails.length;
	const jobs = qstashJobs.length;
	const restore = breakPendingCheck();
	try {
		const response = await signUp(user, "check-confirm@example.org");
		assert.equal(response.status, 201, JSON.stringify(response.body));
		await flushAfter();
	} finally {
		assert.equal(restore(), 1, "the check ran and failed");
	}
	const queued = await m.Message.findOne({ accountId: user.accountId, email: "check-confirm@example.org", kind: "confirmation" }).lean();
	assert.equal(queued.status, "queued", "not lost as sent");
	assert.equal(queued.sentAt, undefined);
	assert.equal(sesEmails.length, before);
	assert.equal(qstashJobs.length, jobs + 1, "and QStash brings it back");

	const retried = await m.sending.sendMessageBatch({ accountId: String(user.accountId), messageIds: [String(queued._id)] });
	assert.equal(retried.sent, 1);
	assert.equal(sesEmails.slice(before).filter((message) => message.to === "check-confirm@example.org").length, 1);
});

serial("a database error in the check before sending keeps a reminder, and it goes out on a later run", async () => {
	const user = await customer("remind-check-reminder@example.com");
	await addPending(user, "check-reminder@example.org");
	await age(user, "check-reminder@example.org", { subscribedHours: 25 });
	const before = sesEmails.length;
	const restore = breakPendingCheck();
	let result;
	try {
		result = await run(reminderEnv([user.slug]));
	} finally {
		assert.equal(restore(), 1);
	}
	assert.deepEqual([result.sent, result.deferred, result.stopped], [0, 1, "throttled"], JSON.stringify(result));
	const queued = await m.Message.findOne({ accountId: user.accountId, kind: CONFIRMATION_REMINDER_KIND }).lean();
	assert.equal(queued.status, "queued");
	assert.equal(queued.sentAt, undefined);
	assert.equal(remindersTo("check-reminder@example.org", before).length, 0);

	const later = await run(reminderEnv([user.slug]), new Date(Date.now() + 16 * 60 * 1000));
	assert.equal(later.sent, 1, JSON.stringify(later));
	assert.equal(remindersTo("check-reminder@example.org", before).length, 1);
	assert.equal(await m.Message.countDocuments({ accountId: user.accountId, kind: CONFIRMATION_REMINDER_KIND }), 1);
});

serial("out of time, a run stops before sending and the next one picks it up", async () => {
	const user = await customer("remind-budget@example.com");
	await addPending(user, "budget@example.org");
	await age(user, "budget@example.org", { subscribedHours: 25 });
	const before = sesEmails.length;
	const env = { ...process.env, ...reminderEnv([user.slug]) };
	const result = await m.reminders.queueConfirmationReminders({ env, budgetMs: 0 });
	assert.equal(result.sent, 0);
	assert.equal(result.stopped, "time budget");
	await new Promise((resolve) => setTimeout(resolve, 300));
	assert.equal(remindersTo("budget@example.org", before).length, 0, "the work left behind stops too");
	assert.equal((await run(reminderEnv([user.slug]))).sent, 1);
});

const CRON_SECRET = "test-cron-secret-0123456789abcdef";
const cronRequest = (path, authorization = `Bearer ${CRON_SECRET}`) =>
	new Request(`http://localhost:3000${path}`, { headers: authorization ? { authorization } : {} });
const REMINDER_PATH = "/api/cron/confirmation-reminders";

// withEnv would set the text "undefined": these have to be really unset.
async function withoutEnv(names, run) {
	const previous = names.map((name) => [name, process.env[name]]);
	for (const name of names) delete process.env[name];
	try {
		return await run();
	} finally {
		for (const [name, value] of previous) if (value !== undefined) process.env[name] = value;
	}
}

serial("the daily route takes CRON_SECRET only: 503 without one set, 401 without it", async () => {
	const unset = await withoutEnv(["CRON_SECRET"], () => m.reminderRoute.GET(cronRequest(REMINDER_PATH)));
	assert.equal(unset.status, 503);
	await withEnv({ CRON_SECRET }, async () => {
		assert.equal((await m.reminderRoute.GET(cronRequest(REMINDER_PATH, null))).status, 401);
		assert.equal((await m.reminderRoute.GET(cronRequest(REMINDER_PATH, "Bearer not-the-secret"))).status, 401);
		assert.equal((await m.reminderRoute.GET(cronRequest(REMINDER_PATH))).status, 200);
	});
});

serial("the daily route sends nothing with CONFIRMATION_REMINDERS unset, even for a contact who is due", async () => {
	const user = await customer("remind-route-unset@example.com");
	await addPending(user, "route-unset@example.org");
	await age(user, "route-unset@example.org", { subscribedHours: 25 });
	const before = sesEmails.length;
	const queued = qstashJobs.length;
	const response = await withoutEnv(["CONFIRMATION_REMINDERS", "CONFIRMATION_REMINDER_BACKFILL"], () =>
		withEnv({ CRON_SECRET }, () => m.reminderRoute.GET(cronRequest(REMINDER_PATH)))
	);
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { confirmationReminders: IDLE });
	assert.equal(sesEmails.length, before);
	assert.equal(qstashJobs.length, queued);
	const contact = await m.Contact.findOne({ accountId: user.accountId, email: "route-unset@example.org" }).lean();
	assert.equal(contact.confirmationReminder, undefined);
});

serial("the daily route sends a due reminder once when it's on, and the next day's run doesn't repeat it", async () => {
	const user = await customer("remind-route-on@example.com");
	await addPending(user, "route-on@example.org");
	await age(user, "route-on@example.org", { subscribedHours: 25 });
	const before = sesEmails.length;
	await withEnv({ CRON_SECRET, ...reminderEnv([user.slug]) }, async () => {
		const first = await (await m.reminderRoute.GET(cronRequest(REMINDER_PATH))).json();
		assert.equal(first.confirmationReminders.sent, 1, JSON.stringify(first));
		const second = await (await m.reminderRoute.GET(cronRequest(REMINDER_PATH))).json();
		assert.equal(second.confirmationReminders.sent, 0, JSON.stringify(second));
	});
	assert.equal(remindersTo("route-on@example.org", before).length, 1);
});

serial("a reminder error is reported, not thrown, by the daily route", async () => {
	const user = await customer("remind-isolated@example.com");
	const find = m.Newsletter.find;
	m.Newsletter.find = () => {
		throw Object.assign(new Error("database gone"), { name: "MongoServerError" });
	};
	try {
		const direct = await run(reminderEnv([user.slug]));
		assert.equal(direct.error, "MongoServerError");
		const response = await withEnv({ CRON_SECRET, ...reminderEnv([user.slug]) }, () => m.reminderRoute.GET(cronRequest(REMINDER_PATH)));
		assert.equal(response.status, 200);
		assert.equal((await response.json()).confirmationReminders.error, "MongoServerError");
	} finally {
		m.Newsletter.find = find;
	}
});

serial("the daily route leaves the hourly cron's work alone, and the hourly cron leaves the reminders alone", async () => {
	const user = await customer("remind-route-apart@example.com");
	await addPending(user, "route-apart@example.org");
	await age(user, "route-apart@example.org", { subscribedHours: 25 });
	const { insertedId } = await m.Domain.collection.insertOne({
		accountId: user.accountId,
		domain: "route-apart.example.com",
		verified: true,
		provider: "ses",
	});
	const checkedAt = async () => (await m.Domain.collection.findOne({ _id: insertedId })).dns?.checkedAt;
	const before = sesEmails.length;
	try {
		await withEnv({ CRON_SECRET, ...reminderEnv([user.slug]) }, async () => {
			const hourly = await (await m.hourlyRoute.GET(cronRequest("/api/cron/hourly"))).json();
			assert.equal("confirmationReminders" in hourly, false);
			assert.equal(remindersTo("route-apart@example.org", before).length, 0, "the hourly cron sends no reminders");
			assert.ok(await checkedAt(), "the hourly cron does check a due domain");

			await m.Domain.collection.updateOne({ _id: insertedId }, { $unset: { dns: "" } });
			const daily = await (await m.reminderRoute.GET(cronRequest(REMINDER_PATH))).json();
			assert.deepEqual(Object.keys(daily), ["confirmationReminders"]);
			assert.equal(daily.confirmationReminders.sent, 1, JSON.stringify(daily));
			assert.equal(await checkedAt(), undefined, "the daily route doesn't check domains");
		});
	} finally {
		await m.Domain.collection.deleteOne({ _id: insertedId });
	}
});

serial("the brand's reminder goes out with its copy", async () => {
	const user = await customer("remind-brand@example.com");
	await addPending(user, "branded@example.org");
	await age(user, "branded@example.org", { subscribedHours: 25 });
	const before = sesEmails.length;
	const result = await withEnv({ EMAIL_BRAND: "tacoandtell" }, () => run(reminderEnv([user.slug])));
	assert.equal(result.sent, 1, JSON.stringify(result));
	const [email] = sesEmails.slice(before);
	assert.equal(email.subject, "Your Taco & Tell signup is still on the porch");
	assert.match(email.text, /So close\./);
	assert.match(email.text, /signup isn’t confirmed yet\. Tap the button below to open your confirmation page, then tap “Yes, subscribe me” in your browser\./);
	assert.match(email.text, /Open my confirmation page \(https:\/\/[^)\s]+\/confirm\?token=/);
	assert.match(email.text, /red light on 380/);
	assert.match(email.text, /Didn’t sign up\? Ignore this\. You stay off the list, and this is the last nudge you’ll get from us\./);
	assert.match(email.html, />Open my confirmation page</);
	assert.equal(/one button short/i.test(`${email.text}\n${email.html}`), false);
	assert.equal(/Confirm my subscription/.test(`${email.text}\n${email.html}`), false);
	assert.match(email.html, /You&#39;re not on the list until you confirm\. This is the only reminder\.|You're not on the list until you confirm\. This is the only reminder\./);
	assert.ok(verifyConfirmToken(tokenOf(email)));
});
