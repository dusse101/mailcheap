import { cn } from "@/lib/utils";

// A send's progress through its pace (lib/warmup-status.js): a step per first-send step, or per day a domain holds Gmail's
// readers back. value: the step or day reached, 0 before it starts. progress: how far along, for a bar without steps.
export default function ProgressWarmup({ value, max, progress = value / max, isStepped = false, label = "Progress", className }) {
	return (
		<div
			role="progressbar"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={max}
			aria-valuenow={value}
			className={cn(isStepped ? "flex gap-1" : "h-1.5 overflow-hidden rounded-full bg-foreground/10", className)}
		>
			{isStepped ? (
				Array.from({ length: max }, (_, index) => (
					<span key={index} className={cn("h-1.5 flex-1 rounded-full", index < value ? "bg-foreground" : "bg-foreground/10")} />
				))
			) : (
				<div className="h-full rounded-full bg-foreground" style={{ width: `${Math.max(progress * 100, value ? 2 : 0)}%` }} />
			)}
		</div>
	);
}
