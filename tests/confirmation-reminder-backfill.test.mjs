import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { verifyConfirmToken } from "../lib/confirmation.js";
import { CONFIRMATION_REMINDER_KIND } from "../lib/confirmation-reminder-rules.js";
import { activate, as, callApi, catchRedirect, form, signIn, startTestApp, withEnv } from "./helpers/app.mjs";
import { state as sesState, sent as sesEmails } from "./stubs/ses.mjs";

// The one-time pass for people already pending. It only counts unless it says exactly "send", and what it reaches is
// fixed when it is turned on. These tests share one database and the process environment, so they run one at a time.
let app;
let m;
let tail = Promise.resolve();

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
const DAY = 24 * HOUR;

async function customer(email) {
	const user = await signIn(email);
	await activate(user);
	user.slug = email.split("@")[0];
	const url = await as(user, () =>
		catchRedirect(m.newsletters.saveNewsletter(null, form({ name: `${user.slug} news`, slug: user.slug, postalAddress: "1 Main St, Paris" })))
	);
	user.newsletterId = url.split("/").at(-1);
	user.key = (await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })))).key;
	const saved = await callApi("PATCH", `/api/v1/newsletters/${user.slug}`, { key: user.key, body: { requireConfirmation: true } });
	assert.equal(saved.status, 200, JSON.stringify(saved.body));
	return user;
}

// A contact pending since daysOld, with a confirmation email that went out then unless told otherwise.
async function pending(user, email, { daysOld = 5, confirmation = "sent", confirmationDaysOld = daysOld } = {}) {
	const subscribedAt = new Date(Date.now() - daysOld * DAY);
	const contact = await m.Contact.create({ accountId: user.accountId, newsletterId: user.newsletterId, email, status: "pending", subscribedAt });
	if (confirmation) {
		const at = new Date(Date.now() - confirmationDaysOld * DAY);
		await m.Message.collection.insertOne({
			kind: "confirmation",
			accountId: contact.accountId,
			newsletterId: contact.newsletterId,
			contactId: contact._id,
			email,
			status: confirmation,
			createdAt: at,
			updatedAt: at,
			...(confirmation === "sent" && { sentAt: at }),
		});
	}
	return contact;
}

function rule(overrides = {}) {
	return {
		before: new Date(Date.now() - HOUR).toISOString(),
		maxAgeDays: 30,
		maxTotal: 100,
		perRun: 10,
		expiresAt: new Date(Date.now() + 7 * DAY).toISOString(),
		...overrides,
	};
}

function backfillRun(user, overrides, { now } = {}) {
	const env = { ...process.env, CONFIRMATION_REMINDER_BACKFILL: JSON.stringify({ [user.slug]: rule(overrides) }) };
	delete env.CONFIRMATION_REMINDERS;
	return m.reminders.queueConfirmationReminders({ env, ...(now && { now }) });
}

async function pass(user, overrides, options) {
	const result = await backfillRun(user, overrides, options);
	assert.equal(result.error, undefined, JSON.stringify(result));
	return result.backfill[user.slug];
}

function remindersTo(user, from = 0) {
	return sesEmails.slice(from).filter((message) => message.subject.startsWith("Reminder:") && message.subject.includes(user.slug));
}

function snapshot(user) {
	return Promise.all([
		m.Contact.collection.find({ accountId: user.accountId }).sort({ _id: 1 }).toArray(),
		m.Message.collection.find({ accountId: user.accountId }).sort({ _id: 1 }).toArray(),
	]).then((rows) => JSON.stringify(rows));
}

before(async () => {
	app = await startTestApp();
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		reminders: await import("../lib/confirmation-reminder.js"),
		globalSuppressions: await import("../lib/global-suppressions.js"),
		events: await import("../lib/email-events.js"),
		Contact: (await import("../models/Contact.js")).default,
		Message: (await import("../models/Message.js")).default,
		Suppression: (await import("../models/Suppression.js")).default,
	};
});

after(() => app?.stop());

