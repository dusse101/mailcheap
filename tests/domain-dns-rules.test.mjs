import assert from "node:assert/strict";
import { test } from "node:test";
import {
	getDnsProblemMessage,
	getDnsProblems,
	getRecordLookups,
	getRecordState,
	isDnsStale,
	mergeDnsProblems,
} from "../lib/domain-dns-rules.js";
import { getDomainSetup, getDomainSummary } from "../lib/domain-records.js";
import { resolveFrom, withActiveProvider } from "../lib/sender-rules.js";

const KEY = "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAexample";
const DKIM = { purpose: "dkim", type: "CNAME", name: "ps1._domainkey.example.com", value: "dom_123.customers.postshiba.com" };
const RETURN_PATH = { purpose: "mail-from", type: "CNAME", name: "rp.example.com", value: "rp.postshiba.com" };
const CLOUDFLARE = ["104.21.10.227", "172.67.146.241"];

// What DNS answers for a CNAME's lookups (getRecordLookups), each overridable.
function cnameAnswers(answers = {}) {
	return { cname: [], txt: [], targetTxt: [KEY], addresses: [], ...answers };
}

// A PostShiba domain as lib/domains.js stores it, with MailCheap's last look at its records.
function storedDomain({ verified = true, problems } = {}) {
	return {
		domain: "example.com",
		provider: "postshiba",
		verified,
		dkimStatus: verified ? "SUCCESS" : "PENDING",
		mailFromStatus: verified ? "SUCCESS" : "PENDING",
		mailFromDomain: "rp.example.com",
		records: [DKIM, RETURN_PATH],
		...(problems && { dns: { checkedAt: new Date(), problems } }),
	};
}

test("a CNAME is looked up by name, with its target's TXT records and the name's addresses; an MX or a TXT record by itself", () => {
	assert.deepEqual(getRecordLookups(DKIM), {
		cname: ["ps1._domainkey.example.com", "CNAME"],
		txt: ["ps1._domainkey.example.com", "TXT"],
		targetTxt: ["dom_123.customers.postshiba.com", "TXT"],
		addresses: ["ps1._domainkey.example.com", "A"],
	});
	assert.deepEqual(getRecordLookups({ type: "MX", name: "bounce.example.com" }), { mx: ["bounce.example.com", "MX"] });
	assert.deepEqual(getRecordLookups({ type: "TXT", name: "bounce.example.com" }), { txt: ["bounce.example.com", "TXT"] });
});

test("a CNAME is found when it points at its target, or when its name answers with the target's records", () => {
	assert.equal(getRecordState(DKIM, cnameAnswers({ cname: ["dom_123.customers.postshiba.com"] })), "found");
	assert.equal(getRecordState({ ...DKIM, value: "Dom_123.Customers.Postshiba.com." }, cnameAnswers({ cname: ["dom_123.customers.postshiba.com"] })), "found");
	assert.equal(getRecordState(DKIM, cnameAnswers({ txt: [KEY], addresses: [] })), "found", "flattened, or the key copied in");
	assert.equal(getRecordState(DKIM, cnameAnswers({ txt: [KEY], addresses: CLOUDFLARE })), "found", "flattened to a target with addresses");
});

test("Cloudflare's proxy answers with its addresses and nothing else: proxied; nothing at all is missing; anything else is different", () => {
	assert.equal(getRecordState(DKIM, cnameAnswers({ addresses: CLOUDFLARE })), "proxied");
	assert.equal(getRecordState(DKIM, cnameAnswers()), "missing");
	assert.equal(getRecordState(DKIM, cnameAnswers({ cname: ["other.example.net"] })), "different");
	assert.equal(getRecordState(DKIM, cnameAnswers({ txt: ["v=DKIM1; p=an-old-key"] })), "different");
});

test("a lookup that failed says nothing, so the record keeps its last state", () => {
	assert.equal(getRecordState(DKIM, cnameAnswers({ cname: null })), null);
	assert.equal(getRecordState(DKIM, cnameAnswers({ txt: null })), null);
	assert.equal(getRecordState(DKIM, cnameAnswers({ targetTxt: null })), null);
	assert.equal(getRecordState(DKIM, cnameAnswers({ addresses: null })), null);
	assert.equal(getRecordState(DKIM, cnameAnswers({ cname: ["dom_123.customers.postshiba.com"], addresses: null })), "found", "unless it isn't needed");

	const previous = [{ purpose: "dkim", type: "CNAME", name: "PS1._domainkey.example.com.", state: "proxied" }];
	assert.deepEqual(mergeDnsProblems([DKIM, RETURN_PATH], [null, "found"], previous), [
		{ purpose: "dkim", type: "CNAME", name: "ps1._domainkey.example.com", state: "proxied" },
	]);
	assert.deepEqual(mergeDnsProblems([DKIM, RETURN_PATH], [null, null], []), [], "a record never seen wrong stays found");
	assert.deepEqual(mergeDnsProblems([DKIM, RETURN_PATH], ["found", "missing"], previous), [
		{ purpose: "mail-from", type: "CNAME", name: "rp.example.com", state: "missing" },
	]);
});

