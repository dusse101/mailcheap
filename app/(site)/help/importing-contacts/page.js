import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import { FIRST_SEND, isCloud } from "@/lib/config";
import { getHelpHref, getHelpPageMetadata } from "@/lib/help";
import { CONSENT_TEXT } from "@/lib/import-checks";

export const metadata = getHelpPageMetadata("importing-contacts");

export default function ImportingContactsPage() {
	return (
		<ArticleHelp slug="importing-contacts">
			<h2 id="export">Export from your current platform</h2>
			<p>
				Substack, beehiiv, Mailchimp, Kit, Buttondown and most other platforms export subscribers as a CSV file. Then, on the Contacts
				page, click Import contacts and choose the file.{isCloud() && " Importing needs a plan."}
			</p>

			<h2 id="columns">What the import reads</h2>
			<ul>
				<li>
					<strong>Email</strong>: the only column it needs, under names like email, email address or subscriber.
				</li>
				<li>
					<strong>Status</strong>: subscribed, unsubscribed, bounced or complained in the platform&apos;s own words. A status it
					doesn&apos;t know, like unconfirmed, makes the contact dormant.
				</li>
				<li>
					<strong>Signup date</strong>, so your contacts keep the day they joined.
				</li>
				<li>
					<strong>Open and click rates</strong>, when the platform exports them: your sends reach the most engaged first, so your
					best readers get your first issue first.
				</li>
			</ul>
			<p>
				Other columns are skipped. Instead of the file&apos;s statuses, you can import everyone as dormant, for an old list you&apos;d
				rather wake up slowly: dormant contacts get nothing until you mark them active.
			</p>

			<h2 id="consent">Consent</h2>
			<p>
				Before importing, you tick &ldquo;{CONSENT_TEXT}&rdquo;. Only import people who signed up for your newsletter: a bought or
				scraped list brings bounces and spam complaints, which pause your sends and can block your account.
			</p>

			<h2 id="left-out">What it leaves out</h2>
			<p>The import checks each address and leaves out, with a count for each reason:</p>
			<ul>
				<li>invalid addresses, and misspelled domains like gmial.com;</li>
				<li>spam traps, throwaway inboxes and role addresses like info@ or support@;</li>
				<li>duplicates in the file, and addresses on domains that can&apos;t receive email;</li>
				<li>people who unsubscribed, bounced or complained before, even if you deleted them since;</li>
				<li>addresses MailCheap knows can&apos;t receive email, because they bounced or hit a spam trap for any sender.</li>
			</ul>
			<p>
				Contacts already in your list keep their status, unless the file gives a stricter one (unsubscribed, bounced or complained),
				which is final. An import never sends welcome emails.
			</p>

			<h2 id="after">After the import</h2>
			<p>
				The first time you send to contacts who never got an email from you, a slice of them goes first and the rest follows{" "}
				{FIRST_SEND.waitMinutes / 60} hours later if the slice looks clean.{" "}
				<Link href={getHelpHref("sending", "first-send")}>First sends in steps</Link>
			</p>
			{isCloud() && (
				<p>
					Your active contacts count toward your plan&apos;s subscribers. With more than it allows, sending waits until you upgrade.{" "}
					<Link href={getHelpHref("plans")}>Plans and billing</Link>
				</p>
			)}
		</ArticleHelp>
	);
}
