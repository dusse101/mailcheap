"use client";

import { useState } from "react";
import Link from "next/link";
import { Globe } from "lucide-react";
import { dismissOwnDomainNudge } from "@/app/welcome/actions";
import ButtonClose from "@/components/ButtonClose";
import { Button } from "@/components/ui/button";
import { ADD_DOMAIN_PATH, DOMAINS_PATH, getSenderPath } from "@/lib/newsletters";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

// The next step toward its own domain for a newsletter on the shared address (lib/sender-rules.js getOwnDomainNudge):
// a note under the send step's From row, or a card on the overview. Closing it is remembered for the newsletter until
// the step changes. It never blocks sending.
export default function NoticeOwnDomain({ nudge, newsletter, variant = "inline", stagger, className }) {
	const [isClosed, setIsClosed] = useState(false);
	if (isClosed) return null;
	const copy = getCopy(nudge, newsletter);
	const newsletterId = String(newsletter._id);

	async function close() {
		setIsClosed(true);
		const result = await dismissOwnDomainNudge(newsletterId, nudge.step);
		if (result?.error) toast.error(result.error);
	}

	if (variant === "card") {
		return (
			<section
				style={{ "--stagger": stagger }}
				aria-label="Your own domain"
				className="relative flex flex-col gap-3 rounded-xl bg-card p-4 pr-12 shadow-border animate-enter sm:flex-row sm:items-center sm:gap-4"
			>
				<span className="flex min-w-0 flex-1 items-start gap-3">
					<span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground/75">
						<Globe className="size-[18px]" aria-hidden="true" />
					</span>
					<span className="min-w-0">
						<span className="block text-sm font-medium text-balance">{copy.title}</span>
						<span className="block text-sm text-pretty text-muted-foreground">{copy.text}</span>
					</span>
				</span>
				<Button asChild variant="outline" size="sm" className="ml-12 self-start sm:ml-0 sm:self-center">
					<Link href={getHref(nudge, newsletterId)}>{copy.action}</Link>
				</Button>
				<ButtonClose onClick={close} className="absolute top-3 right-3" />
			</section>
		);
	}

	return (
		<div className={cn("flex items-start gap-2.5 rounded-lg bg-muted/60 px-3 py-2.5 text-sm animate-enter", className)}>
			<Globe className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
			<p className="min-w-0 flex-1 text-pretty text-muted-foreground">
				{copy.line}{" "}
				<Link
					href={getHref(nudge, newsletterId)}
					className="font-medium whitespace-nowrap text-foreground underline decoration-foreground/30 underline-offset-2 transition-colors duration-150 hover:decoration-foreground"
				>
					{copy.link}
				</Link>
			</p>
			<ButtonClose onClick={close} className="-my-0.5 -mr-1" />
		</div>
	);
}

function getHref(nudge, newsletterId) {
	if (nudge.step === "switch") return getSenderPath({ newsletterId, domainId: nudge.domainId });
	return nudge.step === "verify" ? DOMAINS_PATH : ADD_DOMAIN_PATH;
}

function getCopy(nudge, newsletter) {
	if (nudge.step === "switch") {
		return {
			title: `${nudge.domain} is verified`,
			text: `${newsletter.name} still sends from the shared address.`,
			action: `Send from ${nudge.domain}`,
			line: `${nudge.domain} is verified.`,
			link: "Send from it",
		};
	}
	if (nudge.step === "verify") {
		return {
			title: `Finish setting up ${nudge.domain}`,
			text: "Add its DNS records, then send from your own address.",
			action: "Open Domains",
			line: `${nudge.domain} isn't verified yet.`,
			link: "Finish on Domains",
		};
	}
	return {
		title: "Send from your own domain",
		text: "It helps your emails reach inboxes and puts your name in the from line.",
		action: "Add a domain",
		line: "Shared address. Your own domain helps delivery and your brand.",
		link: "Add a domain",
	};
}
