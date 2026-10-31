import { ArrowUpRight, BookOpen } from "lucide-react";
import LinkHelp from "@/components/LinkHelp";
import { cn } from "@/lib/utils";

// The tutorial on adding names and fields to contacts, in a new tab: under each list of the fields, and in the Contacts
// page's Fields dialog.
export default function LinkHelpFields({ className, ...props }) {
	return (
		<LinkHelp
			article="contacts"
			section="fields"
			className={cn(
				"flex items-center gap-2 text-xs font-normal whitespace-normal text-muted-foreground no-underline outline-none hover:text-foreground",
				className
			)}
			{...props}
		>
			<BookOpen aria-hidden="true" className="size-3.5 shrink-0" />
			<span className="flex-1">How to add names and fields to contacts</span>
			<ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0" />
		</LinkHelp>
	);
}
