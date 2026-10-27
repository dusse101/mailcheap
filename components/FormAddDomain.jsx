"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { addDomainAction } from "@/app/(app)/domains/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ADD_DOMAIN_ID } from "@/lib/newsletters";
import { normalizeDomainInput } from "@/lib/sender-rules";
import { toast } from "@/lib/toast";

const PLACEHOLDER_DOMAIN = "yourdomain.com";

// Links to ADD_DOMAIN_PATH open with the domain field focused.
export default function FormAddDomain({ fromLocalPart }) {
	const id = useId();
	const domainRef = useRef(null);
	const [domainInput, setDomainInput] = useState("");
	const [, action, isPending] = useActionState(async (previous, formData) => {
		const result = await addDomainAction(previous, formData);
		if (result?.error) toast.error(result.error);
		else {
			toast.success(`${result.domain} added. Add its DNS records next.`);
			setDomainInput("");
		}
		return result;
	}, null);
	const domain = normalizeDomainInput(domainInput);

	useEffect(() => {
		if (window.location.hash === `#${ADD_DOMAIN_ID}`) domainRef.current?.focus();
	}, []);

	// Only an address or a link is rewritten: a plain domain keeps the browser's own paste, and its undo.
	function pasteDomain(event) {
		const text = event.clipboardData.getData("text");
		const pasted = normalizeDomainInput(text);
		if (!pasted || pasted === text.trim()) return;
		event.preventDefault();
		setDomainInput(pasted);
	}

	return (
		<form id={ADD_DOMAIN_ID} action={action} className="scroll-mt-24 overflow-hidden rounded-xl bg-card shadow-border animate-enter">
			<div className="flex flex-col gap-4 p-4 sm:p-5">
				<div>
					<h2 className="font-semibold tracking-tight">Add your domain</h2>
					<p className="mt-1 text-sm text-muted-foreground">Send from an address at your domain.</p>
				</div>
				<div className="flex flex-col gap-2">
					<label htmlFor={`${id}-domain`} className="text-sm font-medium">
						Domain
					</label>
					<div className="flex flex-col gap-2 sm:flex-row">
						<Input
							ref={domainRef}
							id={`${id}-domain`}
							name="domain"
							value={domainInput}
							required
							placeholder={PLACEHOLDER_DOMAIN}
							inputMode="url"
							autoComplete="off"
							autoCapitalize="none"
							spellCheck={false}
							className="h-10 font-mono sm:flex-1"
							onChange={(event) => setDomainInput(event.target.value)}
							onPaste={pasteDomain}
							onBlur={() => setDomainInput(domain)}
						/>
						<Button type="submit" disabled={isPending} className="h-10 sm:min-w-32">
							{isPending ? <Loader2 className="animate-spin" /> : <Plus data-icon="inline-start" />}
							Add domain
						</Button>
					</div>
				</div>
			</div>
			<div className="flex flex-col gap-3 border-t border-border/60 bg-muted/40 px-4 py-3.5 text-sm sm:px-5">
				<RowPreview label="Sends from">
					<span className="min-w-0 truncate font-mono text-base sm:text-[13px]">
						{fromLocalPart}@<TextDomain domain={domain} />
					</span>
				</RowPreview>
			</div>
		</form>
	);
}

function RowPreview({ label, children }) {
	return (
		<div className="grid gap-1.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center sm:gap-4">
			<span className="text-muted-foreground">{label}</span>
			<div className="flex min-w-0">{children}</div>
		</div>
	);
}

function TextDomain({ domain }) {
	return domain || <span className="text-muted-foreground">{PLACEHOLDER_DOMAIN}</span>;
}
