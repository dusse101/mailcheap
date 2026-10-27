import assert from "node:assert/strict";
import { test } from "node:test";
import { getDmarcHosts, getDmarcStatus } from "../lib/dmarc-rules.js";
import { getDomainSetup } from "../lib/domain-records.js";

test("DMARC is looked up on the domain, then on its parents up to the last two labels, from four labels at most", () => {
	assert.deepEqual(getDmarcHosts("example.com"), ["example.com"]);
	assert.deepEqual(getDmarcHosts("news.example.com"), ["news.example.com", "example.com"]);
	assert.deepEqual(getDmarcHosts("mail.example.co.uk"), ["mail.example.co.uk", "example.co.uk", "co.uk"]);
	assert.deepEqual(getDmarcHosts("a.b.c.d.example.com"), ["a.b.c.d.example.com", "c.d.example.com", "d.example.com", "example.com"]);
});

test("a DMARC record is read as receivers read it: its strings joined, other TXT records ignored, tags in any case", () => {
	const cases = [
		[[["v=DMARC1; p=none;"]], "found"],
		[[["v=DMARC1; p=quarantine; ", "rua=mailto:reports@example.com"]], "found"],
		[[["google-site-verification=abc123"], ["v=DMARC1; p=reject"]], "found"],
		[[["V=DMARC1;P=Quarantine"]], "found"],
		[[[" v = DMARC1 ; p = none "]], "found"],
		[[["v=DMARC1; rua=mailto:reports@example.com"]], "found"],
		[[["v=DMARC1"]], "invalid"],
		[[["v=DMARC1; p=bogus"]], "invalid"],
		[[["v=dmarc1; p=none"]], "invalid"],
		[[["v=DMARC1; p=none;"], ["v=DMARC1; p=reject;"]], "multiple"],
		[[["v=DMARC10; p=none"]], null],
		[[["v=spf1 include:example.com ~all"]], null],
		[[["p=none; v=DMARC1"]], null],
		[[], null],
	];
	for (const [records, status] of cases) assert.equal(getDmarcStatus(records), status, JSON.stringify(records));
});

test("the DMARC row says what the last check found, and names the parent domain whose record covers it", () => {
	const domain = { domain: "news.example.com", mailFromDomain: "rp.news.example.com", records: [] };
	const dmarc = (fields) => getDomainSetup({ ...domain, ...fields }).find(({ key }) => key === "dmarc").status;
	assert.deepEqual(dmarc({}), { label: "Recommended", tone: "none" }, "never looked up");
	assert.deepEqual(dmarc({ dmarc: { status: "missing" } }), { label: "Recommended", tone: "none" });
	assert.deepEqual(dmarc({ dmarc: { status: "found", host: "news.example.com" } }), { label: "Found", tone: "good" });
	assert.deepEqual(dmarc({ dmarc: { status: "found", host: "example.com" } }), { label: "Found on example.com", tone: "good" });
	assert.deepEqual(dmarc({ dmarc: { status: "multiple", host: "example.com" } }), { label: "More than one record, keep one", tone: "bad" });
	assert.deepEqual(dmarc({ dmarc: { status: "invalid", host: "news.example.com" } }), { label: "Not valid, check the record", tone: "bad" });
});
