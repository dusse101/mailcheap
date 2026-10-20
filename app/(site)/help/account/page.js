import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import LinkApp from "@/components/LinkApp";
import { DELETION_GRACE_DAYS } from "@/lib/account-deletion";
import { isGoogleEnabled } from "@/lib/auth";
import { isCloud } from "@/lib/config";
import { getHelpHref, getHelpPageMetadata } from "@/lib/help";
import { SUMMARY_BARS, SUMMARY_HOUR } from "@/lib/summary";

export const metadata = getHelpPageMetadata("account");

export default function AccountPage() {
	return (
		<ArticleHelp slug="account">
			<h2 id="sign-in">Signing in</h2>
			<p>
				You sign in {isGoogleEnabled() ? "with Google, or " : ""}with a code MailCheap emails to your address. The address can&apos;t
				be changed. Your name and photo are on the <LinkApp href="/account">Account page</LinkApp>, opened from the menu at the bottom
				of the sidebar, along with
				{isCloud() ? " your plan and" : ""} the deletion of your account.
			</p>
			<p>
				Apps you connected with your sign-in, like ChatGPT or Claude, are on the <LinkApp href="/api-keys">API keys page</LinkApp>,
				where you can disconnect each one.{" "}
				<Link href={getHelpHref("api-and-ai")}>API and AI assistants</Link>
			</p>

			{isCloud() && (
				<>
					<h2 id="summary-email" data-cloud>Summary emails</h2>
					<p>
						With a paid plan, MailCheap can email you your newsletter&apos;s numbers every Monday at {SUMMARY_HOUR} AM, your time.
						It says who joined and who left against the week before, your total, new subscribers over the last{" "}
						{SUMMARY_BARS.weekly} weeks, and your latest
						issue&apos;s opens and clicks against your average, with its most clicked link. With several newsletters, the one with
						the most subscribers comes first and the others get a line each.
					</p>
					<p>
						On the <LinkApp href="/account">Account page</LinkApp>, pick Weekly, Daily for yesterday&apos;s numbers every
						morning, which skips the days with no news, or Off; Preview there shows your next summary. The link at the bottom of
						each summary changes it without signing in, and your mail app&apos;s Unsubscribe button turns it off in one click.
						&quot;Your time&quot; is your browser&apos;s, the last time you opened the dashboard. Summaries don&apos;t count toward
						your plan&apos;s emails.
					</p>
					<p>
						Share this week opens a page with your newsletter&apos;s name and its own totals, never a subscriber, to post on X or
						LinkedIn. <Link href="/docs/api#get-summary">Get a summary</Link> in the API returns the same numbers.
					</p>
				</>
			)}

			<h2 id="delete">Deleting your account</h2>
			<p>
				Two things come first, and the <LinkApp href="/account">Account page</LinkApp> shows them when they apply:
			</p>
			<ul>
				{isCloud() && (
					<li>
						<strong>Cancel your plan</strong> from the <LinkApp href="/billing">billing page</LinkApp>: deleting your account
						doesn&apos;t stop Stripe from billing it.
						You can delete it once the plan has ended.
					</li>
				)}
				<li>
					<strong>Stop your campaigns</strong>: pause the ones sending and unschedule the scheduled ones.
				</li>
			</ul>
			<p>
				Then click Delete account and type the code MailCheap emails you. Your account stops at once: you&apos;re signed out
				everywhere, your API keys are revoked, connected apps are disconnected, nothing is sent, and your websites go offline.
			</p>

			<h2 id="restore">Restoring it</h2>
			<p>
				For {DELETION_GRACE_DAYS} days, signing in restores your account as it was. Your API keys and connected apps stay off: create
				new ones once it&apos;s back. After {DELETION_GRACE_DAYS} days, its newsletters, contacts, campaigns and images are deleted for
				good, and it can&apos;t be restored.
			</p>
		</ArticleHelp>
	);
}
