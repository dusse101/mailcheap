"use client";

import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// A field's tag, like {{plan}}, which prints the contact's value where it's typed in an email: copied on a click.
export default function ButtonMergeTag({ tag, className }) {
	const [isCopied, setIsCopied] = useState(false);
	const timeout = useRef(null);
	const Icon = isCopied ? Check : Copy;

	async function copy() {
		await navigator.clipboard.writeText(tag);
		setIsCopied(true);
		clearTimeout(timeout.current);
		timeout.current = setTimeout(() => setIsCopied(false), 1500);
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					onClick={copy}
					aria-label={`Copy ${tag}`}
					className={cn(
						"group relative inline-flex h-6 min-w-0 items-center gap-1.5 rounded-md bg-muted px-1.5 font-mono text-xs text-muted-foreground outline-none transition-[color,background-color,scale] duration-150 after:absolute after:-inset-1 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.96]",
						className
					)}
				>
					<span className="truncate">{tag}</span>
					<Icon key={String(isCopied)} aria-hidden="true" className="size-3 shrink-0 opacity-60 animate-icon-in group-hover:opacity-100" />
				</button>
			</TooltipTrigger>
			<TooltipContent>{isCopied ? "Copied" : "Type it in an email to print it"}</TooltipContent>
		</Tooltip>
	);
}
