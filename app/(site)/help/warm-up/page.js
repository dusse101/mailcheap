import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import LinkApp from "@/components/LinkApp";
import { BACKOFF, FIRST_SEND, SENDER_WARMUP, getSharedDomain } from "@/lib/config";
import { getFirstSendSteps } from "@/lib/first-send";
import { formatCount, formatNumber, formatPercent } from "@/lib/format";
import { getHelpHref, getHelpPageMetadata } from "@/lib/help";

export const metadata = getHelpPageMetadata("warm-up");

// New contacts of a few list sizes, and the steps they go in.
const EXAMPLE_LISTS = [1_000, 10_000, 50_000];

export default function WarmupPage() {
	const sharedDomain = getSharedDomain();
	const [firstStep, secondStep] = FIRST_SEND.steps;
	const wait = formatCount(FIRST_SEND.waitMinutes, "minute");

	return (
		<ArticleHelp slug="warm-up">
			<h2 id="why">Why a send doesn&apos;t always go out at once</h2>
			<p>
				Gmail, Yahoo and Outlook decide what lands in the inbox from what they&apos;ve seen of a sender: how many of its emails
				bounce, how many people mark them as spam, and how fast its volume grows. MailCheap sends in a way that keeps your newsletter
				on their good side, so your emails reach the inbox.
			</p>
			<p>
				Most issues go out at once. Two kinds go a little slower, and the send step tells you before you send: new contacts, and a
				new domain&apos;s Gmail readers.
			</p>

			<h2 id="steps">New contacts in steps</h2>
			<p>
				The first time you email contacts who never got an email from you, like a list you just imported, they get the issue in
				steps, {wait} apart: {formatPercent(firstStep.share)} of them first, then {formatPercent(secondStep.share)} more, then the
				rest. Each step goes only if the ones before have few bounces and spam complaints. Most bounces come back within minutes,
				so a list with bad addresses stops after a few hundred emails, before it hurts your sending reputation.
			</p>
			<table>
				<thead>
					<tr>
						<th>New contacts</th>
						<th>Steps</th>
					</tr>
				</thead>
				<tbody>
					{EXAMPLE_LISTS.map((contacts) => (
						<tr key={contacts}>
							<td>{formatNumber(contacts)}</td>
							<td>{getFirstSendSteps(contacts).map(formatNumber).join(", then ")}</td>
						</tr>
					))}
				</tbody>
			</table>
			<p>
				With no more than {formatNumber(firstStep.min)} new contacts, they all get it at once.{" "}
				<Link href={getHelpHref("sending", "first-send")}>First sends in steps</Link>
			</p>

			<h2 id="new-domain">A new domain and Gmail</h2>
			<p>
				Gmail is careful with the first emails from a domain it doesn&apos;t know, and holds back the ones that come too fast. So on a
				new domain&apos;s first day, MailCheap sends an issue to its first {formatNumber(SENDER_WARMUP.gmailFirstDay)} Gmail readers,
				and the others get it the next day. Readers on other inboxes get it right away.
			</p>
			<p>A domain is new when it&apos;s:</p>
			<ul>
				{sharedDomain && (
					<li>
						the address MailCheap gives your newsletter, like <code>your-newsletter.{sharedDomain}</code>, on its first day of
						sending;
					</li>
				)}
				<li>
					a domain of your own, on its first day, unless its registration shows it&apos;s more than{" "}
					{formatCount(SENDER_WARMUP.newDomainDays, "day")} old.
				</li>
			</ul>
			<p>
				A domain of your own that&apos;s older, like one you already send newsletters with, isn&apos;t held back: everyone gets the
				issue right away. <LinkApp href="/domains">Add your domain</LinkApp>
			</p>

			<h2 id="gmail">When Gmail asks to slow down</h2>
			<p>
				Sometimes Gmail still finds a domain&apos;s emails unusual. It then holds them back and asks the sender to slow down.
				Sending on would make it worse, so MailCheap pauses the sends from that domain for {formatCount(BACKOFF.hours, "hour")} and
				emails you. Then they go on by themselves: Gmail gets half the emails the domain sent it the day before, spread over the
				day, and twice as many each day after, for {formatCount(BACKOFF.days, "day")}. Resuming earlier, or moving to another
				domain, still waits for those hours.
			</p>
			<p>
				If it keeps happening, the contacts probably didn&apos;t expect your emails: check where they came from before you send
				again. <Link href={getHelpHref("deliverability")}>Bounces, complaints and pauses</Link>
			</p>

			<h2 id="dashboard">Where you see it</h2>
			<p>
				Only when a send won&apos;t go out at once, the dashboard shows a box with a part for each reason: the steps with their
				numbers, how many Gmail readers get it today and how many the next day, and why.
			</p>
			<ul>
				<li>The send step shows it before you send or schedule an issue.</li>
				<li>
					A <LinkApp href="/campaigns">campaign</LinkApp>&apos;s page shows it while the issue goes out: the step it&apos;s on and when
					the next one goes, and when Gmail&apos;s readers get it. A campaign Gmail paused says when it starts again.
				</li>
			</ul>
		</ArticleHelp>
	);
}
