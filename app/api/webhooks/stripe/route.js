import { NextResponse } from "next/server";
import { sendAlert } from "@/lib/alerts";
import { handleStripeEvent } from "@/lib/billing";
import { isCloud } from "@/lib/config";
import { siteExtensions } from "@/lib/site-extensions";
import { getStripe, isStripeConfigured } from "@/lib/stripe";

function reply(status, body) {
	return NextResponse.json(body, { status });
}

// Stripe signs every event with the endpoint's secret. A 5xx makes Stripe retry; every handler is safe
// to run again.
export async function POST(request) {
	if (!isCloud()) return reply(404, { error: "Billing is off on this server" });
	const secret = process.env.STRIPE_WEBHOOK_SECRET;
	if (!secret || !isStripeConfigured()) return reply(503, { error: "Stripe webhooks are not configured" });

	const body = await request.text();
	let event;
	try {
		event = getStripe().webhooks.constructEvent(body, request.headers.get("stripe-signature") ?? "", secret);
	} catch {
		return reply(400, { error: "Invalid signature" });
	}

	try {
		const billing = await handleStripeEvent(event);
		return reply(200, { received: true, ...billing, ...(await siteExtensions.onStripeEvent(event)) });
	} catch (error) {
		console.error(`[stripe-webhook] ${event.type} ${event.id} failed:`, error);
		await sendAlert({
			accountId: null,
			key: `stripe-webhook-failed:${event.type}`,
			title: "Stripe event not handled",
			detail: `${event.type} ${event.id}: ${String(error?.message ?? error).slice(0, 300)}.`,
			action: "Stripe retries it for 3 days; until then an account's plan can be out of date. Check the logs.",
			link: "https://dashboard.stripe.com/webhooks",
		});
		return reply(500, { error: "Could not handle the event" });
	}
}
