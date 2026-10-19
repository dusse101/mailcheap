"use server";

import { keepContact } from "@/lib/contacts";
import { connectDb } from "@/lib/db";
import { verifyKeepToken } from "@/lib/last-chance";
import { findNewsletterAnywhere } from "@/lib/public-newsletters";

// The page's button posts to /api/keep, which checks the origin and the rate limit, then calls this.
// Opening the link never gets here, so a scanner that only fetches the URL changes nothing.
export async function keepSending(token) {
	const reference = verifyKeepToken(token);
	if (!reference) return { error: "invalid" };

	await connectDb();
	const newsletter = await findNewsletterAnywhere({ _id: reference.newsletterId });
	const contact = newsletter && (await keepContact({ accountId: newsletter.accountId, ...reference }));
	return contact ? { ok: true } : { error: "invalid" };
}
