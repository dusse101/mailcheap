import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// The cross at the end of a field that empties it, like a date's or a search's: the field keeps room for it. size is the
// field's, default or sm.
export default function ButtonClear({ size = "default", className, ...props }) {
	return (
		<button
			type="button"
			className={cn(
				"absolute top-1/2 grid -translate-y-1/2 place-items-center rounded-md text-muted-foreground outline-none transition-[color,background-color,scale] duration-150 after:absolute after:-inset-1.5 hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.96] [&_svg]:size-3.5",
				size === "sm" ? "right-1 size-5 [&_svg]:size-3" : "right-1.5 size-6",
				className
			)}
			{...props}
		>
			<X aria-hidden="true" className="animate-icon-in" />
		</button>
	);
}
