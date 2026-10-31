import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// The cross that closes a dashboard helper, like the own-domain one, with room around it to tap.
export default function ButtonClose({ onClick, className }) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label="Close"
			title="Close"
			className={cn(
				"relative grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-[color,background-color,scale] duration-150 after:absolute after:-inset-2 hover:bg-muted hover:text-foreground active:scale-[0.96]",
				className
			)}
		>
			<X className="size-3.5" aria-hidden="true" />
		</button>
	);
}
