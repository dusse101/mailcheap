"use client";

import { useState } from "react";
import { Tag } from "lucide-react";
import DialogContactTags from "@/components/DialogContactTags";
import { Button } from "@/components/ui/button";

// Opens the contact's tags. contact: what DialogContactTags edits.
export default function ButtonEditTags({ contact, variant = "outline", size = "default", className, children = "Edit tags" }) {
	const [isOpen, setIsOpen] = useState(false);

	return (
		<>
			<Button variant={variant} size={size} onClick={() => setIsOpen(true)} className={className}>
				<Tag data-icon="inline-start" />
				{children}
			</Button>
			<DialogContactTags contact={contact} isOpen={isOpen} onOpenChange={setIsOpen} />
		</>
	);
}
