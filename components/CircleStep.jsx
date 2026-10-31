import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// A step's number in the panels at the dashboard's bottom right, like the get-started list: a check once it's done, a
// ring around the one to do next.
export default function CircleStep({ number, isDone, isNext }) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"grid size-6 shrink-0 place-items-center rounded-full font-mono text-[11px] tabular-nums",
				isDone && "bg-foreground text-background",
				isNext && "bg-card text-foreground inset-ring-[1.5px] inset-ring-foreground",
				!isDone && !isNext && "text-muted-foreground inset-ring inset-ring-foreground/15"
			)}
		>
			{isDone ? <Check className="size-3.5" strokeWidth={2.5} /> : number}
		</span>
	);
}
