import Link from "next/link";
import NoticeWarmup from "@/components/NoticeWarmup";
import { formatNumber } from "@/lib/format";
import { getFirstSendSteps } from "@/lib/first-send";
import { GMAIL_WHY, STEPS_WHY, getGmailTrack, getStepItems } from "@/lib/warmup-status";

// In the send step and the send-more dialog, only when a send won't go out at once, a section for each reason: the steps
// its contacts who never got an email go in (lib/first-send.js), and the Gmail readers a new domain sends the next day
// (lib/send-spread.js), with a way to skip that from a domain of their own. gmailShare: the audience's share of Gmail
// addresses. Self-hosted servers have no pace (null): only the steps.
export default function NoticePace({ pace, emails, newContacts = 0, gmailShare = 0, isSharedSender = false }) {
	const sender = pace?.sender ?? null;
	const neverMailed = Math.min(newContacts, emails);
	const steps = getFirstSendSteps(neverMailed);
	const gmail = getGmailTrack(sender, Math.round(emails * gmailShare));
	if (!steps && !gmail) return null;

	return (
		<NoticeWarmup
			sections={[
				steps && {
					title: `${formatNumber(neverMailed)} new contacts get it in ${steps.length} steps`,
					steps: getStepItems(steps),
					why: STEPS_WHY,
					help: { article: "sending", section: "first-send" },
				},
				gmail && {
					title: sender.isGradual ? "Gmail gets it more slowly for now" : "Some Gmail readers get it tomorrow",
					tracks: [gmail],
					why: isSharedSender ? (
						<>
							{GMAIL_WHY}{" "}
							<Link
								href="/domains"
								className="font-medium whitespace-nowrap text-foreground underline decoration-foreground/30 underline-offset-4 transition-colors duration-150 hover:decoration-foreground"
							>
								Add a domain
							</Link>{" "}
							you already send newsletters with, and it all goes today.
						</>
					) : (
						GMAIL_WHY
					),
					help: { article: "warm-up", section: sender.isGradual ? "gmail" : "new-domain" },
				},
			]}
		/>
	);
}
