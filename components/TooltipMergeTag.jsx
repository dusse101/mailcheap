"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { UserRound } from "lucide-react";
import IconField from "@/components/IconField";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FIRST_NAME_KEY, SAMPLE_FIRST_NAME, formatMergeValue } from "@/lib/merge-tags";

// Long enough that a pointer passing over a tag on its way elsewhere shows nothing.
const DELAY_MS = 400;
const FIRST_NAME = { key: FIRST_NAME_KEY, label: "First name", type: "text" };

// What a tag's pill in the issue prints (lib/editor-merge-tags.js), once a mouse rests on it: its field, what a reader
// with a value gets and one without, and where to see a real reader's. A key, a click or scrolling closes it. Radix
// anchors a tooltip to an element, so an empty one stands over the pill's first line.
export default function TooltipMergeTag({ editor, contactFields }) {
	const [tag, setTag] = useState(null);
	const [isOpen, setIsOpen] = useState(false);

	useEffect(() => {
		const { dom } = editor.view;
		let pill = null;
		let timer = null;
		function hide() {
			clearTimeout(timer);
			pill = null;
			setIsOpen(false);
		}
		function onOver(event) {
			const target = event.target instanceof Element ? event.target.closest(".merge-tag") : null;
			if (target === pill) return;
			hide();
			if (!target || event.pointerType === "touch" || event.buttons !== 0) return;
			pill = target;
			timer = setTimeout(() => {
				setTag(readPill(target));
				setIsOpen(true);
			}, DELAY_MS);
		}
		dom.addEventListener("pointerover", onOver);
		dom.addEventListener("pointerleave", hide);
		dom.addEventListener("pointerdown", hide);
		dom.addEventListener("keydown", hide);
		window.addEventListener("scroll", hide, true);
		return () => {
			clearTimeout(timer);
			dom.removeEventListener("pointerover", onOver);
			dom.removeEventListener("pointerleave", hide);
			dom.removeEventListener("pointerdown", hide);
			dom.removeEventListener("keydown", hide);
			window.removeEventListener("scroll", hide, true);
		};
	}, [editor]);

	const field = tag && (tag.key === FIRST_NAME_KEY ? FIRST_NAME : contactFields.find(({ key }) => key === tag.key));
	return createPortal(
		<Tooltip open={isOpen && Boolean(field)} onOpenChange={(open) => !open && setIsOpen(false)}>
			<TooltipTrigger asChild>
				<span aria-hidden="true" className="pointer-events-none fixed" style={tag?.rect} />
			</TooltipTrigger>
			<TooltipContent className="flex-col items-stretch px-3 py-2.5">
				{field && <ContentMergeTag field={field} fallback={tag.fallback} />}
			</TooltipContent>
		</Tooltip>,
		document.body
	);
}

// The tooltip's words for a field and a tag's fallback, the text after its |.
export function ContentMergeTag({ field, fallback }) {
	const example = getExample(field);
	return (
		<div className="flex w-60 flex-col gap-2">
			<span className="flex items-center gap-1.5 font-medium">
				{field.key === FIRST_NAME_KEY ? (
					<UserRound aria-hidden="true" className="size-3.5 shrink-0" />
				) : (
					<IconField type={field.type} className="size-3.5 shrink-0" />
				)}
				<span className="min-w-0 truncate">{field.label}</span>
			</span>
			<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md bg-background/10 px-2.5 py-1.5">
				<dt className="text-background/60">With one</dt>
				<dd className="truncate">{example ? `like ${example}` : `their ${inSentence(field.label)}`}</dd>
				<dt className="text-background/60">Without one</dt>
				<dd className="truncate">{fallback || <span className="text-background/60">nothing</span>}</dd>
			</dl>
			<p className="text-pretty text-background/60">
				{fallback ? (
					<>
						After the <Code>|</Code> is what readers without one get.
					</>
				) : (
					<>
						Add <Code>|</Code> and a word before the <Code>{"}}"}</Code> for readers without one.
					</>
				)}{" "}
				Pick a reader in Preview to see theirs.
			</p>
		</div>
	);
}

function Code({ children }) {
	return <code className="rounded-sm bg-background/15 px-1 font-mono">{children}</code>;
}

// Where the pill's first line is, in the window, with its key and its fallback.
function readPill(pill) {
	const { left, top, width, height } = pill.getClientRects()[0] ?? pill.getBoundingClientRect();
	return { key: pill.dataset.key, fallback: pill.dataset.fallback ?? "", rect: { left, top, width, height } };
}

// What a reader with a value could get: a first name, or a number or a date as emails print them. Text could be anything.
function getExample({ key, type }) {
	if (key === FIRST_NAME_KEY) return SAMPLE_FIRST_NAME;
	if (type === "number") return formatMergeValue("number", 1250);
	if (type === "date") return formatMergeValue("date", "1991-04-12");
	return null;
}

// "Company" reads "company" in a sentence, "VIP tier" or "URL" as they are.
function inSentence(label) {
	return /^\p{Lu}\p{Ll}/u.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
}
