import { CircleX } from "lucide-react";
import { cn } from "@/lib/utils";

// What stops a send, each with its fix (lib/campaign-steps.js), in red: above the campaign editor's review and send
// steps, and in the send-more dialog.
export default function NoticeSendProblems({ problems, renderFix, className }) {
	return (
		<div role="status" className={cn("rounded-xl bg-red-500/10 px-4 py-1", className)}>
			<ListSendProblems problems={problems} renderFix={renderFix} />
		</div>
	);
}

// The same rows in the popover of the editor's button, when it's pressed.
export function ListSendProblems({ problems, renderFix, className }) {
	return (
		<ul className={className}>
			{problems.map((problem) => (
				<li key={problem.id} className="flex min-h-11 items-center gap-3 py-1.5">
					<CircleX aria-hidden="true" className="size-4 shrink-0 text-red-500" />
					<span className="min-w-0 flex-1 text-sm text-pretty tabular-nums">{problem.message}</span>
					{renderFix(problem)}
				</li>
			))}
		</ul>
	);
}
