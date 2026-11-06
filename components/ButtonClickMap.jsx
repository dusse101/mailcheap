"use client";

import { useRef, useState } from "react";
import { MousePointerClick } from "lucide-react";
import DialogPreviewEmail from "@/components/DialogPreviewEmail";
import { Button } from "@/components/ui/button";

// A sent issue's email as it went out, in a mail app's window or in Gmail on a phone, rendered on the server. clicks:
// its clicked links, which the preview shows on the email.
export default function ButtonClickMap({ html, sender, subject, previewText, newsletterId, contactFields, clicks }) {
	const [isOpen, setIsOpen] = useState(false);
	const buttonRef = useRef(null);

	return (
		<>
			<Button ref={buttonRef} variant="outline" onClick={() => setIsOpen(true)}>
				<MousePointerClick data-icon="inline-start" />
				Click map
			</Button>
			<DialogPreviewEmail
				isOpen={isOpen}
				onOpenChange={setIsOpen}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					buttonRef.current?.focus();
				}}
				html={html}
				sender={sender}
				subject={subject}
				previewText={previewText}
				newsletterId={newsletterId}
				contactFields={contactFields}
				clicks={clicks}
			/>
		</>
	);
}
