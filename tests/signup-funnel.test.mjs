import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createConfirmToken } from "../lib/confirmation.js";
import { activate, anonymous, as, callApi, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";
import { flushAfter } from "./stubs/next-server.mjs";

// Fork: the signup funnel tacoandtell.com's daily report reads. Opening the confirm page notes confirmOpenedAt once and
// still confirms nobody; the site's form passes the page it's on as signupPath; GET /api/signup-funnel counts each step
// per day and lists who is still pending, for a read or full access key only.
let app;
let m;
let user;
let keys;

async function createKey(level) {
	return (await as(user, () => m.apiKeys.createApiKey(null, form({ name: `${level} funnel key`, level })))).key;
}

async function createNewsletter(owner, slug) {
	const url = await as(owner, () =>
		catchRedirect(
			m.newsletters.saveNewsletter(
				null,
				form({ name: `${slug} news`, slug, fromEmail: `hello@${slug}.mailcheapmail.com`, postalAddress: "1 Main St, Paris", requireConfirmation: "on" })
			)
		)
	);
	return url.split("/").at(-1);
}

before(async () => {
	app = await startTestApp();
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		confirm: await import("../app/confirm/actions.js"),
		confirmRoute: await import("../app/api/confirm/route.js"),
		confirmPage: await import("../app/confirm/page.js"),
		funnelRoute: await import("../app/api/signup-funnel/route.js"),
		funnel: await import("../lib/signup-funnel.js"),
		proxy: (await import("../proxy.js")).proxy,
		NextRequest: (await import("next/server")).NextRequest,
		Contact: (await import("../models/Contact.js")).default,
		Message: (await import("../models/Message.js")).default,
		Newsletter: (await import("../models/Newsletter.js")).default,
	};
	user = await signIn("funnel-owner@example.com");
	await activate(user);
	user.newsletterId = await createNewsletter(user, "funnel-notes");
	keys = { full: await createKey("full"), signups: await createKey("signups"), read: await createKey("read") };
});

after(() => app?.stop());

function load(contact) {
	return m.Contact.findOne({ accountId: user.accountId, _id: contact._id ?? contact.id }).lean();
}

function contactIn(newsletterId, fields) {
	return m.Contact.create({ accountId: user.accountId, newsletterId, ...fields });
}

async function openConfirmPage(token) {
	return renderToStaticMarkup(await anonymous(() => m.confirmPage.default({ searchParams: Promise.resolve({ token }) })));
}

function tokenFor(contact) {
	return createConfirmToken({ contactId: contact._id, newsletterId: contact.newsletterId });
}

async function getFunnel(query, key) {
	const response = await anonymous(() =>
		m.funnelRoute.GET(new Request(`http://localhost:3000/api/signup-funnel${query}`, { headers: key ? { authorization: `Bearer ${key}` } : {} }))
	);
	return { status: response.status, headers: response.headers, body: await response.json() };
}

