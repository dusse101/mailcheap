import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { createElement } from "react";
import { prerenderToNodeStream } from "react-dom/static";
import { activate, as, callApi, catchRedirect, form, listPlanPrices, mockStripe, readLookupKeys, signIn, startTestApp } from "./helpers/app.mjs";

// Which plans MailCheap offers comes from Stripe: a plan shows on the pricing pages, the paywall and billing, and can be
// picked, only once Stripe has both of its prices at lib/plans.js's amounts. This Stripe starts with the five plans
// MailCheap had before Ultra, then Ultra's prices arrive. The tests run in order: lib/stripe.js keeps what it read.
let app;
let m;
let calls;
let stripeState = "without ultra";

async function stripeApi({ method, path, query, body }) {
	calls.push({ method, path, query, body });
	if (stripeState === "down") return { status: 400, error: { type: "invalid_request_error", message: "Stripe is having a bad day" } };
	if (method === "GET" && path === "/v1/prices") {
		const list = await listPlanPrices(query);
		return { ...list, data: list.data.filter(({ lookup_key }) => stripeState === "with ultra" || !lookup_key.startsWith("mailcheap_ultra_")) };
	}
	if (method === "POST" && path === "/v1/checkout/sessions") return { id: "cs_sale", object: "checkout.session", url: "https://checkout.stripe.com/c/pay/cs_sale" };
	return { status: 404, error: { type: "invalid_request_error", message: `No mock for ${method} ${path}` } };
}

function priceLists() {
	return calls.filter(({ method, path }) => method === "GET" && path === "/v1/prices");
}

// The clock that many minutes ahead while run runs: lib/stripe.js reads the plans again once its 10 minutes are up.
async function later(minutes, run) {
	const now = Date.now;
	Date.now = () => now() + minutes * 60_000;
	try {
		return await run();
	} finally {
		Date.now = now;
	}
}

// Prerendered as Next.js builds a page, without the comments React puts between neighboring texts.
async function render(Component, props) {
	const { prelude } = await prerenderToNodeStream(createElement(Component, props));
	let html = "";
	for await (const chunk of prelude) html += chunk;
	return html.replaceAll("<!-- -->", "");
}

async function createKey(user) {
	const { createApiKey } = await import("../app/(app)/api-keys/actions.js");
	return as(user, () => createApiKey(null, form({ name: "Plans" })));
}

const checkout = (user, plan) => as(user, () => catchRedirect(m.checkoutRoute.GET(new Request(`http://localhost:3000/billing/checkout?plan=${plan}&interval=year`))));

before(async () => {
	app = await startTestApp();
	m = {
		billing: await import("../app/(account)/billing/actions.js"),
		checkoutRoute: await import("../app/(account)/billing/checkout/route.js"),
		onboarding: await import("../lib/onboarding.js"),
		plans: await import("../lib/plans.js"),
		pricing: await import("../lib/pricing.js"),
		stripe: await import("../lib/stripe.js"),
		siteExtensions: (await import("@/lib/site-extensions")).siteExtensions,
		ListPricing: (await import("../components/ListPricing.jsx")).default,
		BannerPlan: (await import("../components/BannerPlan.jsx")).default,
	};
});

beforeEach(() => {
	calls = [];
	mockStripe(stripeApi);
});

after(() => app?.stop());

