import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getOwnershipRecord, getWebsiteDomainSetup, getWebsiteHostProblem } from "../lib/website-domain-rules.js";
import {
	activate,
	addLiveWebsiteDomain,
	as,
	callApi,
	catchRedirect,
	form,
	pointWebsiteDomain,
	signIn,
	startTestApp,
	withEnv,
} from "./helpers/app.mjs";
import { challengedHosts, failNextAttach, projectHosts, setHelperSetUp } from "./stubs/dns-broker.mjs";
import { cnames, txts } from "./stubs/dns-check.mjs";
import { sent } from "./stubs/ses.mjs";

// A newsletter's website on a subdomain of the customer's: its CNAME points it at MailCheap, a TXT record only that
// account can know proves it's theirs, and on MailCheap Cloud the DNS helper puts it on the app's Vercel project.
const SHARED_DOMAIN = "mailcheapmail.com";
let app;
let m;

async function customer(email, slug) {
	const user = await signIn(email);
	await activate(user);
	const url = await as(user, () =>
		catchRedirect(m.newsletters.saveNewsletter(null, form({ name: slug, slug, postalAddress: "1 Main St, Paris", archiveEnabled: "on" })))
	);
	user.newsletterId = url.split("/").at(-1);
	return user;
}

function setDomain(user, host) {
	return as(user, () => m.newsletters.setWebsiteDomain(user.newsletterId, host));
}

function checkDomain(user) {
	return as(user, () => m.newsletters.checkWebsiteDomain(user.newsletterId));
}

function removeDomain(user) {
	return as(user, () => m.newsletters.removeWebsiteDomain(user.newsletterId));
}

function findNewsletter(user) {
	return m.Newsletter.findOne({ accountId: user.accountId, _id: user.newsletterId }).lean();
}

async function readSetup(user) {
	const { output } = await as(user, () => m.dashboard.runDashboardAction("get_newsletter", { id: user.newsletterId }));
	return output.websiteDomain;
}

async function sendTest(user) {
	const url = await as(user, () => catchRedirect(m.campaigns.createCampaign(user.newsletterId)));
	const id = url.split("/").at(-1);
	await as(user, () => m.campaigns.saveCampaign(id, { subject: "Issue", previewText: "This week", body: '<p>Hello <a href="https://example.org">link</a></p>' }));
	assert.deepEqual(await as(user, () => m.campaigns.sendTestCampaign(id)), { ok: true });
	return sent.at(-1);
}

function visit(host, path) {
	const url = `https://${host}${path}`;
	return m.proxy(new m.NextRequest(url, { headers: { host } }));
}

before(async () => {
	app = await startTestApp();
	m = {
		newsletters: await import("../app/(app)/newsletters/actions.js"),
		campaigns: await import("../app/(app)/campaigns/actions.js"),
		apiKeys: await import("../app/(app)/api-keys/actions.js"),
		dashboard: await import("../lib/actions/dashboard.js"),
		websiteDomains: await import("../lib/website-domains.js"),
		hostRouting: await import("../lib/host-routing.js"),
		settingsPage: await import("../app/(app)/newsletters/website/page.js"),
		proxy: (await import("../proxy.js")).proxy,
		NextRequest: (await import("next/server")).NextRequest,
		TooltipProvider: (await import("../components/ui/tooltip.jsx")).TooltipProvider,
		Account: (await import("../models/Account.js")).default,
		Alert: (await import("../models/Alert.js")).default,
		Newsletter: (await import("../models/Newsletter.js")).default,
	};
});

after(() => app?.stop());