test("an MX or an SPF record only counts when nothing is there; a DKIM key in a TXT record has to match", () => {
	const mx = { purpose: "mail-from", type: "MX", name: "bounce.example.com", value: "10 feedback-smtp.us-east-1.amazonses.com" };
	assert.equal(getRecordState(mx, { mx: ["feedback-smtp.us-east-1.amazonses.com"] }), "found");
	assert.equal(getRecordState(mx, { mx: ["mx.example.net"] }), "found", "the customer's own choice");
	assert.equal(getRecordState(mx, { mx: [] }), "missing");
	assert.equal(getRecordState(mx, { mx: null }), null);

	const spf = { purpose: "mail-from", type: "TXT", name: "bounce.example.com", value: "v=spf1 include:amazonses.com ~all" };
	assert.equal(getRecordState(spf, { txt: ["v=spf1 include:amazonses.com -all"] }), "found");
	assert.equal(getRecordState(spf, { txt: [] }), "missing");

	const key = { purpose: "dkim", type: "TXT", name: "ps1._domainkey.example.com", value: KEY };
	assert.equal(getRecordState(key, { txt: [KEY.replaceAll("; ", ";")] }), "found", "spaces aside");
	assert.equal(getRecordState(key, { txt: ["v=DKIM1; p=an-old-key"] }), "different");
	assert.equal(getRecordState(key, { txt: [] }), "missing");
});

test("problems count on the records the domain has now; while it's being verified, a record not there yet isn't one", () => {
	const problems = [
		{ purpose: "dkim", type: "CNAME", name: DKIM.name, state: "proxied" },
		{ purpose: "mail-from", type: "CNAME", name: RETURN_PATH.name, state: "missing" },
		{ purpose: "dkim", type: "CNAME", name: "old._domainkey.example.com", state: "missing" },
	];
	assert.deepEqual(getDnsProblems(storedDomain({ problems })).map(({ state }) => state), ["proxied", "missing"]);
	assert.deepEqual(getDnsProblems(storedDomain({ verified: false, problems })).map(({ state }) => state), ["proxied"]);
	assert.deepEqual(getDnsProblems(storedDomain()), []);
});

test("a verified domain with a problem can't send, and says which records and how to fix them", () => {
	const problems = [
		{ purpose: "dkim", type: "CNAME", name: DKIM.name, state: "proxied" },
		{ purpose: "mail-from", type: "CNAME", name: RETURN_PATH.name, state: "proxied" },
	];
	const domain = withActiveProvider(storedDomain({ problems }), "postshiba");
	assert.equal(domain.verified, false);
	assert.equal(
		getDnsProblemMessage("example.com", domain.dnsProblems),
		"example.com's signature (DKIM) and return path records are behind a proxy, which hides them from inboxes. On Cloudflare, set them to DNS only."
	);
	assert.deepEqual(resolveFrom({ newsletter: { fromEmail: "hi@example.com", slug: "news" }, domains: [domain], providerId: "postshiba" }), {
		problem:
			"example.com's signature (DKIM) and return path records are behind a proxy, which hides them from inboxes. On Cloudflare, set them to DNS only. Then click Check now on the Domains page.",
	});
	assert.deepEqual(getDomainSummary(domain), { label: "Records need a fix", tone: "bad" });
	assert.deepEqual(
		getDomainSetup(domain).map(({ key, status }) => [key, status.label]),
		[
			["dkim", "Behind a proxy, set it to DNS only"],
			["mail-from", "Behind a proxy, set it to DNS only"],
			["dmarc", "Recommended"],
		]
	);

	const fine = withActiveProvider(storedDomain({ problems: [] }), "postshiba");
	assert.equal(fine.verified, true);
	assert.deepEqual(resolveFrom({ newsletter: { fromEmail: "hi@example.com", slug: "news" }, domains: [fine], providerId: "postshiba" }), {
		identity: "example.com",
		replyTo: undefined,
		isShared: false,
	});
	assert.equal(withActiveProvider(storedDomain({ problems: [] }), "ses").verified, false, "at another provider, as before");
});

test("each kind of problem says what to do", () => {
	const one = (state) => getDnsProblemMessage("example.com", [{ purpose: "mail-from", type: "CNAME", name: RETURN_PATH.name, state }]);
	assert.equal(one("proxied"), "example.com's return path record is behind a proxy, which hides it from inboxes. On Cloudflare, set it to DNS only.");
	assert.equal(one("different"), "example.com's return path record doesn't match the Domains page. Copy it again from there.");
	assert.equal(one("missing"), "example.com's return path record isn't in its DNS anymore. Add it back.");
	const dkim = [1, 2, 3].map((index) => ({ purpose: "dkim", type: "CNAME", name: `tok${index}._domainkey.example.com`, state: "missing" }));
	assert.equal(getDnsProblemMessage("example.com", dkim), "example.com's signature (DKIM) records aren't in its DNS anymore. Add them back.");
	assert.equal(getDnsProblemMessage("example.com", []), null);
});

test("a look is stale after its minutes, or when there was none", () => {
	const now = Date.parse("2026-10-25T12:00:00Z");
	assert.equal(isDnsStale({}, 60, now), true);
	assert.equal(isDnsStale({ dns: { checkedAt: new Date(now - 59 * 60_000) } }, 60, now), false);
	assert.equal(isDnsStale({ dns: { checkedAt: new Date(now - 60 * 60_000) } }, 60, now), true);
});
