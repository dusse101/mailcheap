import { ArrowUpRight, BookOpen } from "lucide-react";
import LinkHelp from "@/components/LinkHelp";
import { cn } from "@/lib/utils";

// The help on tagging contacts, in a new tab: under a contact's tags, and in Edit tags.
export default function LinkHelpTags({ className, ...props }) {
	return (
		<LinkHelp
			article="contacts"
			section="tags"
			className={cn(
				"flex items-center gap-2 text-xs font-normal whitespace-normal text-muted-foreground no-underline outline-none hover:text-foreground",
				className
			)}
			{...props}
		>
			<BookOpen aria-hidden="true" className="size-3.5 shrink-0" />
			<span className="flex-1">How tags work</span>
			<ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0" />
		</LinkHelp>
	);
}
