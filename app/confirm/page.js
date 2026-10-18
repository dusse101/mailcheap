import { Link2Off } from "lucide-react";
import CardNotice from "@/components/CardNotice";
import FormConfirm from "@/components/FormConfirm";
import FormConfirmBrand from "@/components/FormConfirmBrand";
import { PageBrandConfirmClosed, PageBrandConfirmInvalid } from "@/components/PageBrand";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { verifyConfirmToken } from "@/lib/confirmation";
import { connectDb } from "@/lib/db";
import { brandTitle, getPublicBrand } from "@/lib/public-brand";
import { findOpenNewsletter } from "@/lib/public-newsletters";
import Contact from "@/models/Contact";

// The URL carries the confirmation token: keep it out of search results and referrer headers.
// strict-origin, not no-referrer: no-referrer makes browsers send Origin: null on the button's POST, and that POST is
// refused. strict-origin still leaves the query, and the token, out of Referer.
export function generateMetadata() {
	const brand = getPublicBrand();
	const title = "Confirm your subscription";
	return {
		title: brand ? brandTitle(brand, title) : title,
		robots: { index: false, follow: false },
		referrer: "strict-origin",
	};
}

export default async function ConfirmPage({ searchParams }) {
	const { token } = await searchParams;
	const validToken = typeof token === "string" ? token : null;
	const reference = verifyConfirmToken(validToken);
	const newsletter = reference ? await getNewsletter(reference.newsletterId) : null;
	const lookup = newsletter ? await getContact(newsletter, reference.contactId) : null;
	const outcome = confirmOutcome(newsletter, lookup);
	const brand = getPublicBrand();

	if (brand) {
		if (outcome === "form" || outcome === "done") {
			return <FormConfirmBrand brand={brand} token={validToken} fromEmail={newsletter.fromEmail} outcome={outcome} />;
		}
		return outcome === "closed" ? <PageBrandConfirmClosed brand={brand} /> : <PageBrandConfirmInvalid brand={brand} />;
	}

	return (
		<main className="flex min-h-dvh items-center justify-center bg-background px-4 py-16">
			{outcome === "form" || outcome === "done" ? (
				<FormConfirm
					token={validToken}
					newsletterName={newsletter.name}
					fromName={newsletter.fromName}
					fromEmail={newsletter.fromEmail}
					archiveUrl={newsletter.archiveEnabled ? getArchiveUrls(newsletter).siteIndex : null}
					outcome={outcome}
				/>
			) : outcome === "closed" ? (
				<CardNotice icon={Link2Off} title="This link doesn't work">
					{"This address isn't waiting to confirm. Sign up again and use the newest confirmation email."}
				</CardNotice>
			) : (
				<CardNotice icon={Link2Off} title="This link doesn't work">
					It may be older than 30 days. Sign up again and use the newest confirmation email.
				</CardNotice>
			)}
		</main>
	);
}

// Opening the link never confirms. pending: the button. active or dormant: they already confirmed, including after a
// refresh; dormant is still on the list, and only the keep link or signing up again brings it back to active.
// Anything else (left, bounced, complained, gone): no button, so it can't look like a way back on.
const CONFIRMED_STATUSES = ["active", "dormant"];

function confirmOutcome(newsletter, lookup) {
	if (!newsletter) return "invalid";
	if (lookup?.failed) return "form";
	if (lookup?.contact?.status === "pending") return "form";
	if (CONFIRMED_STATUSES.includes(lookup?.contact?.status)) return "done";
	return "closed";
}

async function getNewsletter(newsletterId) {
	try {
		await connectDb();
		return await findOpenNewsletter({ _id: newsletterId });
	} catch (error) {
		console.error("[confirm] Could not load the newsletter:", error.message);
		return null;
	}
}

async function getContact(newsletter, contactId) {
	try {
		await connectDb();
		const contact = await Contact.findOne({ accountId: newsletter.accountId, _id: contactId, newsletterId: newsletter._id })
			.select({ status: 1 })
			.lean();
		return { contact };
	} catch (error) {
		console.error("[confirm] Could not load the contact:", error.message);
		return { failed: true };
	}
}