describe("rules", () => {
	test("a website goes on a subdomain of the customer's, never on MailCheap's or a domain's own name", () => {
		const options = { sharedDomain: SHARED_DOMAIN, appHost: "mailcheap.ai" };
		for (const host of ["news.example.com", "www.example.com", "read.news.example.co.uk"]) assert.equal(getWebsiteHostProblem(host, options), null, host);
		assert.equal(getWebsiteHostProblem("example.com", options), "Use a subdomain, like news.example.com");
		assert.equal(getWebsiteHostProblem("example.co.uk", options), "Use a subdomain, like news.example.co.uk");
		for (const host of ["weekly.mailcheapmail.com", "news.mailcheap.ai", "x.vercel.app", "news.postshiba.com"]) {
			assert.equal(getWebsiteHostProblem(host, options), "This domain can't be used", host);
		}
		for (const host of ["", "news", "news..example.com", "news.example.com:8443", "203.0.113.7"]) {
			assert.equal(getWebsiteHostProblem(host, options), "Enter a subdomain like news.example.com", host);
		}
	});

	test("the TXT record is the same each time for one account and host, and no other account's", () => {
		const record = getOwnershipRecord("6650f1c2e9b1d4a012345678", "news.example.com");
		assert.equal(record.type, "TXT");
		assert.equal(record.name, "_mailcheap.news.example.com");
		assert.match(record.value, /^mailcheap-verify=[A-Za-z0-9_-]{32}$/);
		assert.deepEqual(getOwnershipRecord("6650f1c2e9b1d4a012345678", "news.example.com"), record);
		assert.notEqual(getOwnershipRecord("6650f1c2e9b1d4a087654321", "news.example.com").value, record.value);
		assert.notEqual(getOwnershipRecord("6650f1c2e9b1d4a012345678", "read.example.com").value, record.value);
	});

	test("a domain being set up lists its CNAME and TXT records, and Vercel's when it asks; a live one keeps its CNAME", () => {
		const accountId = "6650f1c2e9b1d4a012345678";
		const cnameTarget = "cname.mailcheap.ai";
		const pending = getWebsiteDomainSetup({ slug: "notes", websiteDomain: { host: "news.example.co.uk", cnameFound: true } }, { accountId, cnameTarget });
		assert.deepEqual([pending.isLive, pending.zone, pending.status.label], [false, "example.co.uk", "Waiting for DNS"]);
		assert.deepEqual(
			pending.steps.map(({ key, status, records }) => [key, status.label, records.map(({ type, host }) => `${type} ${host}`)]),
			[
				["cname", "Found", ["CNAME news"]],
				["ownership", "Waiting for DNS", ["TXT _mailcheap.news"]],
			]
		);
		const verification = [{ type: "TXT", name: "_vercel.example.co.uk", value: "vc-domain-verify=news.example.co.uk,7d1c0a" }];
		const challenged = getWebsiteDomainSetup({ websiteDomain: { host: "news.example.co.uk", txtFound: true, verification } }, { accountId, cnameTarget });
		assert.deepEqual(challenged.steps.at(-1).records, [{ ...verification[0], host: "_vercel" }]);

		const live = getWebsiteDomainSetup({ archiveHost: "news.example.com", websiteDomain: { host: "news.example.com", cnameFound: true, verification } }, { accountId, cnameTarget });
		assert.deepEqual([live.isLive, live.status.label, live.steps.map(({ key }) => key)], [true, "Live", ["cname"]]);
		const gone = getWebsiteDomainSetup({ archiveHost: "news.example.com", websiteDomain: { host: "news.example.com", cnameFound: false } }, { accountId, cnameTarget });
		assert.deepEqual([gone.status.label, gone.steps[0].status.label], ["Not pointing at MailCheap", "Not found"]);
		const before = getWebsiteDomainSetup({ archiveHost: "letters.example.com" }, { accountId, cnameTarget });
		assert.deepEqual([before.host, before.isLive, before.status.label], ["letters.example.com", true, "Live"], "a host from before website domains is live");
		assert.equal(getWebsiteDomainSetup({ archiveHost: "letters.example.com" }, { accountId, cnameTarget: null }), null, "without a target: nothing to show");
		assert.equal(getWebsiteDomainSetup({ slug: "notes" }, { accountId, cnameTarget }), null);
	});
});

