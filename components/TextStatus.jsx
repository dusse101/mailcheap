import { cn } from "@/lib/utils";

// A status in a few words after a dot of its tone: good, wait, bad or none.
export default function TextStatus({ label, tone, className }) {
	return (
		<span className={cn("flex items-center gap-2 text-muted-foreground", className)}>
			<span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", DOT_TONES[tone])} />
			{label}
		</span>
	);
}

const DOT_TONES = {
	good: "bg-emerald-500",
	wait: "bg-amber-500",
	bad: "bg-red-500",
	none: "bg-zinc-300 dark:bg-zinc-600",
};
