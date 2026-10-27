"use client";

import { useRef, useState } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { DialogDeleteContact } from "@/components/MenuContact";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

// The ⋯ menu at the top of a contact's page, after their status and Edit fields: delete them, then back to the list.
export default function MenuContactMore({ id, email, status, className }) {
	const [isDeleteOpen, setIsDeleteOpen] = useState(false);
	const moreRef = useRef(null);
	const isOpeningDialogRef = useRef(false);

	// The dialog keeps the focus the menu would give back to its button as it closes.
	function openDelete() {
		isOpeningDialogRef.current = true;
		setIsDeleteOpen(true);
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

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button ref={moreRef} variant="ghost" size="icon" aria-label="More" className={className}>
						<MoreHorizontal />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" onCloseAutoFocus={keepDialogFocus} className="min-w-44">
					<DropdownMenuItem variant="destructive" onSelect={openDelete}>
						<Trash2 />
						Delete contact
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<DialogDeleteContact
				id={id}
				email={email}
				status={status}
				isOpen={isDeleteOpen}
				onOpenChange={setIsDeleteOpen}
				onCloseAutoFocus={returnFocus}
				redirectTo="/contacts"
			/>
		</>
	);
}
