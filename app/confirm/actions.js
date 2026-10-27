"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { isSendingEnabled } from "@/lib/config";
import { verifyConfirmToken } from "@/lib/confirmation";
import { confirmContact } from "@/lib/contacts";
import { readCountry } from "@/lib/countries";
import { connectDb } from "@/lib/db";
import { findOpenNewsletter } from "@/lib/public-newsletters";
import { queueWelcomeEmail } from "@/lib/sending";

export async function confirmSubscription(token) {
	const reference = verifyConfirmToken(token);
	if (!reference) return { error: "invalid" };

	await connectDb();
	const newsletter = await findOpenNewsletter({ _id: reference.newsletterId });
	if (!newsletter) return { error: "invalid" };
	const { contact, confirmed } = await confirmContact({ accountId: newsletter.accountId, ...reference, country: readCountry(await headers()) });
	if (contact?.status !== "active") return { error: "invalid" };

	if (confirmed && isSendingEnabled()) {
		// Skipped while the newsletter confirms signups: the confirmation was their one email.
		after(() =>
			queueWelcomeEmail({ newsletter, contact }).catch((error) =>
				console.error(`[confirm] Welcome email for ${contact._id} failed:`, error.message)
			)
		);
	}
	return { ok: true };
}