serial("a dry run reports totals only, writes nothing and sends nothing, with sending on or off", async () => {
	const user = await customer("backfill-dry@example.com");
	await pending(user, "two-days@example.org", { daysOld: 2 });
	await pending(user, "five-days@example.org", { daysOld: 5 });
	await pending(user, "ten-days@example.org", { daysOld: 10 });
	await pending(user, "twenty-days@example.org", { daysOld: 20 });
	await pending(user, "ancient@example.org", { daysOld: 45 });
	await pending(user, "never-confirmed@example.org", { confirmation: null });
	await pending(user, "failed-confirmation@example.org", { confirmation: "failed" });
	await pending(user, "old-queue@example.org", { confirmation: "queued" });
	await pending(user, "resent@example.org", { daysOld: 8, confirmationDaysOld: 0.5 });
	await pending(user, "held@example.org");
	await m.Suppression.create({ accountId: user.accountId, email: "held@example.org", reason: "manual" });
	await pending(user, "listed@example.org");
	await m.globalSuppressions.suppressGlobally({ emails: ["listed@example.org"], reason: "bounce" });
	const reminded = await pending(user, "reminded@example.org");
	await m.Message.create({ kind: CONFIRMATION_REMINDER_KIND, accountId: user.accountId, newsletterId: user.newsletterId, contactId: reminded._id, email: "reminded@example.org", cycleAt: reminded.subscribedAt, status: "sent", sentAt: new Date() });
	await m.Contact.create({ accountId: user.accountId, newsletterId: user.newsletterId, email: "new-signup@example.org", status: "pending", subscribedAt: new Date() });
	await m.Contact.create({ accountId: user.accountId, newsletterId: user.newsletterId, email: "reader@example.org", status: "active", subscribedAt: new Date(Date.now() - 5 * DAY) });
	await m.Contact.create({ accountId: user.accountId, newsletterId: user.newsletterId, email: "left@example.org", status: "unsubscribed", subscribedAt: new Date(Date.now() - 5 * DAY) });

	const expected = {
		mode: "dry-run",
		eligible: 4,
		ageBuckets: { "1-3d": 1, "4-7d": 1, "8-14d": 1, "15-30d": 1, "31d+": 0 },
		excluded: { tooOld: 1, tooRecent: 1, noConfirmationSent: 3, accountSuppressed: 1, neverEmail: 1, alreadyReminded: 1 },
	};
	const emails = sesEmails.length;
	const stored = await snapshot(user);

	const on = await pass(user, { mode: "dry-run" });
	assert.deepEqual(on, expected);
	const off = await withEnv({ SENDING_ENABLED: "false" }, () => backfillRun(user, { mode: "dry-run" }));
	assert.deepEqual(off.backfill[user.slug], expected);
	assert.deepEqual([off.sent, off.enabled], [0, 0]);

	assert.equal(await snapshot(user), stored, "no claim, no message, no field touched");
	assert.equal(sesEmails.length, emails);
	assert.equal(JSON.stringify(off).includes("@"), false, "no addresses");
});

serial("anything but exactly send is a dry run", async () => {
	const user = await customer("backfill-modes@example.com");
	await pending(user, "m@example.org");
	const emails = sesEmails.length;
	for (const mode of [undefined, "dry-run", "SEND", "send ", "true", true, 1]) {
		const result = await pass(user, { mode });
		assert.deepEqual([result.mode, result.eligible], ["dry-run", 1], String(mode));
	}
	assert.equal(sesEmails.length, emails);
	assert.equal(await m.Message.countDocuments({ accountId: user.accountId, kind: CONFIRMATION_REMINDER_KIND }), 0);
});

serial("with both settings unset, nothing is read", async () => {
	const find = m.Contact.find;
	m.Contact.find = () => {
		throw new Error("should not read contacts");
	};
	try {
		const env = { ...process.env };
		delete env.CONFIRMATION_REMINDERS;
		delete env.CONFIRMATION_REMINDER_BACKFILL;
		const result = await m.reminders.queueConfirmationReminders({ env });
		assert.deepEqual(result, { enabled: 0, sent: 0, skipped: 0, failed: 0, deferred: 0, alreadySent: 0, noConfirmationSent: 0 });
	} finally {
		m.Contact.find = find;
	}
});

