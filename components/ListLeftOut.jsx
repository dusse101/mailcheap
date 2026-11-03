"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Loader2, Search } from "lucide-react";
import { bringBackContact, getLeftOut } from "@/app/(app)/contacts/actions";
import AvatarContact from "@/components/AvatarContact";
import LinkHelp from "@/components/LinkHelp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DROP_REASONS } from "@/lib/import-checks";
import { toast } from "@/lib/toast";

const SEARCH_DELAY_MS = 250;

// Who an import left out and why, under its counts on the contacts page: the role addresses and throwaway inboxes
// first, each with Bring back, then the ones that stay out, narrowed by what's typed in the search. Bringing one back
// refreshes the page, so the card's counts and the list of contacts follow. Nothing shows until the first page is in,
// nor for an import that only kept its counts.
export default function ListLeftOut({ importId }) {
	const timerRef = useRef(null);
	const requestRef = useRef(0);
	const [query, setQuery] = useState("");
	const [list, setList] = useState(null);
	const [isLoading, startLoading] = useTransition();

	useEffect(() => {
		const request = ++requestRef.current;
		fetchPage(importId).then((result) => {
			if (request === requestRef.current) setList(toList("", result));
		});
	}, [importId]);

	useEffect(() => () => clearTimeout(timerRef.current), []);

	// Only the latest answer shows; a next page goes after the contacts already shown.
	function load(text, cursor = null) {
		const request = ++requestRef.current;
		startLoading(async () => {
			const result = await fetchPage(importId, { search: text, cursor });
			if (request !== requestRef.current) return;
			if (cursor && result.error) return void toast.error(result.error);
			setList((current) => (cursor ? { ...toList(text, result), contacts: [...current.contacts, ...result.contacts] } : toList(text, result)));
		});
	}

	function changeQuery(event) {
		const text = event.target.value;
		setQuery(text);
		clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() => load(text.trim()), SEARCH_DELAY_MS);
	}

	function update(email, change) {
		setList((current) => ({ ...current, contacts: current.contacts.map((contact) => (contact.email === email ? { ...contact, ...change } : contact)) }));
	}

	if (!list || (list.contacts.length === 0 && !list.query && !list.error)) return null;
	return (
		<div className="flex flex-col gap-2.5 border-t border-border/60 pt-3 animate-fade-in first:border-t-0 first:pt-0">
			<p className="text-xs text-pretty text-muted-foreground">
				Left out to protect your deliverability. Bring back the ones you know signed up.{" "}
				<LinkHelp article="importing-contacts" section="bring-back" className="font-normal text-muted-foreground hover:text-foreground">
					Learn more
				</LinkHelp>
			</p>
			<div className="relative">
				<Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
				<Input
					type="text"
					enterKeyHint="search"
					value={query}
					onChange={changeQuery}
					placeholder="Search left-out addresses"
					aria-label="Search left-out addresses"
					autoComplete="off"
					autoCorrect="off"
					autoCapitalize="off"
					spellCheck={false}
					maxLength={254}
					className="h-8 pr-8 pl-8"
				/>
				{isLoading && <Loader2 aria-hidden="true" className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />}
			</div>
			{list.contacts.length > 0 ? (
				<ul className="-mx-1.5 flex max-h-80 flex-col overflow-y-auto overscroll-contain">
					{list.contacts.map((contact, index) => (
						<RowLeftOut
							key={contact.email}
							contact={contact}
							label={index === 0 || list.contacts[index - 1].canBringBack !== contact.canBringBack ? groupLabel(contact) : null}
							importId={importId}
							onUpdate={(change) => update(contact.email, change)}
						/>
					))}
					{list.nextCursor && (
						<li className="px-1.5 pt-1">
							<Button variant="ghost" size="sm" onClick={() => load(list.query, list.nextCursor)} disabled={isLoading} className="w-full text-muted-foreground">
								Show more
							</Button>
						</li>
					)}
				</ul>
			) : (
				<p role="status" className="py-1 text-xs text-muted-foreground">
					{list.error ?? `No left-out address matches “${list.query}”.`}
				</p>
			)}
		</div>
	);
}

// A refusal stays on its row instead of the button: the same click would only get it again.
function RowLeftOut({ contact, label, importId, onUpdate }) {
	const [isPending, startPending] = useTransition();

	function bringBack() {
		startPending(async () => {
			const result = await bringBackContact(importId, contact.email).catch(() => ({ error: "Couldn't bring it back, try again." }));
			if (!("broughtBack" in result)) return void toast.error(result.error);
			onUpdate(result.broughtBack ? { broughtBackAt: new Date().toISOString() } : { refusal: result.error });
		});
	}

	return (
		<>
			{label && <li className="px-1.5 pt-2 pb-1 text-xs font-medium text-muted-foreground first:pt-0.5">{label}</li>}
			<li className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">
				<AvatarContact email={contact.email} gravatarHash={contact.gravatarHash} size={24} />
				<div className="min-w-0 flex-1">
					<p className="truncate text-[13px] font-medium">{contact.email}</p>
					<p className={contact.refusal ? "text-xs text-pretty text-amber-700 dark:text-amber-400" : "truncate text-xs text-muted-foreground"}>
						{contact.refusal ?? DROP_REASONS[contact.reason] ?? contact.reason}
					</p>
				</div>
				{contact.broughtBackAt ? (
					<span className="flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-700 animate-fade-in dark:text-emerald-400">
						<Check aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
						Brought back
					</span>
				) : (
					contact.canBringBack &&
					!contact.refusal && (
						<Button variant="outline" size="xs" onClick={bringBack} disabled={isPending} aria-label={`Bring back ${contact.email}`} className="min-w-20">
							{isPending ? <Loader2 className="animate-spin" /> : "Bring back"}
						</Button>
					)
				)}
			</li>
		</>
	);
}

function groupLabel({ canBringBack }) {
	return canBringBack ? "Can come back" : "Stay out";
}

function fetchPage(importId, options) {
	return getLeftOut(importId, options).catch(() => ({ error: "Couldn't load them, try again." }));
}

function toList(query, result) {
	return { query, contacts: result.contacts ?? [], nextCursor: result.nextCursor ?? null, error: result.error ?? null };
}