describe("the page a signup came from", () => {
	test("only a plain path is kept", () => {
		for (const path of ["/", "/frisco", "/issues/frisco-is-finally-getting-a-trader-joes", "/little-elm"]) {
			assert.equal(m.funnel.readSignupPath(path), path);
		}
		for (const path of ["frisco", "https://evil.example/x", "//evil.example", "/a?b=c", "/a#b", "/<script>", "/a b", `/${"a".repeat(200)}`, 7, null]) {
			assert.equal(m.funnel.readSignupPath(path), null, String(path));
		}
	});

	test("the site's form passes it with the signup; anything else is dropped and the signup still goes through", async () => {
		const added = await callApi("POST", "/api/v1/contacts", {
			key: keys.signups,
			body: { newsletter: "funnel-notes", email: "frisco-reader@example.com", source: "website", signupPath: "/frisco", resubscribe: true },
		});
		assert.equal(added.status, 201, JSON.stringify(added.body));
		assert.equal(added.body.status, "pending");
		const saved = await load(added.body);
		assert.equal(saved.signupPath, "/frisco");
		assert.equal(saved.source, "website");

		const odd = await callApi("POST", "/api/v1/contacts", {
			key: keys.signups,
			body: { newsletter: "funnel-notes", email: "odd-path@example.com", source: "website", signupPath: "https://evil.example/" },
		});
		assert.equal(odd.status, 201);
		assert.equal((await load(odd.body)).signupPath, undefined);
		await flushAfter();
	});

	test("signing up again after leaving starts the funnel over, from the new page", async () => {
		const contact = await contactIn(user.newsletterId, {
			email: "came-back@example.com",
			status: "unsubscribed",
			unsubscribedAt: new Date("2026-09-01T00:00:00Z"),
			signupPath: "/frisco",
			confirmOpenedAt: new Date("2026-08-01T00:00:00Z"),
		});
		const again = await callApi("POST", "/api/v1/contacts", {
			key: keys.signups,
			body: { newsletter: "funnel-notes", email: "came-back@example.com", source: "website", signupPath: "/prosper", resubscribe: true },
		});
		assert.equal(again.status, 200);
		const saved = await load(contact);
		assert.equal(saved.status, "pending");
		assert.equal(saved.signupPath, "/prosper");
		assert.equal(saved.confirmOpenedAt, undefined);
		await flushAfter();
	});
});

describe("opening the confirm page", () => {
	test("notes the first open of a pending contact, keeps it on a refresh, and confirms nobody", async () => {
		const contact = await contactIn(user.newsletterId, { email: "opens@example.com", status: "pending" });
		const token = tokenFor(contact);
		assert.match(await openConfirmPage(token), /action="\/api\/confirm"/);
		const first = await load(contact);
		assert.ok(first.confirmOpenedAt instanceof Date);
		assert.equal(first.status, "pending");
		assert.equal(first.confirmedAt, undefined);

		await new Promise((resolve) => setTimeout(resolve, 5));
		await openConfirmPage(token);
		const refreshed = await load(contact);
		assert.deepEqual(refreshed.confirmOpenedAt, first.confirmOpenedAt, "a refresh keeps the first open");
		assert.equal(refreshed.status, "pending");

		const opened = await m.confirmRoute.GET(new Request(`http://localhost:3000/api/confirm?token=${encodeURIComponent(token)}`));
		assert.equal(opened.status, 303);
		assert.equal((await load(contact)).status, "pending", "GET still confirms nobody");
	});

	test("the button still confirms, and the page it comes back to changes nothing", async () => {
		const contact = await contactIn(user.newsletterId, { email: "presses@example.com", status: "pending" });
		const token = tokenFor(contact);
		await openConfirmPage(token);
		const opened = (await load(contact)).confirmOpenedAt;
		const posted = await anonymous(() =>
			m.confirmRoute.POST(
				new Request("http://localhost:3000/api/confirm", {
					method: "POST",
					headers: { origin: "http://localhost:3000" },
					body: new URLSearchParams({ token }),
				})
			)
		);
		assert.equal(posted.status, 303);
		await flushAfter();
		const confirmed = await load(contact);
		assert.equal(confirmed.status, "active");
		assert.ok(confirmed.confirmedAt instanceof Date);
		await openConfirmPage(token);
		assert.deepEqual((await load(contact)).confirmOpenedAt, opened);
	});

	test("a bad token, or a contact that isn't pending, notes nothing", async () => {
		const contacts = await Promise.all(
			["active", "dormant", "unsubscribed", "bounced", "complained"].map((status) => contactIn(user.newsletterId, { email: `not-pending-${status}@example.com`, status }))
		);
		for (const contact of contacts) {
			await openConfirmPage(tokenFor(contact));
			const after = await load(contact);
			assert.equal(after.confirmOpenedAt, undefined, contact.status);
			assert.equal(after.status, contact.status);
		}
		const pending = await contactIn(user.newsletterId, { email: "expired-link@example.com", status: "pending" });
		const expired = createConfirmToken({ contactId: pending._id, newsletterId: user.newsletterId }, Date.now() - 31 * 86_400_000);
		for (const bad of ["not-a-token", `${tokenFor(pending).slice(0, -2)}xx`, expired]) await openConfirmPage(bad);
		assert.equal((await load(pending)).confirmOpenedAt, undefined);
	});
});

