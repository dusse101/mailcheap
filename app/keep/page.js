import { Link2Off } from "lucide-react";
import CardNotice from "@/components/CardNotice";
import FormKeep from "@/components/FormKeep";
import FormKeepBrand from "@/components/FormKeepBrand";
import { PageBrandKeepClosed, PageBrandKeepInvalid } from "@/components/PageBrand";
import StyleTheme from "@/components/StyleTheme";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { getLastSignOfLife } from "@/lib/cleanup";
import { connectDb } from "@/lib/db";
import { verifyKeepToken } from "@/lib/last-chance";
import { brandTitle, getPublicBrand } from "@/lib/public-brand";
import { findNewsletterAnywhere } from "@/lib/public-newsletters";
import Contact from "@/models/Contact";
import Suppression from "@/models/Suppression";

// The URL carries the keep token: keep it out of search results and referrer headers.
// strict-origin, not no-referrer: no-referrer makes browsers send Origin: null on the button's POST, and that POST is
// refused. strict-origin still leaves the query, and the token, out of Referer.
export function generateMetadata() {
	const brand = getPublicBrand();
	const title = "Keep getting the newsletter";
	return {
		title: brand ? brandTitle(brand, title) : title,
		robots: { index: false, follow: false },
		referrer: "strict-origin",
	};
}

export default async function KeepPage({ searchParams }) {
	const { token } = await searchParams;
	const validToken = typeof token === "string" ? token : null;
	const reference = verifyKeepToken(validToken);
	const newsletter = reference ? await getNewsletter(reference.newsletterId) : null;
	const lookup = newsletter ? await getContact(newsletter, reference.contactId) : null;
	const outcome = keepOutcome(newsletter, lookup);
	const brand = getPublicBrand();

	if (brand) {
		if (outcome === "form" || outcome === "done") {
			return (
				<FormKeepBrand
					brand={brand}
					token={outcome === "form" ? validToken : null}
					fromEmail={newsletter.fromEmail}
					outcome={outcome}
				/>
			);
		}
		return outcome === "closed" ? <PageBrandKeepClosed brand={brand} /> : <PageBrandKeepInvalid brand={brand} />;
	}

	const archiveUrl = newsletter?.archiveEnabled ? getArchiveUrls(newsletter).siteIndex : null;

	return (
		<main className="flex min-h-dvh items-center justify-center bg-background px-4 py-16">
			<StyleTheme theme={newsletter?.theme} />
			{outcome === "invalid" ? (
				<CardNotice icon={Link2Off} title="This link doesn't work">
					It may be older than 90 days. Sign up again to keep getting the newsletter.
				</CardNotice>
			) : (
				<FormKeep
					token={outcome === "form" ? validToken : null}
					newsletterName={newsletter.name}
					archiveUrl={archiveUrl}
					outcome={outcome}
				/>
			)}
		</main>
	);
}

// Opening the link never keeps. active and already answered (a sign of life after the last-chance email, or no
// last-chance email at all): they're staying, including after a refresh. dormant: the button brings them back,
// unless the address is suppressed. Anything else (left, bounced, complained, gone): no button.
const KEEPABLE_STATUSES = ["active", "dormant"];

function keepOutcome(newsletter, lookup) {
	if (!newsletter) return "invalid";
	if (lookup?.failed) return "form";
	const contact = lookup?.contact;
	if (!contact || !KEEPABLE_STATUSES.includes(contact.status)) return "closed";
	if (contact.status === "dormant") return lookup.suppressed ? "closed" : "form";
	if (!contact.lastChanceAt || getLastSignOfLife(contact) > new Date(contact.lastChanceAt).getTime()) return "done";
	return "form";
}

async function getNewsletter(newsletterId) {
	try {
		await connectDb();
		return await findNewsletterAnywhere({ _id: newsletterId });
	} catch (error) {
		console.error("[keep] Could not load the newsletter:", error.message);
		return null;
	}
}

async function getContact(newsletter, contactId) {
	try {
		await connectDb();
		const contact = await Contact.findOne({ accountId: newsletter.accountId, _id: contactId, newsletterId: newsletter._id })
			.select({
				email: 1,
				status: 1,
				lastEngagedAt: 1,
				lastOpenAt: 1,
				lastClickAt: 1,
				confirmedAt: 1,
				subscribedAt: 1,
				createdAt: 1,
				lastChanceAt: 1,
			})
			.lean();
		if (!contact) return { contact: null };
		const suppressed =
			contact.status === "dormant" &&
			Boolean(await Suppression.exists({ accountId: newsletter.accountId, email: contact.email }));
		return { contact, suppressed };
	} catch (error) {
		console.error("[keep] Could not load the contact:", error.message);
		return { failed: true };
	}
}