describe("Ultra without its prices in Stripe", () => {
	test("is nowhere: not on the slider, the banner, the recommendation or get_billing, and Checkout refuses it", async () => {
		const plans = await m.stripe.findPlansOnSale();
		assert.deepEqual(plans.map(({ id }) => id), ["starter", "growth", "pro", "scale", "max"]);
		assert.deepEqual(
			priceLists().flatMap(({ query }) => readLookupKeys(query)),
			m.plans.PLANS.flatMap(({ id }) => [`mailcheap_${id}_monthly`, `mailcheap_${id}_yearly`]),
			"every plan's two prices"
		);
		assert.equal(priceLists().length, 2, "Stripe takes 10 lookup keys a request: two for all twelve");

		const pricing = m.pricing.getPricing("ultra", plans);
		assert.deepEqual(pricing.plans.map(({ id }) => id), ["starter", "growth", "pro", "scale", "max"]);
		assert.equal(pricing.initialIndex, 0, "a plan that isn't on sale doesn't start the slider");
		const slider = await render(m.ListPricing, {});
		assert.ok(slider.includes("$349") && slider.includes('aria-label="2,000,000 emails a month"'), "Max is the last step");
		assert.ok(!slider.includes("$799") && !slider.includes('aria-label="5,000,000 emails a month"'), "Ultra isn't a step");
		assert.equal(slider.includes("More than 2,000,000 emails?"), Boolean(m.siteExtensions.supportChatPath), "past Max, the support chat");

		const bigList = { onboarding: { listSize: "more" } };
		assert.equal(m.onboarding.getRecommendedPlanId(bigList, plans), "max", "Over 100,000 gets Max");
		assert.match(await render(m.BannerPlan, { account: bigList, plans }), /Max fits your list, at \$349 a month/);

		const buyer = await signIn("no-ultra@example.com");
		assert.equal(await checkout(buyer, "ultra"), "/billing?interval=year", "the plan buttons lead to billing");
		assert.equal(await as(buyer, () => catchRedirect(m.billing.choosePlan(form({ plan: "ultra", interval: "year" })))), "/billing");
		assert.equal(calls.some(({ path }) => path === "/v1/checkout/sessions"), false, "nothing reached Checkout");

		const paying = await signIn("no-ultra-api@example.com");
		await activate(paying);
		const { key } = await createKey(paying);
		const billing = await callApi("GET", "/api/v1/billing", { key });
		assert.deepEqual(billing.body.plans.map(({ id }) => id), ["starter", "growth", "pro", "scale", "max"]);
		const change = await callApi("POST", "/api/v1/billing/change-plan", { key, body: { plan: "ultra", interval: "year" } });
		assert.equal(change.status, 400);
		assert.deepEqual(change.body.error, { code: "validation_failed", message: "plan: Ultra isn't on sale yet. get_billing lists the plans on sale" });
		assert.equal(priceLists().length, 2, "Stripe was read once for all of it");
	});

	test("when Stripe can't be read, every plan shows for a minute, and Checkout still refuses a price it can't find", async () => {
		stripeState = "down";
		const logged = [];
		const error = console.error;
		console.error = (...args) => logged.push(args.join(" "));
		try {
			const plans = await later(11, () => m.stripe.findPlansOnSale());
			assert.deepEqual(plans.map(({ id }) => id), m.plans.PLAN_IDS);
			assert.equal(priceLists().length, 1);
			assert.deepEqual(await m.stripe.findPlansOnSale(), plans, "kept for a minute");
			assert.equal(priceLists().length, 1);

			const buyer = await signIn("stripe-down@example.com");
			assert.equal(await checkout(buyer, "ultra"), "/billing?interval=year&error=stripe");
			assert.equal(calls.some(({ path }) => path === "/v1/checkout/sessions"), false);
		} finally {
			console.error = error;
		}
		assert.ok(logged.some((line) => line.includes("Couldn't read the plans' prices from Stripe")));
	});
});

describe("Ultra with its prices in Stripe", () => {
	test("joins the slider as its sixth step within 10 minutes, and its buttons open Checkout", async () => {
		stripeState = "with ultra";
		const plans = await later(13, () => m.stripe.findPlansOnSale());
		assert.deepEqual(plans.map(({ id }) => id), ["starter", "growth", "pro", "scale", "max", "ultra"]);

		const { plans: stops, initialIndex } = m.pricing.getPricing("ultra", plans);
		assert.equal(initialIndex, 5);
		assert.deepEqual(
			stops.map(({ name, emails, emailsShort, subscribers }) => [name, emails, emailsShort, subscribers]),
			[
				["Starter", "20,000", "20K", "10,000"],
				["Growth", "75,000", "75K", "40,000"],
				["Pro", "200,000", "200K", "100,000"],
				["Scale", "500,000", "500K", "250,000"],
				["Max", "2,000,000", "2M", "1,000,000"],
				["Ultra", "5,000,000", "5M", "2,500,000"],
			]
		);
		assert.deepEqual(stops.map(({ prices }) => prices.month.price), ["$19", "$39", "$79", "$149", "$349", "$799"]);
		assert.deepEqual(stops.map(({ prices }) => prices.year.price), ["$190", "$390", "$790", "$1,490", "$3,490", "$7,990"]);
		assert.deepEqual(
			[stops[5].prices.month.perThousand, stops[5].prices.year.perThousand, stops[5].prices.year.monthly],
			["$0.16", "$0.13", "$665.83"]
		);
		assert.equal(stops[5].prices.year.href, "/billing/checkout?plan=ultra&interval=year");
		const bars = stops.map(({ bar }) => bar);
		assert.equal(bars.at(-1), 1);
		assert.ok(bars.every((bar, index) => index === 0 || bar - bars[index - 1] > 0.05), `every bar a step taller: ${bars.join(", ")}`);
		assert.ok(bars[1] > 0.28, "Growth stands above the shortest bar SliderPricing draws");

		const slider = await render(m.ListPricing, {});
		assert.ok(slider.includes("$799") && slider.includes('aria-label="5,000,000 emails a month"'));
		assert.equal(slider.includes("More than 5,000,000 emails?"), Boolean(m.siteExtensions.supportChatPath), "past Ultra, the support chat");
		const bigList = { onboarding: { listSize: "more" } };
		assert.equal(m.onboarding.getRecommendedPlanId(bigList, plans), "max", "Over 100,000 stays on Max, not the largest plan");
		assert.match(await render(m.BannerPlan, { account: bigList, plans }), /Max fits your list, at \$349 a month/);

		const buyer = await signIn("ultra-buyer@example.com");
		assert.equal(await checkout(buyer, "ultra"), "https://checkout.stripe.com/c/pay/cs_sale");
		assert.equal(calls.findLast(({ path }) => path === "/v1/checkout/sessions").body.get("line_items[0][price]"), "price_mailcheap_ultra_yearly");
	});
});