describe("the funnel's numbers", () => {
	test("each step counts on its own day in the time zone asked for, and pending lists only who's waiting, newest first", async () => {
		const newsletterId = await createNewsletter(user, "funnel-counts");
		const at = (iso) => new Date(iso);
		const [waiting, confirmed] = await Promise.all([
			contactIn(newsletterId, {
				email: "waiting@example.com",
				status: "pending",
				source: "website",
				signupPath: "/frisco",
				subscribedAt: at("2026-10-31T15:00:00Z"),
				confirmOpenedAt: at("2026-10-31T16:00:00Z"),
			}),
			// 9 PM and 8 PM in Chicago on Oct 30, already Oct 31 in UTC.
			contactIn(newsletterId, {
				email: "confirmed@example.com",
				status: "active",
				subscribedAt: at("2026-10-30T20:00:00Z"),
				confirmOpenedAt: at("2026-10-31T01:00:00Z"),
				confirmedAt: at("2026-10-31T02:00:00Z"),
			}),
			contactIn(newsletterId, { email: "left@example.com", status: "unsubscribed", subscribedAt: at("2026-10-31T04:00:00Z") }),
			contactIn(newsletterId, { email: "bounced@example.com", status: "bounced", subscribedAt: at("2026-10-29T12:00:00Z") }),
			contactIn(newsletterId, { email: "dormant@example.com", status: "dormant", subscribedAt: at("2026-06-01T12:00:00Z") }),
		]);
		const old = await contactIn(newsletterId, { email: "old-pending@example.com", status: "pending", subscribedAt: at("2026-10-10T12:00:00Z") });
		const other = await contactIn(user.newsletterId, { email: "other-list@example.com", status: "pending", subscribedAt: at("2026-10-31T15:00:00Z") });
		const message = (contact, fields) =>
			m.Message.create({ accountId: user.accountId, newsletterId: contact.newsletterId, contactId: contact._id, email: contact.email, kind: "confirmation", ...fields });
		await Promise.all([
			message(waiting, { status: "sent", sentAt: at("2026-10-31T15:01:00Z") }),
			message(waiting, { status: "queued" }),
			message(old, { status: "sent", sentAt: at("2026-10-10T12:01:00Z") }),
			message(confirmed, { status: "sent", sentAt: at("2026-10-30T20:01:00Z") }),
			message(other, { status: "sent", sentAt: at("2026-10-31T15:01:00Z") }),
			m.Message.create({ accountId: user.accountId, newsletterId, contactId: confirmed._id, email: confirmed.email, kind: "welcome", status: "sent", sentAt: at("2026-10-31T02:01:00Z") }),
		]);

		const newsletter = await m.Newsletter.findOne({ accountId: user.accountId, _id: newsletterId }).lean();
		const funnel = await m.funnel.getSignupFunnel({ newsletter, days: 7, timeZone: "America/Chicago", now: at("2026-10-31T18:00:00Z") });
		assert.equal(funnel.newsletter, "funnel-counts");
		assert.deepEqual([funnel.from, funnel.to, funnel.days, funnel.timeZone], ["2026-10-25", "2026-10-31", 7, "America/Chicago"]);
		assert.deepEqual(funnel.byDay.map(({ date }) => date), ["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]);
		const day = (date) => funnel.byDay.find((row) => row.date === date);
		assert.deepEqual(day("2026-10-31"), { date: "2026-10-31", signedUp: 1, confirmSent: 1, confirmOpened: 1, confirmed: 0 });
		assert.deepEqual(day("2026-10-30"), { date: "2026-10-30", signedUp: 2, confirmSent: 1, confirmOpened: 1, confirmed: 1 });
		assert.deepEqual(day("2026-10-29"), { date: "2026-10-29", signedUp: 1, confirmSent: 0, confirmOpened: 0, confirmed: 0 });
		assert.deepEqual(funnel.totals, { signedUp: 4, confirmSent: 2, confirmOpened: 2, confirmed: 1 });

		assert.equal(funnel.pendingTotal, 2);
		assert.deepEqual(funnel.pending, [
			{
				email: "waiting@example.com",
				subscribedAt: "2026-10-31T15:00:00.000Z",
				confirmSentAt: "2026-10-31T15:01:00.000Z",
				confirmOpenedAt: "2026-10-31T16:00:00.000Z",
				source: "website",
				signupPath: "/frisco",
			},
			{ email: "old-pending@example.com", subscribedAt: "2026-10-10T12:00:00.000Z", confirmSentAt: "2026-10-10T12:01:00.000Z", confirmOpenedAt: null, source: null, signupPath: null },
		]);

		const capped = await m.funnel.getSignupFunnel({ newsletter, days: 1, timeZone: "UTC", pendingLimit: 1, now: at("2026-10-31T18:00:00Z") });
		assert.deepEqual(capped.byDay, [{ date: "2026-10-31", signedUp: 2, confirmSent: 1, confirmOpened: 2, confirmed: 1 }], "UTC days");
		assert.deepEqual(capped.pending.map(({ email }) => email), ["waiting@example.com"]);
		assert.equal(capped.pendingTotal, 2);
	});
});

describe("GET /api/signup-funnel", () => {
	test("needs a read or full access key", async () => {
		assert.equal((await getFunnel("")).status, 401);
		assert.equal((await getFunnel("", "mc_not_a_real_key")).status, 401);
		const signups = await getFunnel("", keys.signups);
		assert.equal(signups.status, 403);
		assert.equal(signups.body.error.code, "forbidden");
		for (const key of [keys.read, keys.full]) {
			const response = await getFunnel("?newsletter=funnel-notes&days=3&timeZone=America/Chicago", key);
			assert.equal(response.status, 200, JSON.stringify(response.body));
			assert.equal(response.headers.get("cache-control"), "private, no-store");
			assert.deepEqual(Object.keys(response.body), ["newsletter", "days", "from", "to", "timeZone", "totals", "byDay", "pending", "pendingTotal"]);
			assert.equal(response.body.days, 3);
			assert.equal(response.body.byDay.length, 3);
			assert.equal(response.body.timeZone, "America/Chicago");
			assert.ok(response.body.pending.every(({ email }) => email.endsWith("@example.com")));
			const statuses = await m.Contact.find({ accountId: user.accountId, email: { $in: response.body.pending.map(({ email }) => email) }, newsletterId: user.newsletterId })
				.distinct("status");
			assert.deepEqual(statuses, ["pending"]);
		}
	});

	test("days, limit and the time zone stay in bounds", async () => {
		const wide = await getFunnel("?days=999&limit=0&timeZone=Not/AZone", keys.read);
		assert.equal(wide.status, 200);
		assert.equal(wide.body.days, 90);
		assert.equal(wide.body.timeZone, "UTC");
		assert.ok(wide.body.pending.length <= 1);
		assert.equal((await getFunnel("?days=abc", keys.read)).body.days, 7);
	});

	test("another account's newsletter is not found", async () => {
		const stranger = await signIn("funnel-stranger@example.com");
		await activate(stranger);
		await createNewsletter(stranger, "stranger-notes");
		const response = await getFunnel("?newsletter=stranger-notes", keys.read);
		assert.equal(response.status, 404);
		assert.equal(response.body.error.code, "not_found");
	});

	test("is reachable without a session, like the REST API", async () => {
		const response = await m.proxy(new m.NextRequest("http://localhost:3000/api/signup-funnel", { headers: { host: "localhost:3000" } }));
		assert.ok(response.headers.get("x-middleware-next"));
	});
});
