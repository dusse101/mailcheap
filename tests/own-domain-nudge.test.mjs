import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { as, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";
import { ADD_DOMAIN_PATH, DOMAINS_PATH, SENDER_PATH, getSenderPath } from "../lib/newsletters.js";
import { getPresendChecks } from "../lib/presend-checks.js";
import { getOwnDomainNudge, isOwnDomainNudgeShown } from "../lib/sender-rules.js";
import { toSafeNextPath } from "../lib/validation.js";

const sharedDomain = "mailcheap.ai";
const shared = "hello@field-notes.mailcheap.ai";
const pending = { _id: "65f1c0ffee00000000000001", domain: "pending.dev", verified: false };
const verified = { _id: "65f1c0ffee00000000000002", domain: "fieldnotes.com", verified: true };

test("a newsletter on the shared address is told its next step toward its own domain", () => {
	assert.deepEqual(getOwnDomainNudge({ fromEmail: shared, domains: [], sharedDomain }), { step: "add" });
	assert.deepEqual(getOwnDomainNudge({ fromEmail: shared, domains: [pending], sharedDomain }), { step: "verify", domain: "pending.dev" });
	assert.deepEqual(getOwnDomainNudge({ fromEmail: shared, domains: [pending, verified], sharedDomain }), {
		step: "switch",
		domain: "fieldnotes.com",
		domainId: verified._id,
	});
});

test("a newsletter on its own domain, or a server without a shared domain, gets no helper", () => {
	assert.equal(getOwnDomainNudge({ fromEmail: "hi@fieldnotes.com", domains: [verified], sharedDomain }), null);
	assert.equal(getOwnDomainNudge({ fromEmail: "hi@fieldnotes.com", domains: [verified], sharedDomain: null }), null);
});

test("a closed helper stays closed until the step changes", () => {
	const add = { step: "add" };
	const toSwitch = { step: "switch", domain: "fieldnotes.com", domainId: verified._id };
	assert.equal(isOwnDomainNudgeShown(add, {}), true);
	assert.equal(isOwnDomainNudgeShown(add, { dismissedNudges: { ownDomain: "add" } }), false);
	assert.equal(isOwnDomainNudgeShown(toSwitch, { dismissedNudges: { ownDomain: "add" } }), true, "a verified domain shows it once more");
	assert.equal(isOwnDomainNudgeShown(null, {}), false);
});

test("sender links open the right newsletter and domain, and survive the safe redirect", () => {
	const newsletterId = "65f1c0ffee00000000000003";
	assert.equal(getSenderPath(), SENDER_PATH);
	assert.equal(getSenderPath({ domainId: verified._id }), `${SENDER_PATH}?domain=${verified._id}`);
	const opening = new URL(getSenderPath({ newsletterId, domainId: verified._id }), "https://app.test");
	assert.equal(opening.pathname, `/newsletters/${newsletterId}`);
	const next = opening.searchParams.get("next");
	assert.equal(toSafeNextPath(next), `${SENDER_PATH}?domain=${verified._id}`, "the newsletter route keeps it");
	assert.equal(ADD_DOMAIN_PATH, `${DOMAINS_PATH}#add-domain`);
});

test("the review step's from check says when the shared address is used", () => {
	const input = {
		campaign: { subject: "Hi", previewText: "", body: "<p>Hi</p>", testSentAt: null },
		newsletter: { postalAddress: "1 Main St" },
		rendered: { html: "{{unsubscribe_url}}", bytes: 1000 },
		isSendingEnabled: true,
	};
	const fromCheck = (extra) => getPresendChecks({ ...input, ...extra }).checks.find(({ id }) => id === "domain");
	assert.equal(fromCheck({ isSharedSender: true }).detail, "Shared address");
	assert.equal(fromCheck({ isSharedSender: true }).isOk, true, "it never blocks sending");
	assert.equal(fromCheck({}).detail, null);
});

let app;
let m;

before(async () => {
	app = await startTestApp();
	m = {
		welcome: await import("../app/welcome/actions.js"),
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		Newsletter: (await import("../models/Newsletter.js")).default,
	};
});

after(() => app?.stop());

async function customer(email) {
	const user = await signIn(email);
	const slug = email.split("@")[0];
	const url = await as(user, () =>
		catchRedirect(m.newsletters.saveNewsletter(null, form({ name: `${slug} news`, slug, fromEmail: `hello@${slug}.mailcheapmail.com`, postalAddress: "1 Main St, Paris" })))
	);
	user.newsletterId = url.split("/").at(-1);
	return user;
}

async function readClosedStep(newsletterId) {
	const newsletter = await m.Newsletter.findById(newsletterId).setOptions({ crossAccount: true }).lean();
	return newsletter.dismissedNudges?.ownDomain ?? null;
}

test("closing the helper keeps it closed for that newsletter only, and nobody closes another account's", async () => {
	const owner = await customer("nudge-owner@example.org");
	const other = await customer("nudge-other@example.org");

	assert.deepEqual(await as(owner, () => m.welcome.dismissOwnDomainNudge(owner.newsletterId, "add")), { ok: true });
	assert.equal(await readClosedStep(owner.newsletterId), "add");

	await as(owner, () => m.welcome.dismissOwnDomainNudge(other.newsletterId, "add"));
	assert.equal(await readClosedStep(other.newsletterId), null, "another account's newsletter stays as it was");

	assert.ok((await as(owner, () => m.welcome.dismissOwnDomainNudge(owner.newsletterId, "remove"))).error, "only known steps");
	assert.ok((await as(owner, () => m.welcome.dismissOwnDomainNudge({ $ne: null }, "add"))).error, "only an ID");
	assert.equal(await readClosedStep(owner.newsletterId), "add");
});
