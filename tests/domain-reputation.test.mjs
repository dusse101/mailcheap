import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyDomain, getDomainListProblem, isAllowlistedDomain, parseDomainList } from "../lib/domain-reputation.js";
import { getDropReason } from "../lib/import-checks.js";

// Downloaded lists of throwaway and spam domains (lib/domain-lists.js), checked before they replace the list in use,
// and never able to mark the mailbox providers people really use.

test("a list file keeps its domains, lowercase, without comments, junk or big providers", () => {
	const text = ["# throwaway inboxes", "", "Mailinator.com", "  tempinbox.example  ", "not a domain", "gmail.com", "web.de", "xn--80ak6aa92e.com"].join("\n");
	assert.deepEqual(parseDomainList(text), { domains: ["mailinator.com", "tempinbox.example", "xn--80ak6aa92e.com"], invalid: 1 });
});

test("a download that's too short, mostly junk or far shorter than the last one keeps the list in use", () => {
	const domains = Array.from({ length: 100 }, (_, index) => `throwaway${index}.example`);
	assert.equal(getDomainListProblem({ domains, invalid: 0 }, { minCount: 50 }), null);
	assert.match(getDomainListProblem({ domains, invalid: 0 }, { minCount: 500 }), /only 100 domains/);
	assert.match(getDomainListProblem({ domains, invalid: 40 }, { minCount: 50 }), /aren't domains/);
	assert.match(getDomainListProblem({ domains, invalid: 0 }, { minCount: 50, previousCount: 200 }), /down from 200/);
	assert.equal(getDomainListProblem({ domains, invalid: 0 }, { minCount: 50, previousCount: 120 }), null, "a small drop is normal");
});

test("big mailbox providers are never on a list, whatever a download says", () => {
	for (const domain of ["gmail.com", "outlook.com", "yahoo.com", "icloud.com", "proton.me", "gmx.de", "qq.com", "orange.fr"]) {
		assert.equal(isAllowlistedDomain(domain), true, domain);
		assert.equal(classifyDomain(domain, { spam: new Set([domain]), disposable: new Set([domain]) }), null, domain);
	}
});

test("privacy relays, internet providers' mailboxes and mail.com's domains are never spam, though StopForumSpam lists some", () => {
	const domains = ["aleeas.com", "slmail.me", "passinbox.com", "mozmail.com", "privaterelay.appleid.com", "embarqmail.com", "tmomail.net", "consultant.com"];
	for (const domain of domains) {
		assert.equal(classifyDomain(domain, { spam: new Set(domains), disposable: new Set(domains) }), null, domain);
		assert.equal(getDropReason(`reader@${domain}`, { spam: new Set(domains) }), null, domain);
	}
});

test("spam domains match by exact name; throwaway inboxes match with their subdomains", () => {
	const lists = { spam: new Set(["spammy.example"]), disposable: new Set(["fresh-throwaway.example"]) };
	assert.equal(classifyDomain("spammy.example", lists), "spam");
	assert.equal(classifyDomain("mail.spammy.example", lists), null, "StopForumSpam's whole-domain list is an exact match");
	assert.equal(classifyDomain("fresh-throwaway.example", lists), "disposable");
	assert.equal(classifyDomain("box.fresh-throwaway.example", lists), "disposable");
	assert.equal(classifyDomain("MAILINATOR.com"), "disposable", "the bundled list works without a download");
	assert.equal(classifyDomain("company.example", lists), null);
});

test("imports leave out spam domains and throwaway inboxes, each with its reason", () => {
	const lists = { spam: new Set(["spammy.example"]), disposable: new Set(["fresh-throwaway.example"]) };
	assert.equal(getDropReason("reader@spammy.example", lists), "spamDomain");
	assert.equal(getDropReason("reader@fresh-throwaway.example", lists), "disposable");
	assert.equal(getDropReason("reader@fresh-throwaway.example"), null, "without the downloaded list");
	assert.equal(getDropReason("reader@company.example", lists), null);
});
