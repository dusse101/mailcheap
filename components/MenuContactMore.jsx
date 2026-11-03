"use client";

import { useRef, useState } from "react";
import { MoreHorizontal, Pencil, Tag, Trash2 } from "lucide-react";
import DialogContactDetails from "@/components/DialogContactDetails";
import DialogContactTags from "@/components/DialogContactTags";
import { DialogDeleteContact } from "@/components/MenuContact";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// The ⋯ menu at the top of a contact's page, after their status: their fields, their tags, and delete them, then back
// to the list. contact: { id, email, firstName, tags, fields }, what the dialogs edit.
export default function MenuContactMore({ contact, status, className }) {
	const [dialog, setDialog] = useState(null);
	const moreRef = useRef(null);
	const isOpeningDialogRef = useRef(false);

	// The dialog keeps the focus the menu would give back to its button as it closes.
	function open(name) {
		isOpeningDialogRef.current = true;
		setDialog(name);
	}

	function keepDialogFocus(event) {
		if (!isOpeningDialogRef.current) return;
		isOpeningDialogRef.current = false;
		event.preventDefault();
	}

	function returnFocus(event) {
		event.preventDefault();
		moreRef.current?.focus();
	}

	function changeOpen(name) {
		return (isOpen) => setDialog(isOpen ? name : null);
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button ref={moreRef} variant="ghost" size="icon" aria-label="More" className={className}>
						<MoreHorizontal />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" onCloseAutoFocus={keepDialogFocus} className="min-w-44">
					<DropdownMenuItem onSelect={() => open("details")}>
						<Pencil />
						Edit fields
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => open("tags")}>
						<Tag />
						Edit tags
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem variant="destructive" onSelect={() => open("delete")}>
						<Trash2 />
						Delete contact
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<DialogContactDetails contact={contact} isOpen={dialog === "details"} onOpenChange={changeOpen("details")} onCloseAutoFocus={returnFocus} />
			<DialogContactTags contact={contact} isOpen={dialog === "tags"} onOpenChange={changeOpen("tags")} onCloseAutoFocus={returnFocus} />
			<DialogDeleteContact
				id={contact.id}
				email={contact.email}
				status={status}
				isOpen={dialog === "delete"}
				onOpenChange={changeOpen("delete")}
				onCloseAutoFocus={returnFocus}
				redirectTo="/contacts"
			/>
		</>
	);
}
