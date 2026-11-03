"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Check, ChevronDown, Loader2, Search, UserRound, UsersRound } from "lucide-react";
import { findPreviewContacts } from "@/app/(app)/campaigns/actions";
import AvatarContact from "@/components/AvatarContact";
import LinkHelpFields from "@/components/LinkHelpFields";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SAMPLE_FIRST_NAME } from "@/lib/merge-tags";
import { cn } from "@/lib/utils";

const SEARCH_DELAY_MS = 200;
// A touch screen's keyboard would cover the list it opens on, so there the search field waits for a tap.
const FINE_POINTER = "(pointer: fine)";

// Who the email preview shows the email to: the sample reader, one of the readers the issue's sections name (groups,
// lib/sections.js) until a search is typed, or one of the newsletter's active contacts, the newest first or found by any
// part of their address or first name, each with whether they're in the segments the sections name (segmentIds).
// contact: null for the sample reader. The search field keeps the focus while the list is announced as its options. The
// list is dark in both themes, like the preview's controls around it, and opaque, so the dimmed dashboard never shows
// through it.
export default function PickerReader({ newsletterId, contact, groups = [], segmentIds = [], onChange }) {
	const listId = useId();
	const inputRef = useRef(null);
	const timerRef = useRef(null);
	const requestRef = useRef(0);
	const [isOpen, setIsOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [results, setResults] = useState(null);
	const [active, setActive] = useState(0);
	const [isSearching, startSearching] = useTransition();
	const contacts = results?.contacts ?? [];
	const shownGroups = query.trim() ? [] : groups;
	const options = [null, ...shownGroups, ...contacts];
	const activeIndex = Math.min(active, options.length - 1);
	// Enter picks a contact only from the list for what's typed, not one still showing for the text before.
	const isStale = (results?.query ?? null) !== query.trim();
	const optionId = (position) => `${listId}-option-${position}`;

	useEffect(() => () => clearTimeout(timerRef.current), []);

	// Only the latest answer shows.
	function search(text) {
		const request = ++requestRef.current;
		startSearching(async () => {
			const result = await findPreviewContacts(newsletterId, text, segmentIds).catch(() => ({ error: "Couldn't load your contacts, try again." }));
			if (request === requestRef.current) setResults({ query: text, ...result });
		});
	}

	function changeOpen(next) {
		setIsOpen(next);
		clearTimeout(timerRef.current);
		if (!next) return;
		setQuery("");
		setActive(0);
		search("");
	}

	function changeQuery(event) {
		const next = event.target.value;
		setQuery(next);
		setActive(next.trim() ? 1 : 0);
		clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() => search(next.trim()), SEARCH_DELAY_MS);
	}

	function pick(option) {
		onChange(option);
		changeOpen(false);
	}

	function moveActive(step) {
		const next = (activeIndex + step + options.length) % options.length;
		setActive(next);
		document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" });
	}

	function onKeyDown(event) {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			moveActive(event.key === "ArrowDown" ? 1 : -1);
		} else if (event.key === "Enter") {
			event.preventDefault();
			if (activeIndex === 0 || !isStale) pick(options[activeIndex]);
		}
	}

	return (
		<Popover open={isOpen} onOpenChange={changeOpen} modal>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="flex h-10 max-w-full min-w-0 items-center gap-2 rounded-full bg-white/10 pr-3 pl-1 text-sm font-medium text-white outline-none transition-[background-color,scale] duration-150 ease-out hover:bg-white/15 focus-visible:ring-3 focus-visible:ring-white/40 active:scale-[0.97] data-[state=open]:bg-white/15"
				>
					<AvatarReader contact={contact} className="bg-white/15 text-white" />
					<span className="truncate">
						<span className="sr-only">Preview as </span>
						{contact ? (contact.isGroup ? contact.name : contact.firstName || contact.email) : "Sample reader"}
					</span>
					<ChevronDown aria-hidden="true" className="size-4 shrink-0 text-white/60" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				sideOffset={8}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					if (window.matchMedia(FINE_POINTER).matches) inputRef.current?.focus();
				}}
				className="dark flex w-[min(20rem,calc(100vw-1.5rem))] flex-col overflow-hidden bg-zinc-900 p-0 shadow-2xl shadow-black/50 ring-white/15 scheme-dark"
			>
				<div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
					<Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
					<input
						ref={inputRef}
						type="text"
						role="combobox"
						aria-label="Search contacts"
						aria-autocomplete="list"
						aria-expanded="true"
						aria-controls={listId}
						aria-activedescendant={optionId(activeIndex)}
						placeholder="Search contacts"
						autoComplete="off"
						autoCorrect="off"
						autoCapitalize="off"
						spellCheck={false}
						enterKeyHint="go"
						maxLength={100}
						value={query}
						onChange={changeQuery}
						onKeyDown={onKeyDown}
						className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
					/>
					{isSearching && <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin text-muted-foreground" />}
				</div>
				<div className="min-h-0 overflow-y-auto overscroll-contain p-1">
					<div id={listId} role="listbox" aria-label="Preview as">
						<OptionReader
							id={optionId(0)}
							name="Sample reader"
							detail={`Called ${SAMPLE_FIRST_NAME}`}
							isActive={activeIndex === 0}
							isPicked={!contact}
							onPoint={() => setActive(0)}
							onPick={() => pick(null)}
						/>
						{shownGroups.length > 0 && (
							<div role="group" aria-labelledby={`${listId}-groups`}>
								<p id={`${listId}-groups`} className="px-2 pt-2.5 pb-1 text-xs font-medium text-muted-foreground">
									Readers your sections name
								</p>
								{shownGroups.map((item, index) => (
									<OptionReader
										key={item.id}
										id={optionId(index + 1)}
										contact={item}
										name={item.name}
										detail={`Sample reader, called ${SAMPLE_FIRST_NAME}`}
										isActive={activeIndex === index + 1}
										isPicked={contact?.id === item.id}
										onPoint={() => setActive(index + 1)}
										onPick={() => pick(item)}
									/>
								))}
							</div>
						)}
						{contacts.length > 0 && (
							<div role="group" aria-labelledby={`${listId}-contacts`}>
								<p id={`${listId}-contacts`} className="px-2 pt-2.5 pb-1 text-xs font-medium text-muted-foreground">
									{results.query ? "Contacts" : "Newest contacts"}
								</p>
								{contacts.map((item, index) => {
									const position = shownGroups.length + index + 1;
									return (
										<OptionReader
											key={item.id}
											id={optionId(position)}
											contact={item}
											name={item.firstName || item.email}
											detail={item.firstName ? item.email : "No first name"}
											isActive={activeIndex === position}
											isPicked={contact?.id === item.id}
											onPoint={() => setActive(position)}
											onPick={() => pick(item)}
										/>
									);
								})}
							</div>
						)}
					</div>
					{results && contacts.length === 0 && (
						<p role="status" className="px-2 pt-2 pb-2.5 text-sm text-pretty text-muted-foreground">
							{results.error ?? (results.query ? `No active contact matches “${results.query}”.` : "No active contacts yet.")}
						</p>
					)}
				</div>
				<LinkHelpFields className="shrink-0 border-t px-3 py-2.5 focus-visible:bg-muted focus-visible:text-foreground" />
			</PopoverContent>
		</Popover>
	);
}

function OptionReader({ id, contact = null, name, detail, isActive, isPicked, onPoint, onPick }) {
	return (
		<div
			id={id}
			role="option"
			aria-selected={isActive}
			aria-current={isPicked || undefined}
			onPointerMove={onPoint}
			onMouseDown={(event) => event.preventDefault()}
			onClick={onPick}
			className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5", isActive && "bg-muted")}
		>
			<AvatarReader contact={contact} className="bg-muted text-muted-foreground" />
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm font-medium">{name}</span>
				<span className="block truncate text-xs text-muted-foreground">{detail}</span>
			</span>
			{isPicked && <Check aria-hidden="true" className="size-4 shrink-0" />}
		</div>
	);
}

// A contact's picture, as the Contacts page shows it, a person for the sample reader, or people for the readers a
// section names.
function AvatarReader({ contact, className }) {
	if (contact && !contact.isGroup) return <AvatarContact email={contact.email} gravatarHash={contact.gravatarHash} size={32} />;
	const Icon = contact ? UsersRound : UserRound;
	return (
		<span aria-hidden="true" className={cn("grid size-8 shrink-0 place-items-center rounded-full", className)}>
			<Icon className="size-4" />
		</span>
	);
}
