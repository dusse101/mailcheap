import assert from "node:assert/strict";
import { test } from "node:test";
import { getDnsHost, getDomainSetup } from "../lib/domain-records.js";
import { rootDomain } from "../lib/root-domain.js";

// A PostShiba domain as lib/domains.js stores it.
function postshibaDomain(domain) {
	return {
		domain,
		archiveHost: `news.${domain}`,
		mailFromDomain: `rp.${domain}`,
		records: [
			{ purpose: "dkim", type: "CNAME", name: `ps1._domainkey.${domain}`, value: "dom_123.customers.postshiba.com" },
			{ purpose: "mail-from", type: "CNAME", name: `rp.${domain}`, value: "rp.postshiba.com" },
		],
	};
}

function listRecords(domain) {
	return getDomainSetup(domain).flatMap(({ records }) => records.map(({ type, name, host, value }) => ({ type, name, host, value })));
}

test("root domains come from the Public Suffix List, for hosts and email addresses", () => {
	assert.equal(rootDomain("mail.example.com"), "example.com");
	assert.equal(rootDomain("news.example.org"), "example.org");
	assert.equal(rootDomain("Reader@Mail.Example.co.uk"), "example.co.uk");
	assert.equal(rootDomain("jane@example.com"), "example.com");
	assert.equal(rootDomain("news.example.com.au"), "example.com.au");
	assert.equal(rootDomain("news.jane.me.uk"), "jane.me.uk", "suffixes a short list would miss");
	assert.equal(rootDomain("news.example.us.com"), "example.us.com", "private suffixes, whose customers get a zone of their own");
	assert.equal(rootDomain("Example.com."), "example.com");
	assert.equal(rootDomain("co.uk"), "co.uk", "a suffix alone stays as it is");
	assert.equal(rootDomain(""), "");
});

test("an apex domain's hosts leave out the domain, and values stay as they are", () => {
	assert.deepEqual(listRecords(postshibaDomain("example.com")), [
		{ type: "CNAME", name: "ps1._domainkey.example.com", host: "ps1._domainkey", value: "dom_123.customers.postshiba.com" },
		{ type: "CNAME", name: "rp.example.com", host: "rp", value: "rp.postshiba.com" },
		{ type: "TXT", name: "_dmarc.example.com", host: "_dmarc", value: "v=DMARC1; p=none;" },
	]);
});

test("a subdomain's hosts keep its own labels: its records go in the root domain's zone", () => {
	assert.deepEqual(listRecords(postshibaDomain("news.example.com")).map(({ host }) => host), ["ps1._domainkey.news", "rp.news", "_dmarc.news"]);
});

test("co.uk and com.au are suffixes: the zone is the domain under them", () => {
	assert.deepEqual(listRecords(postshibaDomain("example.co.uk")).map(({ host }) => host), ["ps1._domainkey", "rp", "_dmarc"]);
	assert.deepEqual(listRecords(postshibaDomain("news.example.co.uk")).map(({ host }) => host), ["ps1._domainkey.news", "rp.news", "_dmarc.news"]);
	assert.deepEqual(listRecords(postshibaDomain("mail.example.com.au")).map(({ host }) => host), ["ps1._domainkey.mail", "rp.mail", "_dmarc.mail"]);
});

test("a record at the zone's root is @, and a name outside the zone stays whole", () => {
	assert.equal(getDnsHost("example.com", "example.com"), "@");
	assert.equal(getDnsHost("Example.com.", "example.com"), "@");
	assert.equal(getDnsHost("ps1._domainkey.example.com.", "example.com"), "ps1._domainkey");
	assert.equal(getDnsHost("notexample.com", "example.com"), "notexample.com");

	const domain = postshibaDomain("example.co.uk");
	domain.records.push({ purpose: "mail-from", type: "TXT", name: "example.co.uk", value: "v=spf1 include:postshiba.com ~all" });
	assert.deepEqual(listRecords(domain)[2], { type: "TXT", name: "example.co.uk", host: "@", value: "v=spf1 include:postshiba.com ~all" });
});
