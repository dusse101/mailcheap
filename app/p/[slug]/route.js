import { getArchiveNewsletter } from "@/lib/archive-data";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { connectDb } from "@/lib/db";
import { findNewsletterAnywhere } from "@/lib/public-newsletters";
import { WEB_FILTER } from "@/lib/publish-to";
import Campaign from "@/models/Campaign";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,119}$/;

// Archive domains rewrite /p/slug in proxy.js; on the app's domain the link doesn't name the newsletter,
// and issue slugs are unique across accounts.
export async function GET(request, { params }) {
	const { slug } = await params;
	if (!SLUG_PATTERN.test(slug)) return new Response("Not found", { status: 404 });

	await connectDb();
	const campaign = await Campaign.findOne({ archiveSlug: slug, ...WEB_FILTER })
		.setOptions({ crossAccount: true })
		.select("accountId newsletterId")
		.lean();
	const owner = campaign && (await findNewsletterAnywhere({ accountId: campaign.accountId, _id: campaign.newsletterId }));
	const newsletter = owner && (await getArchiveNewsletter(owner.slug));
	if (!newsletter) return new Response("Not found", { status: 404 });

	return Response.redirect(new URL(getArchiveUrls(newsletter).post(slug), request.url), 307);
}
