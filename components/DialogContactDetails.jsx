"use client";

import { useId, useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { updateContactDetails } from "@/app/(app)/contacts/actions";
import ButtonMergeTag from "@/components/ButtonMergeTag";
import DialogContactFields from "@/components/DialogContactFields";
import InputDate from "@/components/InputDate";
import LinkHelpFields from "@/components/LinkHelpFields";
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
import { Input } from "@/components/ui/input";
import { MAX_CONTACT_FIELDS, MAX_FIRST_NAME } from "@/lib/contact-fields";
import { fieldTag, firstNameTag } from "@/lib/merge-tags";
import { toast } from "@/lib/toast";

// A contact's first name and its values for the account's fields, each with what prints it in emails; DialogContactTags
// has its tags. contact: { id, email, firstName, fields }, with dates as YYYY-MM-DD.
export default function DialogContactDetails({ contact, isOpen, onOpenChange }) {
	const [formKey, setFormKey] = useState(0);

	function changeOpen(open) {
		onOpenChange(open);
		if (!open) setFormKey((key) => key + 1);
	}

	return (
		<Dialog open={isOpen} onOpenChange={changeOpen}>
			<DialogContent className="sm:max-w-md">
				<FormContactDetails key={formKey} contact={contact} onDone={() => changeOpen(false)} />
			</DialogContent>
		</Dialog>
	);
}

function FormContactDetails({ contact, onDone }) {
	const { fields } = useContactOptions();
	const nameId = useId();
	const [firstName, setFirstName] = useState(contact.firstName ?? "");
	const [values, setValues] = useState(() =>
		Object.fromEntries(fields.map(({ key }) => [key, contact.fields?.[key] === undefined ? "" : String(contact.fields[key])]))
	);
	const [isFieldsOpen, setIsFieldsOpen] = useState(false);
	const [isSaving, startSaving] = useTransition();

	function save(event) {
		event.preventDefault();
		startSaving(async () => {
			const result = await updateContactDetails(contact.id, {
				firstName: firstName.trim(),
				fields: Object.fromEntries(fields.map(({ key }) => [key, values[key]?.trim() ? values[key].trim() : null])),
			});
			if (result?.error) return void toast.error(result.error);
			onDone();
			toast.success("Contact saved");
		});
	}

	// The fields' own dialog stays out of the form: React would bubble its submit up to this one.
	return (
		<>
			<form onSubmit={save} className="flex flex-col gap-5">
				<DialogHeader>
					<DialogTitle>Edit fields</DialogTitle>
					<DialogDescription className="text-pretty">
						<span className="font-medium wrap-anywhere text-foreground">{contact.email}</span>. In your emails, what&apos;s on the right of
						a field, like {firstNameTag("")}, prints their value.
					</DialogDescription>
					<LinkHelpFields className="self-start text-sm" />
				</DialogHeader>

				<div className="flex flex-col gap-4">
					<RowField htmlFor={nameId} label="First name" tag={firstNameTag("")}>
						<Input
							id={nameId}
							value={firstName}
							onChange={(event) => setFirstName(event.target.value)}
							placeholder="Jane"
							maxLength={MAX_FIRST_NAME}
							autoComplete="off"
							autoFocus
						/>
					</RowField>

					{fields.map((field) => (
						<InputField
							key={field.key}
							field={field}
							value={values[field.key]}
							onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
						/>
					))}
				</div>

				<DialogFooter>
					{fields.length < MAX_CONTACT_FIELDS && (
						<Button type="button" variant="ghost" onClick={() => setIsFieldsOpen(true)} className="text-muted-foreground sm:mr-auto">
							<Plus data-icon="inline-start" />
							Add a field
						</Button>
					)}
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
			<DialogContactFields isOpen={isFieldsOpen} onOpenChange={setIsFieldsOpen} />
		</>
	);
}

function InputField({ field, value, onChange }) {
	const inputId = useId();
	return (
		<RowField htmlFor={inputId} label={field.label} tag={fieldTag(field.key)}>
			{field.type === "date" ? (
				<InputDate id={inputId} value={value ?? ""} onChange={onChange} />
			) : (
				<Input
					id={inputId}
					type={field.type === "number" ? "number" : "text"}
					step={field.type === "number" ? "any" : undefined}
					value={value ?? ""}
					onChange={(event) => onChange(event.target.value)}
					maxLength={field.type === "text" ? 500 : undefined}
					autoComplete="off"
					className={field.type === "number" ? "tabular-nums" : undefined}
				/>
			)}
		</RowField>
	);
}

// A field with its name on the left and what prints it in emails on the right.
function RowField({ htmlFor, label, tag, children }) {
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex min-h-6 items-center justify-between gap-3">
				<label htmlFor={htmlFor} className="min-w-0 truncate text-sm font-medium">
					{label}
				</label>
				<ButtonMergeTag tag={tag} className="shrink" />
			</div>
			{children}
		</div>
	);
}