serial("send goes newest first, a few per run, with a fresh link, once per person", async () => {
	const user = await customer("backfill-send@example.com");
	for (const days of [2, 3, 4, 5, 6]) await pending(user, `d${days}@example.org`, { daysOld: days });
	const start = sesEmails.length;
	const overrides = { mode: "send", perRun: 2, maxTotal: 5 };

	const first = await pass(user, overrides);
	assert.deepEqual([first.state, first.sent, first.eligible, first.sentSoFar], ["running", 2, 5, 0], JSON.stringify(first));
	assert.deepEqual(remindersTo(user, start).map(({ to }) => to), ["d2@example.org", "d3@example.org"]);
	const email = remindersTo(user, start)[0];
	const token = email.html.match(/\/confirm\?token=([^"&]+)/)[1];
	assert.ok(verifyConfirmToken(token));
	const stamped = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());
	assert.ok(Math.abs(stamped.t * 1000 - Date.now()) < 60_000, "a new link, whatever the signup's age");

	const second = await pass(user, overrides);
	assert.deepEqual([second.sent, second.eligible, second.sentSoFar], [2, 3, 2], JSON.stringify(second));
	const third = await pass(user, overrides);
	assert.deepEqual([third.sent, third.eligible, third.sentSoFar], [1, 1, 4], JSON.stringify(third));

	const emails = sesEmails.length;
	const done = await pass(user, overrides);
	assert.deepEqual([done.state, done.reason], ["complete", "maxTotal reached"], "the total is used up, for good");
	assert.equal(sesEmails.length, emails);
	assert.equal(new Set(remindersTo(user, start).map(({ to }) => to)).size, 5);
	assert.equal(remindersTo(user, start).length, 5, "nobody got two");
	assert.equal(await m.Message.countDocuments({ accountId: user.accountId, kind: CONFIRMATION_REMINDER_KIND }), 5);
});

serial("the group can't grow: new signups stay out, and a line still in the future refuses", async () => {
	const user = await customer("backfill-fixed@example.com");
	await pending(user, "in-group@example.org", { daysOld: 3 });
	const line = new Date(Date.now() - DAY).toISOString();
	const newcomer = await pending(user, "newcomer@example.org", { daysOld: 0.5, confirmationDaysOld: 0.5 });
	const start = sesEmails.length;

	const refused = await pass(user, { mode: "send", before: new Date(Date.now() + DAY).toISOString() });
	assert.deepEqual([refused.state, refused.sent], ["refused", undefined]);
	assert.match(refused.reason, /grow/);
	assert.equal(remindersTo(user, start).length, 0);

	const result = await pass(user, { mode: "send", before: line });
	assert.equal(result.sent, 1, JSON.stringify(result));
	assert.deepEqual(remindersTo(user, start).map(({ to }) => to), ["in-group@example.org"]);
	assert.equal((await m.Contact.findOne({ _id: newcomer._id, accountId: user.accountId }).lean()).confirmationReminder, undefined);

	const later = await pass(user, { mode: "send", before: line }, { now: new Date(Date.now() + 5 * DAY) });
	assert.equal(later.sent ?? 0, 0, "days later the newcomer is still after the line");
	assert.equal(remindersTo(user, start).length, 1);
});

serial("it refuses when more are eligible than the total allows, and without an end date or a total", async () => {
	const user = await customer("backfill-refuse@example.com");
	for (const index of [1, 2, 3]) await pending(user, `r${index}@example.org`);
	const start = sesEmails.length;

	const over = await pass(user, { mode: "send", maxTotal: 2 });
	assert.deepEqual([over.state, over.reason, over.eligible], ["refused", "more eligible than maxTotal", 3]);
	const noTotal = await pass(user, { mode: "send", maxTotal: 0 });
	assert.equal(noTotal.state, "refused");
	const noEnd = await pass(user, { mode: "send", expiresAt: undefined });
	assert.equal(noEnd.state, "refused");

	assert.equal(remindersTo(user, start).length, 0);
	assert.equal(await m.Message.countDocuments({ accountId: user.accountId, kind: CONFIRMATION_REMINDER_KIND }), 0);
	assert.equal(await m.Contact.countDocuments({ accountId: user.accountId, confirmationReminder: { $exists: true } }), 0);
});

serial("it stops for good once expired, and with sending off it sends nothing", async () => {
	const user = await customer("backfill-expired@example.com");
	await pending(user, "e@example.org");
	const start = sesEmails.length;
	const expired = await pass(user, { mode: "send", expiresAt: new Date(Date.now() - 1000).toISOString() });
	assert.deepEqual([expired.state, expired.reason], ["complete", "expired"]);
	const off = await withEnv({ SENDING_ENABLED: "false" }, () => backfillRun(user, { mode: "send" }));
	assert.deepEqual([off.backfill[user.slug].state, off.backfill[user.slug].reason], ["inactive", "sending off"]);
	assert.equal(remindersTo(user, start).length, 0);
	assert.equal(await m.Message.countDocuments({ accountId: user.accountId, kind: CONFIRMATION_REMINDER_KIND }), 0);
});

serial("suppressed, never-email and unconfirmed-email contacts are left out, also when sending", async () => {
	const user = await customer("backfill-out@example.com");
	await pending(user, "ok@example.org");
	await pending(user, "held-send@example.org");
	await m.Suppression.create({ accountId: user.accountId, email: "held-send@example.org", reason: "complaint" });
	await pending(user, "listed-send@example.org");
	await m.globalSuppressions.suppressGlobally({ emails: ["listed-send@example.org"], reason: "bounce" });
	await pending(user, "unsent-send@example.org", { confirmation: "failed" });
	const start = sesEmails.length;
	const result = await pass(user, { mode: "send" });
	assert.equal(result.sent, 1, JSON.stringify(result));
	assert.deepEqual(remindersTo(user, start).map(({ to }) => to), ["ok@example.org"]);
	assert.deepEqual([result.excluded.accountSuppressed, result.excluded.neverEmail, result.excluded.noConfirmationSent], [1, 1, 1]);
});

serial("a complaint or too many bounces halt the pass for good", async () => {
	for (const [slug, reason, fields] of [
		["backfill-complaint", "complaint", [{ type: "complaint" }]],
		[
			"backfill-bounces",
			"bounces",
			[
				{ type: "bounce", bounce: "hard", reason: "no such mailbox" },
				{ type: "bounce", bounce: "hard", reason: "no such mailbox" },
				{ type: "bounce", bounce: "hard", reason: "no such mailbox" },
			],
		],
	]) {
		const user = await customer(`${slug}@example.com`);
		for (const index of [1, 2, 3, 4, 5]) await pending(user, `h${index}@example.org`, { daysOld: index + 1 });
		const overrides = { mode: "send", perRun: 3 };
		assert.equal((await pass(user, overrides)).sent, 3);
		const sent = await m.Message.find({ accountId: user.accountId, kind: CONFIRMATION_REMINDER_KIND }).lean();
		for (const [index, event] of fields.entries()) {
			const message = sent[index];
			await m.events.handleEmailEvent({ accountId: String(user.accountId), messageId: String(message._id), email: message.email, emails: [message.email], ...event });
		}
		const start = sesEmails.length;
		const halted = await pass(user, overrides);
		assert.deepEqual([halted.state, halted.reason], ["halted", reason], JSON.stringify(halted));
		assert.equal(sesEmails.length, start);
	}
});

serial("a throttle stops the pass, and what the new-signup path stopped on stops it too", async () => {
	const user = await customer("backfill-throttle@example.com");
	for (const index of [1, 2, 3]) await pending(user, `t${index}@example.org`, { daysOld: index + 1 });
	sesState.failNext = { name: "sendSesEmail", times: 20, error: Object.assign(new Error("slow down"), { name: "ThrottlingException" }) };
	let result;
	try {
		result = await pass(user, { mode: "send" });
		assert.equal(sesState.failNext.times, 19, "one provider call");
	} finally {
		sesState.failNext = null;
	}
	assert.deepEqual([result.sent, result.deferred, result.stopped], [0, 1, "throttled"], JSON.stringify(result));

	const other = await customer("backfill-after@example.com");
	await pending(other, "waits@example.org");
	const recent = await m.Contact.create({ accountId: other.accountId, newsletterId: other.newsletterId, email: "recent@example.org", status: "pending", subscribedAt: new Date(Date.now() - 25 * HOUR) });
	await m.Message.collection.insertOne({ kind: "confirmation", accountId: other.accountId, newsletterId: other.newsletterId, contactId: recent._id, email: "recent@example.org", status: "sent", sentAt: new Date(Date.now() - 25 * HOUR), createdAt: new Date(Date.now() - 25 * HOUR) });
	const env = {
		...process.env,
		CONFIRMATION_REMINDERS: JSON.stringify({ [other.slug]: new Date(Date.now() - 2 * DAY).toISOString() }),
		CONFIRMATION_REMINDER_BACKFILL: JSON.stringify({ [other.slug]: rule({ mode: "send", before: new Date(Date.now() - 2 * DAY).toISOString() }) }),
	};
	sesState.failNext = { name: "sendSesEmail", times: 20, error: Object.assign(new Error("slow down"), { name: "ThrottlingException" }) };
	let both;
	try {
		both = await m.reminders.queueConfirmationReminders({ env });
		assert.equal(sesState.failNext.times, 19, "the backfill didn't try after the throttle");
	} finally {
		sesState.failNext = null;
	}
	assert.equal(both.stopped, "throttled");
	assert.deepEqual(both.backfill[other.slug], { mode: "send", state: "waiting", reason: "throttled" });
});

serial("someone who unsubscribes, or confirms, between runs is not reminded", async () => {
	const user = await customer("backfill-left@example.com");
	const stays = await pending(user, "stays@example.org", { daysOld: 5 });
	const leaves = await pending(user, "leaves@example.org", { daysOld: 4 });
	const confirms = await pending(user, "confirms@example.org", { daysOld: 3 });
	await m.Contact.updateOne({ accountId: user.accountId, _id: leaves._id }, { $set: { status: "unsubscribed" } });
	await m.Contact.updateOne({ accountId: user.accountId, _id: confirms._id }, { $set: { status: "active" } });
	const start = sesEmails.length;
	const result = await pass(user, { mode: "send" });
	assert.equal(result.sent, 1, JSON.stringify(result));
	assert.deepEqual(remindersTo(user, start).map(({ to }) => to), ["stays@example.org"]);
	assert.equal(String((await m.Message.findOne({ accountId: user.accountId, kind: CONFIRMATION_REMINDER_KIND }).lean()).contactId), String(stays._id));
});

serial("a newsletter that doesn't ask to confirm is ignored, and another account's contacts are never touched", async () => {
	const user = await customer("backfill-plain@example.com");
	const saved = await callApi("PATCH", `/api/v1/newsletters/${user.slug}`, { key: user.key, body: { requireConfirmation: false } });
	assert.equal(saved.status, 200);
	await pending(user, "plain@example.org");
	const result = await backfillRun(user, { mode: "send" });
	assert.deepEqual(result.backfill, {});

	const other = await customer("backfill-neighbor@example.com");
	await pending(other, "neighbor@example.org");
	const target = await customer("backfill-target@example.com");
	await pending(target, "target@example.org");
	const start = sesEmails.length;
	await pass(target, { mode: "send" });
	assert.deepEqual(sesEmails.slice(start).map(({ to }) => to), ["target@example.org"]);
	assert.equal(await m.Message.countDocuments({ accountId: other.accountId, kind: CONFIRMATION_REMINDER_KIND }), 0);
});
