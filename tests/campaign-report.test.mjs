import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { default: CampaignReport } = await import("../components/CampaignReport.jsx");

const STATS = { recipients: 1000, sent: 1000, delivered: 990, opened: 462, clicked: 70, bounced: 10, complained: 1, unsubscribed: 4 };

function renderReport(props = {}) {
	return renderToStaticMarkup(
		createElement(CampaignReport, {
			campaign: { _id: "6ad87a2affc219b3be2cc72c", subject: "Hello", status: "sent", format: "markdown", markdown: "Hi", stats: STATS },
			newsletter: { name: "Weekly", fromName: "Weekly", fromEmail: "hi@example.com" },
			providers: [],
			links: null,
			comparison: { isSettled: true, issues: 3, delta: { opened: 0.042, clicked: -0.004 }, average: { opened: 0.42, clicked: 0.074 } },
			timeZone: "UTC",
			...props,
		})
	);
}

const card = (label) => `>${label}</span>`;

test("the report's cards are delivered, opened, clicked, bounced and unsubscribed, with complaints only for an admin", () => {
	const owner = renderReport();
	const cards = ["Delivered", "Opened", "Clicked", "Bounced", "Unsubscribed"].map((label) => owner.indexOf(card(label)));
	assert.ok(cards.every((index, position) => index > (cards[position - 1] ?? -1)), "all five, in that order");
	assert.ok(!owner.includes(card("Complaints")), "the owner sees complaints by inbox instead");

	const admin = renderReport({ readOnly: true });
	assert.ok(admin.indexOf(card("Bounced")) < admin.indexOf(card("Complaints")));
	assert.ok(admin.indexOf(card("Complaints")) < admin.indexOf(card("Unsubscribed")));
});

test("the report's links come below its results by inbox", () => {
	const html = renderReport({
		providers: [{ provider: "gmail", sent: 600, delivered: 595, opened: 300, clicked: 50, bounced: 5, complained: 0 }],
		links: { links: [{ key: "post", url: "https://example.com/post", clickers: 40, clicks: 50 }], clickers: 40, isComplete: true },
	});
	const inbox = html.indexOf(">Inbox</th>");
	assert.ok(inbox > -1, "the inbox table shows");
	assert.ok(html.indexOf(">Link</th>") > inbox, "the links table follows it");
});

test("Gmail's row in the inbox table shows Gmail's logo, and other inboxes their favicon", () => {
	const html = renderReport({
		providers: [
			{ provider: "gmail", sent: 600, delivered: 595, opened: 300, clicked: 50, bounced: 5, complained: 0 },
			{ provider: "outlook", sent: 400, delivered: 395, opened: 162, clicked: 20, bounced: 5, complained: 1 },
		],
	});
	assert.ok(html.includes('<svg viewBox="52 42 88 66" width="16" height="16"'), "Gmail's own logo");
	assert.ok(!html.includes("s2/favicons?domain=gmail.com"), "the favicon service answers gmail.com with Google's G");
	assert.ok(html.includes("s2/favicons?domain=outlook.com&amp;"));
});

const HOUR_MS = 3_600_000;
const inHours = (hours) => new Date(Date.now() + hours * HOUR_MS - 60_000).toISOString();
const sending = (campaign) => ({
	_id: "6ad87a2affc219b3be2cc72c",
	subject: "Hello",
	format: "markdown",
	markdown: "Hi",
	stats: { ...STATS, sent: 200 },
	...campaign,
});
const restart = { day: 1, intoDayMs: 0, waitMs: 4 * HOUR_MS, firstDay: 500, days: 3, isGradual: true, sentToday: 0, inFlight: 0, hasStarted: true, domain: "news.example.com" };

