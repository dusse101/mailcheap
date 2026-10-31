"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowUpRight, BookOpen, ChartPie, Download, Loader2, MoreHorizontal, Plus, Rows3, Trash2 } from "lucide-react";
import { exportContacts } from "@/app/(app)/contacts/actions";
import DialogAddContact from "@/components/DialogAddContact";
import DialogContactFields from "@/components/DialogContactFields";
import DialogDeleteContacts from "@/components/DialogDeleteContacts";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { hasContactFilters } from "@/lib/contact-filters";
import { formatCount } from "@/lib/format";
import { getHelpHref } from "@/lib/help";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

// The actions at the top of the Contacts page, where getContactsHeader (lib/contacts-header.js) puts them for the list:
// header. children: the import, which the page gives. filters and count: the list's filters, which the export follows,
// and how many contacts they show; once filters narrow the list, the menu can delete those. A dialog gives the focus
// back to what opened it, or to the ⋯ button once that's gone: a menu item, or Add contact once the contact it added
// moved it into the menu.
export default function ButtonsContacts({ header, newsletter, filters, count, children }) {
	const [dialog, setDialog] = useState(null);
	const [isExporting, startExporting] = useTransition();
	const moreRef = useRef(null);
	const openerRef = useRef(null);
	const isOpeningDialogRef = useRef(false);
	const { buttons, menu } = header;
	const canDelete = menu.includes("export") && hasContactFilters(filters) && count > 0;

	function open(name, opener) {
		openerRef.current = opener;
		setDialog(name);
	}

	// The dialog keeps the focus the menu would give back to its button as it closes.
	function openFromMenu(name) {
		isOpeningDialogRef.current = true;
		open(name, moreRef.current);
	}

	function keepDialogFocus(event) {
		if (!isOpeningDialogRef.current) return;
		isOpeningDialogRef.current = false;
		event.preventDefault();
	}

	function returnFocus(event) {
		event.preventDefault();
		(openerRef.current?.isConnected ? openerRef.current : moreRef.current)?.focus();
	}

	function changeDialog(name) {
		return (isOpen) => setDialog(isOpen ? name : null);
	}

	// The file downloads from a link valid for an hour.
	function download() {
		startExporting(async () => {
			const result = await exportContacts({ newsletterId: newsletter?.id, ...filters });
			if (result?.error) return void toast.error(result.error);
			window.location.assign(result.url);
		});
	}

	return (
		<>
			{buttons.includes("segments") && (
				<Button asChild variant="outline" className={cn(menu.includes("segments") && "max-sm:hidden")}>
					<Link href="/contacts/segments">
						<ChartPie data-icon="inline-start" />
						Segments
					</Link>
				</Button>
			)}
			{buttons.includes("fields") && (
				<Button
					variant="outline"
					aria-haspopup="dialog"
					onClick={(event) => open("fields", event.currentTarget)}
					className={cn(menu.includes("fields") && "max-sm:hidden")}
				>
					<Rows3 data-icon="inline-start" />
					Fields
				</Button>
			)}
			{buttons.includes("add") && (
				<Button variant="outline" aria-haspopup="dialog" onClick={(event) => open("add", event.currentTarget)} disabled={!newsletter}>
					<Plus data-icon="inline-start" />
					Add contact
				</Button>
			)}
			{buttons.includes("import") && children}
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button ref={moreRef} variant="ghost" size="icon" aria-label="More">
						{isExporting ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" onCloseAutoFocus={keepDialogFocus} className="min-w-52">
					{menu.includes("add") && (
						<DropdownMenuItem onSelect={() => openFromMenu("add")} disabled={!newsletter}>
							<Plus />
							Add contact
						</DropdownMenuItem>
					)}
					{menu.includes("segments") && (
						<DropdownMenuItem asChild className={cn(buttons.includes("segments") && "sm:hidden")}>
							<Link href="/contacts/segments">
								<ChartPie />
								Segments
							</Link>
						</DropdownMenuItem>
					)}
					{menu.includes("fields") && (
						<DropdownMenuItem onSelect={() => openFromMenu("fields")} className={cn(buttons.includes("fields") && "sm:hidden")}>
							<Rows3 />
							Contact fields
						</DropdownMenuItem>
					)}
					{menu.includes("export") && (
						<DropdownMenuItem onSelect={download} disabled={count === 0 || isExporting}>
							<Download />
							Export {formatCount(count, "contact")}
						</DropdownMenuItem>
					)}
					{canDelete && (
						<DropdownMenuItem variant="destructive" onSelect={() => openFromMenu("delete")}>
							<Trash2 />
							Delete {formatCount(count, "contact")}
						</DropdownMenuItem>
					)}
					{menu.includes("help") && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem asChild>
								<a href={getHelpHref("contacts")} target="_blank" rel="noopener">
									<BookOpen />
									How contacts work
									<ArrowUpRight className="ml-auto text-muted-foreground" />
								</a>
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
			<DialogContactFields isOpen={dialog === "fields"} onOpenChange={changeDialog("fields")} onCloseAutoFocus={returnFocus} />
			<DialogAddContact newsletter={newsletter} isOpen={dialog === "add"} onOpenChange={changeDialog("add")} onCloseAutoFocus={returnFocus} />
			<DialogDeleteContacts
				newsletterId={newsletter?.id}
				filters={filters}
				count={count}
				isOpen={dialog === "delete"}
				onOpenChange={changeDialog("delete")}
				onCloseAutoFocus={returnFocus}
			/>
		</>
	);
}
