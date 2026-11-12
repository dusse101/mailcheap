"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { updateContactDetails } from "@/app/(app)/contacts/actions";
import InputTags from "@/components/InputTags";
import LinkHelpTags from "@/components/LinkHelpTags";
import { useContactOptions } from "@/components/ProviderContactOptions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/lib/toast";

// A contact's tags, typed or picked from the ones the newsletter's other contacts have. contact: { id, email, tags }.
export default function DialogContactTags({ contact, isOpen, onOpenChange, onCloseAutoFocus }) {
	const [formKey, setFormKey] = useState(0);

	function changeOpen(open) {
		onOpenChange(open);
		if (!open) setFormKey((key) => key + 1);
	}

	return (
		<Dialog open={isOpen} onOpenChange={changeOpen}>
			<DialogContent className="sm:max-w-md" onCloseAutoFocus={onCloseAutoFocus}>
				<FormContactTags key={formKey} contact={contact} onDone={() => changeOpen(false)} />
			</DialogContent>
		</Dialog>
	);
}

function FormContactTags({ contact, onDone }) {
	const { tags: tagOptions } = useContactOptions();
	const [tags, setTags] = useState(contact.tags ?? []);
	const [isSaving, startSaving] = useTransition();

	function save(event) {
		event.preventDefault();
		startSaving(async () => {
			const result = await updateContactDetails(contact.id, { tags });
			if (result?.error) return void toast.error(result.error);
			onDone();
			toast.success("Tags saved");
		});
	}

	return (
		<form onSubmit={save} className="flex flex-col gap-5">
			<DialogHeader>
				<DialogTitle>Edit tags</DialogTitle>
				<DialogDescription className="text-pretty">
					<span className="font-medium wrap-anywhere text-foreground">{contact.email}</span>. Tags are labels like vip or customer, to
					filter your list and build segments. Unlike fields, they never show in emails.
				</DialogDescription>
				<LinkHelpTags className="self-start text-sm" />
			</DialogHeader>

			<InputTags value={tags} onChange={setTags} suggestions={tagOptions} autoFocus />

			<DialogFooter>
				<DialogClose asChild>
					<Button type="button" variant="outline">
						Cancel
					</Button>
				</DialogClose>
				<Button type="submit" disabled={isSaving} className="min-w-20">
					{isSaving ? <Loader2 className="animate-spin" /> : "Save"}
				</Button>
			</DialogFooter>
		</form>
	);
}
