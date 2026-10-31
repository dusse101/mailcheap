"use client";

import { useId, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { Loader2, Mail, X } from "lucide-react";
import { sendInboxCheck } from "@/app/(app)/newsletters/actions";
import { dismissInboxCheck } from "@/app/welcome/actions";
import CircleStep from "@/components/CircleStep";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

// The inbox check at the dashboard's bottom right, where the get-started panel was (lib/inbox-check.js): an email from
// MailCheap to reply to, so its next ones reach the inbox. Closing it, or Done once it's sent, hides it for the open
// newsletter for good.
export default function CardInboxCheck({ newsletterId }) {
	const pathname = usePathname();
	const titleId = useId();
	const [sentTo, setSentTo] = useState(null);
	const [isDismissed, setIsDismissed] = useState(false);
	const [isSending, startSending] = useTransition();
	const [, startDismissing] = useTransition();
	const isHidden = isDismissed || EDITOR_PATH.test(pathname);

	function send() {
		startSending(async () => {
			const result = await sendInboxCheck();
			if (result?.error) {
				toast.error(result.error);
				return;
			}
			setSentTo(result.sentTo);
		});
	}

	function dismiss() {
		setIsDismissed(true);
		startDismissing(() => dismissInboxCheck(newsletterId));
	}

	return (
		<div className="pointer-events-none fixed right-(--dock-right) bottom-(--dock-bottom) left-4 z-40 flex justify-end transition-[opacity,visibility] duration-200 sm:left-auto save-bar:invisible save-bar:opacity-0">
			<section
				aria-labelledby={titleId}
				inert={isHidden}
				className={cn(
					"relative w-full origin-bottom-right rounded-2xl bg-card p-2 shadow-float transition-[opacity,translate,scale] sm:w-89",
					"ease-[cubic-bezier(0.23,1,0.32,1)] starting:opacity-0 motion-safe:starting:translate-y-2 motion-safe:starting:scale-[0.98]",
					isHidden ? "opacity-0 duration-150 motion-safe:translate-y-1 motion-safe:scale-[0.98]" : "pointer-events-auto delay-500 duration-300"
				)}
			>
				<header className="px-3 pt-2.5 pb-3">
					<h2 id={titleId} className="pr-8 font-semibold tracking-tight">
						Get MailCheap&apos;s emails in your inbox
					</h2>
					<p className="mt-1 text-sm text-pretty text-muted-foreground">
						MailCheap only emails you when it matters, like a campaign that needs you or your summary. Never marketing.
					</p>
				</header>
				<ol className="flex flex-col gap-0.5">
					{sentTo ? (
						<>
							<li className="flex h-10 items-center gap-3 px-3 text-sm text-muted-foreground">
								<CircleStep isDone />
								<span className="truncate">Sent to {sentTo}</span>
								<span className="sr-only">(done)</span>
							</li>
							<StepNext
								number={2}
								title="Reply to it with anything, like “got it”"
								description="Not in your inbox? Look in spam and mark it as not spam."
							>
								<div className="flex flex-wrap gap-2">
									<Button size="sm" onClick={dismiss}>
										Done
									</Button>
									<Button variant="ghost" size="sm" onClick={send} disabled={isSending}>
										{isSending && <Loader2 data-icon="inline-start" className="animate-spin" />}
										Send again
									</Button>
								</div>
							</StepNext>
						</>
					) : (
						<>
							<StepNext number={1} title="Send yourself an email" description="From MailCheap, to the address you sign in with.">
								<Button size="sm" onClick={send} disabled={isSending}>
									{isSending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Mail data-icon="inline-start" />}
									Send me an email
								</Button>
							</StepNext>
							<li className="flex h-10 items-center gap-3 px-3 text-sm">
								<CircleStep number={2} />
								<span className="truncate">Reply to it with anything</span>
							</li>
						</>
					)}
				</ol>
				<div className="absolute top-4 right-3">
					<Button variant="ghost" size="icon-sm" onClick={dismiss} aria-label="Dismiss" title="Dismiss" className={CONTROL}>
						<X />
					</Button>
				</div>
			</section>
		</div>
	);
}

// The step to do now, as the get-started panel shows it: in a box, with what it takes.
function StepNext({ number, title, description, children }) {
	return (
		<li aria-current="step" className="flex gap-3 rounded-lg bg-muted/60 px-3 py-3">
			<CircleStep number={number} isNext />
			<div className="flex min-w-0 flex-1 flex-col items-start gap-3 pt-0.5">
				<div>
					<p className="text-sm font-medium">{title}</p>
					<p className="text-sm text-pretty text-muted-foreground">{description}</p>
				</div>
				{children}
			</div>
		</li>
	);
}

// The campaign page's editor and preview reach the bottom of the screen: the card waits for another page.
const EDITOR_PATH = /^\/campaigns\/[^/]+/;
const CONTROL = "relative text-muted-foreground after:absolute after:-inset-x-0.5 after:-inset-y-1.5";
