"use client";

import { MailCheck } from "lucide-react";
import CardNotice from "@/components/CardNotice";
import { Button } from "@/components/ui/button";

// Only the button's POST confirms. It posts to /api/confirm, not a server action: without JavaScript,
// Next.js accepts the action and then never sends the page back.
export default function FormConfirm({ token, newsletterName, fromName, fromEmail, archiveUrl, outcome = "form" }) {
	if (outcome === "done") {
		return (
			<CardNotice icon={MailCheck} tone="success" title="You're in" focusTitle>
				The next issue of {newsletterName} comes from{" "}
				<span className="font-medium text-foreground">{fromName || fromEmail}</span>
				{fromName && ` (${fromEmail})`}. If it lands in Promotions, drag it to Primary.
				{archiveUrl && (
					<Button asChild size="lg" variant="outline" className="mt-6 w-full">
						<a href={archiveUrl}>Read past issues</a>
					</Button>
				)}
			</CardNotice>
		);
	}

	return (
		<CardNotice icon={MailCheck} title={`Confirm your subscription to ${newsletterName}`}>
			One click and the next issue lands in your inbox.
			<form method="post" action="/api/confirm" className="mt-6">
				<input type="hidden" name="token" value={token} />
				<Button type="submit" size="lg" className="w-full">
					Confirm my subscription
				</Button>
			</form>
		</CardNotice>
	);
}
