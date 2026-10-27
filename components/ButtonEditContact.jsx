"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import DialogContactDetails from "@/components/DialogContactDetails";
import { Button } from "@/components/ui/button";

// Opens the contact's fields: its first name and the account's fields. contact: what DialogContactDetails edits.
export default function ButtonEditContact({ contact, variant = "outline", size = "default", className, children = "Edit fields" }) {
	const [isOpen, setIsOpen] = useState(false);

	return (
		<>
			<Button variant={variant} size={size} onClick={() => setIsOpen(true)} className={className}>
				<Pencil data-icon="inline-start" />
				{children}
			</Button>
			<DialogContactDetails contact={contact} isOpen={isOpen} onOpenChange={setIsOpen} />
		</>
	);
}
