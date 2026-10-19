import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import { getArchiveCnameTarget, getSharedDomain, isCloud } from "@/lib/config";
import { getHelpHref, getHelpPageMetadata } from "@/lib/help";

export const metadata = getHelpPageMetadata("website");

export default function WebsitePage() {
	const sharedDomain = getSharedDomain();
	const hasOwnHost = Boolean(getArchiveCnameTarget());

	return (
		<ArticleHelp slug="website">
			<h2 id="website">Your newsletter&apos;s website</h2>
			<p>
				Each newsletter has a public website: a home page with your issues and a signup form, a page for each issue, and an author
				page with your bio and photo. It&apos;s on for new newsletters and goes live after your first issue.
				{sharedDomain && (
					<>
						{" "}
						It lives at <code>your-newsletter.{sharedDomain}</code>
						{hasOwnHost && ", or on a subdomain of your own domain once you add it on the Domains page"}.
					</>
				)}
				{isCloud() && " It stays online while your account has a plan."}
			</p>
			<p>
				Its description, social links, author bio and photo are in the Website section of the{" "}
				<Link href={getHelpHref("newsletters", "website")}>newsletter&apos;s settings</Link>, where you can also turn it off. Search
				engines get a sitemap of your issues, and each page has its own picture for when it&apos;s shared.
			</p>
			<p>
				Its fonts, colors and shapes are your newsletter&apos;s theme, the same as in your emails.{" "}
				<Link href={getHelpHref("design")}>Design and themes</Link>
			</p>

			<h2 id="issue-pages">Issue pages</h2>
			<p>
				Every issue you send gets a page at <code>/p/</code> followed by its slug, made from the subject. Change the slug in the
				send step&apos;s Web page row before it goes out, or later from the campaign&apos;s page. There you can also pin an issue: pinned
				issues lead the home page, in its Featured row.
			</p>

			<h2 id="signups">How people sign up</h2>
			<ul>
				<li>
					<strong>On your website</strong>: the signup form on the home page, and a popup on issue pages that opens once the reader is
					into the issue. Closed, it stays away for two weeks.
				</li>
				<li>
					<strong>On your own site or app</strong>: create an API key with the signups only level on the API keys page, then sign
					people up with one request each. That key can only add contacts, so it&apos;s safe in your website&apos;s code. See{" "}
					<Link href="/docs/api#add-contact">add a contact</Link> in the API reference.
				</li>
				<li>
					<strong>By hand or from a file</strong>: on the Contacts page. <Link href={getHelpHref("contacts")}>Contacts</Link>
				</li>
			</ul>
			<p>
				With <Link href={getHelpHref("newsletters", "confirm-signups")}>confirmed opt-in</Link> on, a new signup gets the confirmation
				email and joins once they click its button. Otherwise they join at once and get your welcome email, if it&apos;s on. Typos like
				gmial.com, spam traps, domains that can&apos;t receive email and addresses known to bounce are refused at the form, with a
				suggestion when the address looks misspelled.
			</p>

			<h2 id="unsubscribe">Unsubscribing</h2>
			<p>
				Every email has an unsubscribe link in its footer and the one-click unsubscribe Gmail and Yahoo show next to the sender. Either
				one unsubscribes the reader at once: only signing up again, or a resubscribe they ask you for, brings them back.
			</p>
		</ArticleHelp>
	);
}
