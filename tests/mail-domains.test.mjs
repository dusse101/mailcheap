import assert from "node:assert/strict";
import { test } from "node:test";
import { checkMailDomain, findDomainsWithoutMail } from "../lib/mail-domains.js";

const dnsError = (code) => Object.assign(new Error(code), { code });

// Answers per domain and record type: an array, or an error code to throw.
function fakeDns(answers) {
	const asked = [];
	const lookup = (type) => async (domain) => {
		asked.push(`${type} ${domain}`);
		const answer = answers[domain]?.[type] ?? "ENODATA";
		if (typeof answer === "string") throw dnsError(answer);
		return answer;
	};
	return { asked, resolveMx: lookup("mx"), resolve4: lookup("a"), resolve6: lookup("aaaa") };
}

test("a domain takes email with an MX record, or without one through its own address", async () => {
	const answers = {
		"has-mx.example": { mx: [{ exchange: "mx1.has-mx.example", priority: 10 }] },
		"null-mx.example": { mx: [{ exchange: "", priority: 0 }] },
		"gone.example": { mx: "ENOTFOUND" },
		"a-only.example": { a: ["192.0.2.10"] },
		"aaaa-only.example": { aaaa: ["2001:db8::10"] },
		"nothing.example": {},
		"slow.example": { mx: "ETIMEOUT" },
		"broken-a.example": { a: "ESERVFAIL" },
	};
	const withoutMail = await findDomainsWithoutMail(Object.keys(answers), fakeDns(answers));
	assert.deepEqual([...withoutMail].sort(), ["gone.example", "nothing.example", "null-mx.example"], "DNS trouble keeps the address");
});

test("the list hygiene tells a domain without mail from one DNS couldn't answer for", async () => {
	const dns = fakeDns({
		"has-mx.example": { mx: [{ exchange: "mx1.has-mx.example", priority: 10 }] },
		"null-mx.example": { mx: [{ exchange: "", priority: 0 }] },
		"dot-mx.example": { mx: [{ exchange: ".", priority: 0 }] },
		"gone.example": { mx: "ENOTFOUND" },
		"a-only.example": { a: ["192.0.2.10"] },
		"nothing.example": {},
		"servfail.example": { mx: "ESERVFAIL" },
		"slow.example": { mx: "ETIMEOUT" },
		"refused-a.example": { a: "ECONNREFUSED" },
	});
	const verdicts = {
		"has-mx.example": "ok",
		"null-mx.example": "none",
		"dot-mx.example": "none",
		"gone.example": "none",
		"a-only.example": "ok",
		"nothing.example": "none",
		"servfail.example": "unknown",
		"slow.example": "unknown",
		"refused-a.example": "unknown",
	};
	for (const [domain, verdict] of Object.entries(verdicts)) assert.equal(await checkMailDomain(domain, dns), verdict, domain);
});

test("big mailbox providers aren't looked up, and each domain is looked up once", async () => {
	const dns = fakeDns({ "once.example": { mx: [{ exchange: "mx.once.example", priority: 10 }] } });
	assert.deepEqual([...(await findDomainsWithoutMail(["gmail.com", "Outlook.com", "once.example", "ONCE.example"], dns))], []);
	await findDomainsWithoutMail(["once.example"], dns);
	assert.deepEqual(dns.asked, ["mx once.example"]);
});
