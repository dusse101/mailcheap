"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import DialogAddContact from "@/components/DialogAddContact";
import { Button } from "@/components/ui/button";

// Adds one contact by hand, into the newsletter the page shows.
export default function ButtonAddContact({ newsletter, variant = "outline", size }) {
	const [isOpen, setIsOpen] = useState(false);
	const buttonRef = useRef(null);

	return (
		<>
			<Button ref={buttonRef} variant={variant} size={size} aria-haspopup="dialog" onClick={() => setIsOpen(true)} disabled={!newsletter}>
				<Plus data-icon="inline-start" />
				Add contact
			</Button>
			<DialogAddContact
				newsletter={newsletter}
				isOpen={isOpen}
				onOpenChange={setIsOpen}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					buttonRef.current?.focus();
				}}
			/>
		</>
	);
}