describe("setting up", () => {
	test("the website and the links in emails move to the subdomain once its CNAME and TXT records are in, and its shared address keeps working", async () => {
		const user = await customer("site-owner@example.com", "site-notes");
		assert.deepEqual(await setDomain(user, "https://News.Site-Owner.dev/about"), { ok: true, live: false });
		let setup = await readSetup(user);
		assert.deepEqual([setup.host, setup.live, setup.status], ["news.site-owner.dev", false, "Waiting for DNS"]);
		const ownership = getOwnershipRecord(user.accountId, "news.site-owner.dev");
		assert.deepEqual(
			setup.setup.flatMap(({ records }) => records),
			[
				{ type: "CNAME", name: "news.site-owner.dev", host: "news", value: "cname.mailcheap.ai" },
				{ type: "TXT", name: ownership.name, host: "_mailcheap.news", value: ownership.value },
			]
		);

		cnames.set("news.site-owner.dev", ["cname.mailcheap.ai"]);
		assert.deepEqual(await checkDomain(user), { ok: true, live: false, pointed: true });
		assert.equal(projectHosts.has("news.site-owner.dev"), false, "nothing goes on the Vercel project before the TXT record proves it's theirs");

		txts.set(ownership.name, [["mailcheap-verify=", ownership.value.split("=")[1]]]);
		assert.deepEqual(await checkDomain(user), { ok: true, live: true, pointed: true });
		assert.equal(projectHosts.get("news.site-owner.dev"), true, "on the Vercel project, verified");
		const newsletter = await findNewsletter(user);
		assert.equal(newsletter.archiveHost, "news.site-owner.dev");
		setup = await readSetup(user);
		assert.deepEqual([setup.live, setup.status, setup.setup.map(({ key }) => key)], [true, "Live", ["cname"]]);

		assert.deepEqual(await m.hostRouting.resolveArchiveHost("news.site-owner.dev"), { isArchiveHost: true, slug: "site-notes" });
		assert.deepEqual(await m.hostRouting.resolveArchiveHost(`site-notes.${SHARED_DOMAIN}`), { isArchiveHost: true, slug: "site-notes" });
		const email = await sendTest(user);
		assert.match(email.html, /https:\/\/news\.site-owner\.dev\/c\//);
		assert.match(email.headers["List-Unsubscribe"], /^<https:\/\/news\.site-owner\.dev\/api\/unsubscribe\?token=/);
	});

	test("a CNAME left pointing at MailCheap isn't enough to claim someone's domain: each account needs its own TXT record", async () => {
		const owner = await customer("left-owner@example.com", "left-notes");
		assert.deepEqual(await addLiveWebsiteDomain(owner, "news.left-behind.dev"), { ok: true, live: true });
		const squatter = await customer("squatter@example.com", "squat-notes");
		assert.deepEqual(await setDomain(squatter, "news.left-behind.dev"), { error: "news.left-behind.dev is already used by another MailCheap newsletter" });

		assert.deepEqual(await removeDomain(owner), { ok: true, removed: "news.left-behind.dev" });
		assert.deepEqual(await setDomain(squatter, "news.left-behind.dev"), { ok: true, live: false }, "the owner's CNAME and TXT records are still there");
		assert.equal((await findNewsletter(squatter)).archiveHost, undefined);
		assert.equal((await readSetup(squatter)).setup.find(({ key }) => key === "ownership").status, "Waiting for DNS");
		assert.deepEqual(await m.hostRouting.resolveArchiveHost("news.left-behind.dev"), { isArchiveHost: true, slug: null }, "it names no newsletter");

		await pointWebsiteDomain(squatter, "news.left-behind.dev");
		assert.deepEqual(await checkDomain(squatter), { ok: true, live: true, pointed: true }, "whoever manages the domain now can add their own");
	});

	test("Vercel's own TXT record shows as a third step until it's in", async () => {
		const user = await customer("vercel-user@example.com", "vercel-notes");
		challengedHosts.add("news.on-vercel.dev");
		assert.deepEqual(await addLiveWebsiteDomain(user, "news.on-vercel.dev"), { ok: true, live: false });
		const step = (await readSetup(user)).setup.find(({ key }) => key === "vercel");
		assert.deepEqual(step.records, [{ type: "TXT", name: "_vercel.on-vercel.dev", host: "_vercel", value: "vc-domain-verify=news.on-vercel.dev,7d1c0a" }]);
		assert.equal((await findNewsletter(user)).archiveHost, undefined);

		challengedHosts.delete("news.on-vercel.dev");
		assert.deepEqual(await checkDomain(user), { ok: true, live: true, pointed: true });
		assert.equal((await readSetup(user)).setup.some(({ key }) => key === "vercel"), false);
	});

	test("a domain on another Vercel project, or the DNS helper failing, says so, keeps what DNS showed and alerts the admins for the helper", async () => {
		const user = await customer("helper-down@example.com", "helper-notes");
		await pointWebsiteDomain(user, "news.elsewhere.dev");
		failNextAttach({ status: 409, message: "news.elsewhere.dev is on another Vercel project" });
		assert.deepEqual(await setDomain(user, "news.elsewhere.dev"), {
			error: "news.elsewhere.dev is used by another site on Vercel, where MailCheap runs. Remove it there, then check again.",
		});
		assert.equal(await m.Alert.exists({ accountId: null, key: "dns-helper-down" }), null, "the host's problem, not the helper's");

		failNextAttach({ status: 502, message: "Vercel answered POST with 500", helperProblem: "down" });
		assert.deepEqual(await checkDomain(user), { error: "Couldn't connect news.elsewhere.dev yet. Try again later." });
		const alert = await m.Alert.findOne({ accountId: null, key: "dns-helper-down" }).lean();
		assert.match(alert.occurrences.at(-1).detail, /news\.elsewhere\.dev couldn't go on the Vercel project/);
		const { websiteDomain, archiveHost } = await findNewsletter(user);
		assert.deepEqual([websiteDomain.cnameFound, websiteDomain.txtFound, archiveHost], [true, true, undefined]);

		failNextAttach({ status: 429, message: "100 website domains went on the project in the last 24 hours, the cap is 100", helperProblem: "cap" });
		assert.deepEqual(await checkDomain(user), { error: "Couldn't connect news.elsewhere.dev yet. Try again later." });
		assert.equal((await m.Alert.findOne({ accountId: null, key: "dns-helper-cap" }).lean()).title, "DNS helper at its daily cap");

		assert.deepEqual(await checkDomain(user), { ok: true, live: true, pointed: true }, "the next check goes through");
	});

	test("on a self-hosted server without the DNS helper, the domain goes live once its records are in", async () => {
		const user = await customer("self-hosted-site@example.com", "self-site");
		setHelperSetUp(false);
		try {
			assert.deepEqual(await addLiveWebsiteDomain(user, "news.self-hosted.dev"), { ok: true, live: true });
		} finally {
			setHelperSetUp(true);
		}
		assert.equal(projectHosts.has("news.self-hosted.dev"), false);
		assert.equal((await findNewsletter(user)).websiteDomain.attachedAt, undefined);
	});

	test("without a website target, the server doesn't offer it", async () => {
		const user = await customer("no-target@example.com", "no-target");
		await withEnv({ ARCHIVE_CNAME_TARGET: "" }, async () => {
			assert.deepEqual(await setDomain(user, "news.no-target.dev"), { error: "This server doesn't put websites on your own domain" });
			assert.equal(await readSetup(user), null);
			const html = renderToStaticMarkup(createElement(m.TooltipProvider, null, await as(user, () => m.settingsPage.default())));
			assert.doesNotMatch(html, /Your own domain/);
		});
	});
});

describe("one domain at a time", () => {
	test("one that never went live gives way and leaves the Vercel project; a live one is removed first and stays there for the links in sent emails", async () => {
		const user = await customer("switching@example.com", "switch-site");
		await pointWebsiteDomain(user, "first.switching.dev");
		cnames.delete("first.switching.dev");
		assert.deepEqual(await setDomain(user, "first.switching.dev"), { ok: true, live: false });
		assert.equal(projectHosts.get("first.switching.dev"), true, "proven: on the project, waiting for its CNAME");

		assert.deepEqual(await addLiveWebsiteDomain(user, "second.switching.dev"), { ok: true, live: true });
		assert.equal(projectHosts.has("first.switching.dev"), false, "it never went live: off the project");
		assert.deepEqual(await setDomain(user, "third.switching.dev"), { error: "Remove second.switching.dev first: a newsletter has one domain at a time" });

		assert.deepEqual(await removeDomain(user), { ok: true, removed: "second.switching.dev" });
		const newsletter = await findNewsletter(user);
		assert.deepEqual([newsletter.archiveHost, newsletter.websiteDomain, newsletter.pastHosts], [undefined, undefined, ["second.switching.dev"]]);
		assert.equal(projectHosts.get("second.switching.dev"), true, "still on the project");
		const unsubscribe = await visit("second.switching.dev", "/api/unsubscribe?token=token");
		assert.equal(unsubscribe.headers.get("x-middleware-next"), "1", "links in sent emails keep working there");
		assert.equal((await visit("second.switching.dev", "/")).status, 404, "its pages don't");
		assert.deepEqual(await removeDomain(user), { error: "The newsletter has no website domain" });

		assert.deepEqual(await setDomain(user, "second.switching.dev"), { ok: true, live: true }, "its records are still in: live again at once");
		assert.deepEqual((await findNewsletter(user)).pastHosts, []);
	});

	test("a host from before website domains had their own setting shows as live and can be removed", async () => {
		const user = await customer("legacy-site@example.com", "legacy-site");
		await m.Newsletter.updateOne({ accountId: user.accountId, _id: user.newsletterId }, { $set: { archiveHost: "letters.legacy-site.dev" } });
		assert.deepEqual([(await readSetup(user)).host, (await readSetup(user)).live], ["letters.legacy-site.dev", true]);
		cnames.set("letters.legacy-site.dev", ["cname.mailcheap.ai"]);
		assert.deepEqual(await checkDomain(user), { ok: true, live: true, pointed: true }, "a live host doesn't need the TXT record");
		assert.deepEqual(await removeDomain(user), { ok: true, removed: "letters.legacy-site.dev" });
		assert.equal((await findNewsletter(user)).archiveHost, undefined);
	});
});

describe("the API, MCP and other accounts", () => {
	test("set, check and remove work with an API key, on the account's own newsletters only", async () => {
		const user = await customer("api-site@example.com", "api-site");
		const other = await customer("api-other@example.com", "api-other");
		const { key } = await as(user, () => m.apiKeys.createApiKey(null, form({ name: "Agent", level: "full" })));
		const path = (id) => `/api/v1/newsletters/${id}/website-domain`;

		const refused = await callApi("POST", path(user.newsletterId), { key, body: { host: "api-site.dev" } });
		assert.deepEqual([refused.status, refused.body.error.code, refused.body.error.message], [400, "validation_failed", "Use a subdomain, like news.api-site.dev"]);
		assert.equal((await callApi("POST", path(other.newsletterId), { key, body: { host: "news.api-site.dev" } })).status, 404);
		assert.equal((await callApi("DELETE", path(other.newsletterId), { key })).status, 404);

		await pointWebsiteDomain(user, "news.api-site.dev");
		const created = await callApi("POST", path("api-site"), { key, body: { host: "news.api-site.dev" } });
		assert.equal(created.status, 200);
		assert.deepEqual([created.body.host, created.body.live, created.body.status], ["news.api-site.dev", true, "Live"]);
		const checked = await callApi("POST", `${path(user.newsletterId)}/check`, { key });
		assert.deepEqual([checked.status, checked.body.pointed], [200, true]);
		const read = await callApi("GET", `/api/v1/newsletters/${user.newsletterId}`, { key });
		assert.equal(read.body.archiveUrl, "https://news.api-site.dev/");
		assert.equal(read.body.websiteDomain.host, "news.api-site.dev");

		const removed = await callApi("DELETE", path(user.newsletterId), { key });
		assert.deepEqual([removed.status, removed.body], [200, { removed: "news.api-site.dev" }]);
		assert.equal((await callApi("GET", `/api/v1/newsletters/${user.newsletterId}`, { key })).body.archiveUrl, `https://api-site.${SHARED_DOMAIN}/`);
	});

	test("the Website settings show the domain's records with copy buttons, and the field to add one without a domain", async () => {
		const user = await customer("settings-site@example.com", "settings-site");
		const render = async () => renderToStaticMarkup(createElement(m.TooltipProvider, null, await as(user, () => m.settingsPage.default())));
		const empty = await render();
		assert.match(empty, /Your own domain/);
		assert.match(empty, /placeholder="news\.yourdomain\.com"/);

		await setDomain(user, "news.settings-site.dev");
		const pending = await render();
		const ownership = getOwnershipRecord(user.accountId, "news.settings-site.dev");
		assert.match(pending, /news\.settings-site\.dev/);
		assert.ok(pending.includes(ownership.value), "the TXT record to copy");
		assert.match(pending, /s2\/favicons\?domain=settings-site\.dev/, "with the domain's favicon");
	});
});

describe("purge", () => {
	test("an account's hosts leave the Vercel project, unless another account's newsletter has one", async () => {
		const leaving = await customer("purge-site@example.com", "purge-site");
		const staying = await customer("purge-next@example.com", "purge-next");
		assert.deepEqual(await addLiveWebsiteDomain(leaving, "old.purge-site.dev"), { ok: true, live: true });
		await removeDomain(leaving);
		assert.deepEqual(await addLiveWebsiteDomain(staying, "old.purge-site.dev"), { ok: true, live: true }, "the domain changed hands");
		assert.deepEqual(await addLiveWebsiteDomain(leaving, "news.purge-site.dev"), { ok: true, live: true });

		const account = await m.Account.findById(leaving.accountId).lean();
		await m.websiteDomains.releaseWebsiteDomains(account);
		assert.equal(projectHosts.has("news.purge-site.dev"), false);
		assert.equal(projectHosts.get("old.purge-site.dev"), true, "the other account's website stays");
	});
});