test("a first send going out in steps says which step it's on, what comes next and when, and why", () => {
	const html = renderReport({
		campaign: sending({ status: "sending", firstSend: { steps: [200, 467, 8668], step: 2, slice: 200, held: 8668, checkAt: inHours(0.4) } }),
		newsletter: { name: "Weekly", fromName: "Weekly", fromEmail: "hi@example.com", sendingDomain: "news.example.com" },
		gmail: { waiting: 5600, later: 0, laterAt: null },
	});
	assert.match(html, /New contacts get it in steps: 2 of 3/);
	assert.match(html, /role="progressbar"[^>]*aria-valuenow="2"/);
	assert.match(html, /200 first \(2%\)/);
	assert.match(html, /467 more \(5%\), 30 minutes later/);
	assert.match(html, /The other 8,668, in about 23 minutes/, "the step coming next, and when");
	assert.match(html, /To keep your emails out of spam/);
	assert.match(html, /It&#x27;s only the first time/);
	assert.match(html, /href="\/help\/sending#first-send"/);
	assert.doesNotMatch(html, /Gmail readers/, "nothing about Gmail while none wait for another day");

	const legacy = renderReport({ campaign: sending({ status: "sending", firstSend: { slice: 200, held: 800, checkAt: inHours(2) } }) });
	assert.match(legacy, /New contacts get it in steps: 1 of 2/, "a send from before had one slice");
	assert.match(legacy, /The other 800, in about 2 hours/);

	const done = renderReport({ campaign: sending({ status: "sending", firstSend: { steps: [200, 467, 8668], step: 3, checkedAt: inHours(-1) } }) });
	assert.doesNotMatch(done, /get it in steps/, "past its last step");
});

test("a send in steps whose Gmail readers also wait for the next day says both, apart, each with why", () => {
	const html = renderReport({
		campaign: sending({ status: "sending", firstSend: { steps: [1000, 5000, 194000], step: 2, checkAt: inHours(0.4) } }),
		newsletter: { name: "Weekly", fromName: "Weekly", fromEmail: "hi@example.com", sendingDomain: "news.example.com" },
		gmail: { waiting: 80000, later: 400, laterAt: inHours(20) },
	});
	assert.match(html, /New contacts get it in steps: 2 of 3/);
	assert.match(html, /1,000 first \(0\.5%\)/, "a capped first step, a fraction of a percent of a large list");
	assert.match(html, /Some Gmail readers get it tomorrow/);
	assert.match(html, /The other 400 Gmail readers get it in about 20 hours\./);
	assert.match(html, /href="\/help\/sending#first-send"/);
	assert.match(html, /href="\/help\/warm-up#new-domain"/);
	assert.ok(html.indexOf("New contacts get it in steps") < html.indexOf("Some Gmail readers get it tomorrow"), "the steps first");
});

test("a send's Gmail readers its new domain sends the next day say so, with the domain", () => {
	const html = renderReport({
		campaign: sending({ status: "sending", sendingUntil: inHours(20) }),
		newsletter: { name: "Weekly", fromName: "Weekly", fromEmail: "hi@example.com", sendingDomain: "news.example.com" },
		gmail: { waiting: 4103, later: 4103, laterAt: inHours(20) },
	});
	assert.match(html, /Some Gmail readers get it tomorrow/);
	assert.match(html, /news\.example\.com/);
	assert.match(html, /The other 4,103 Gmail readers get it in about 20 hours\./);
	assert.match(html, /Gmail is careful with the first emails from a new domain/);
	assert.match(html, /href="\/help\/warm-up#new-domain"/);
});

test("a send Gmail paused says when it starts again, in the same look", () => {
	const campaign = sending({
		status: "paused",
		pauseCode: "rate_limited",
		pauseReason: "Gmail asked to slow down, so this newsletter's sends wait 6 hours, then go on by themselves, more slowly at first",
	});
	// Read only: without its buttons, whose tooltips need the dashboard's provider.
	const html = renderReport({ campaign, readOnly: true, pace: { sender: restart }, gmail: { waiting: 800, later: 0, laterAt: null } });
	assert.match(html, /Paused: Gmail asked to slow down/);
	assert.match(html, /Gmail gets it again in 4 hours: 500 of your Gmail readers that day\./);
	assert.match(html, /Next: the other 300 tomorrow\./);
	assert.match(html, /href="\/help\/warm-up#gmail"/);
	assert.doesNotMatch(html, /Paused: Gmail asked to slow down, so/, "not the look of a pause that needs something from its owner");

	const withoutPace = renderReport({ campaign, readOnly: true, pace: null });
	assert.match(withoutPace, /this newsletter&#x27;s sends wait 6 hours/, "the reason, when the domain's pace isn't there to say it");
});

test("the report compares opens and clicks with the average in percent, never in points", () => {
	const html = renderReport();
	assert.ok(html.includes("+4.2%"));
	assert.ok(html.includes("−0.4%"));
	assert.ok(!/\bpts\b/.test(html));
});
