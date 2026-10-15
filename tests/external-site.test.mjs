import assert from "node:assert/strict";
import { test } from "node:test";
import { getExternalIssueUrl, getExternalSiteBase } from "../lib/external-site.js";
import { getIssueWebUrl } from "../lib/sending-rules.js";

process.env.APP_URL = "https://mail.example.com";
const newsletter = { _id: "74f1a2b3c4d5e6f7a8b9c0d2", slug: "taco-and-tell", archiveEnabled: true };
const campaign = { _id: "74f1a2b3c4d5e6f7a8b9c0d3", subject: "Hello", archiveSlug: "hello-there" };
const env = (value) => ({ NEWSLETTER_EXTERNAL_SITES: value });

test("an external site is off unless configured for the newsletter", () => {
	assert.equal(getExternalSiteBase(newsletter, {}), null);
	assert.equal(getExternalSiteBase(newsletter, env("")), null);
	assert.equal(getExternalSiteBase(newsletter, env("not json")), null);
	assert.equal(getExternalSiteBase(newsletter, env('{"other":"https://example.com/issues"}')), null);
	assert.equal(getExternalSiteBase(newsletter, env('{"taco-and-tell":"http://example.com/issues"}')), null, "https only");
	assert.equal(getExternalSiteBase(newsletter, env('{"taco-and-tell":"https://example.com/issues?x=1"}')), null);
	assert.equal(getExternalSiteBase(newsletter, env('["https://example.com"]')), null);
});

test("a configured newsletter links to its own site", () => {
	const sites = env('{"taco-and-tell":"https://tacoandtell.com/issues/"}');
	assert.equal(getExternalSiteBase(newsletter, sites), "https://tacoandtell.com/issues");
	assert.equal(getExternalIssueUrl(newsletter, "hello-there", sites), "https://tacoandtell.com/issues/hello-there");
	assert.equal(getExternalIssueUrl(newsletter, "", sites), null);
});

test("Read online links follow the setting and keep the archive's rules", () => {
	delete process.env.NEWSLETTER_EXTERNAL_SITES;
	assert.equal(getIssueWebUrl({ campaign, newsletter }), "https://mail.example.com/archive/taco-and-tell/p/hello-there");
	process.env.NEWSLETTER_EXTERNAL_SITES = '{"taco-and-tell":"https://tacoandtell.com/issues"}';
	try {
		assert.equal(getIssueWebUrl({ campaign, newsletter }), "https://tacoandtell.com/issues/hello-there");
		assert.equal(getIssueWebUrl({ campaign, newsletter: { ...newsletter, archiveEnabled: false } }), null, "archive off");
		assert.equal(getIssueWebUrl({ campaign: { ...campaign, archiveListed: false }, newsletter }), null, "unlisted");
	} finally {
		delete process.env.NEWSLETTER_EXTERNAL_SITES;
	}
});
