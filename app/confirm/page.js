import { Link2Off } from "lucide-react";
import CardNotice from "@/components/CardNotice";
import FormConfirm from "@/components/FormConfirm";
import FormConfirmBrand from "@/components/FormConfirmBrand";
import { PageBrandConfirmInvalid } from "@/components/PageBrand";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { verifyConfirmToken } from "@/lib/confirmation";
import { connectDb } from "@/lib/db";
import { brandTitle, getPublicBrand } from "@/lib/public-brand";
import { findOpenNewsletter } from "@/lib/public-newsletters";

// The URL carries the confirmation token: keep it out of search results and referrer headers.
export function generateMetadata() {
	const brand = getPublicBrand();
	const title = "Confirm your subscription";
	return {
		title: brand ? brandTitle(brand, title) : title,
		robots: { index: false, follow: false },
		referrer: "no-referrer",
	};
}

export default async function ConfirmPage({ searchParams }) {
	const { token } = await searchParams;
	const validToken = typeof token === "string" ? token : null;
	const reference = verifyConfirmToken(validToken);
	const newsletter = reference ? await getNewsletter(reference.newsletterId) : null;
	const brand = getPublicBrand();

	if (brand) {
		return newsletter ? (
			<FormConfirmBrand brand={brand} token={validToken} fromEmail={newsletter.fromEmail} />
		) : (
			<PageBrandConfirmInvalid brand={brand} />
		);
	}

	return (
		<main className="flex min-h-dvh items-center justify-center bg-background px-4 py-16">
			{newsletter ? (
				<FormConfirm
					token={validToken}
					newsletterName={newsletter.name}
					fromName={newsletter.fromName}
					fromEmail={newsletter.fromEmail}
					archiveUrl={newsletter.archiveEnabled ? getArchiveUrls(newsletter).siteIndex : null}
				/>
			) : (
				<CardNotice icon={Link2Off} title="This link doesn't work">
					It may be older than 30 days. Sign up again and use the newest confirmation email.
				</CardNotice>
			)}
		</main>
	);
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
