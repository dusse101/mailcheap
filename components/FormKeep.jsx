"use client";

import { HeartHandshake, Link2Off, MailCheck } from "lucide-react";
import CardNotice from "@/components/CardNotice";
import { Button } from "@/components/ui/button";

// Only the button's POST keeps. It posts to /api/keep, not a server action: without JavaScript,
// Next.js accepts the action and then never sends the page back.
export default function FormKeep({ token, newsletterName, archiveUrl, outcome = "form" }) {
	if (outcome === "done") {
		return (
			<CardNotice icon={MailCheck} tone="success" title={`You'll keep getting ${newsletterName}`} focusTitle>
				Thanks for letting me know. The next issue lands in your inbox.
				{archiveUrl && (
					<Button asChild size="lg" variant="outline" className="mt-6 w-full">
						<a href={archiveUrl}>Read past issues</a>
					</Button>
				)}
			</CardNotice>
		);
	}

	if (outcome === "closed") {
		return (
			<CardNotice icon={Link2Off} title="This link doesn't work">
				It may be older than 90 days, or you unsubscribed. Sign up again to get {newsletterName}.
				{archiveUrl && (
					<Button asChild size="lg" variant="outline" className="mt-6 w-full">
						<a href={archiveUrl}>Sign up again</a>
					</Button>
				)}
			</CardNotice>
		);
	}

	return (
		<CardNotice icon={HeartHandshake} title={`Keep getting ${newsletterName}?`}>
			One click and it keeps coming.
			<form method="post" action="/api/keep" className="mt-6">
				<input type="hidden" name="token" value={token} />
				<Button type="submit" size="lg" className="w-full">
					Yes, keep sending it
				</Button>
			</form>
		</CardNotice>
	);
}
