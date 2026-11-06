"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { UserRound } from "lucide-react";
import IconField from "@/components/IconField";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FIRST_NAME_KEY, SAMPLE_FIRST_NAME, formatMergeValue, inSentence } from "@/lib/merge-tags";

// Long enough that a pointer passing over a tag on its way elsewhere shows nothing.
const DELAY_MS = 400;
const FIRST_NAME = { key: FIRST_NAME_KEY, label: "First name", type: "text" };
// How much of the tag's sentence the examples quote, in words on each side: about what fits on their line.
const WORDS_BEFORE = 2;
const WORDS_AFTER = 1;
const TAG_OR_BREAK = /\{\{[^{}]*\}\}|\n/;
const SENTENCE_END = /[.!?]\s+/;

// What a tag's pill in the issue becomes (lib/editor-merge-tags.js), once a mouse rests on it: its sentence as the
// sample reader, Jane, gets it and as a reader without a value does, with where that text comes from and where to see a
// real reader's. A key, a click or scrolling closes it. Radix anchors a tooltip to an element, so an empty one stands
// over the pill's first line.
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
				if (!target.isConnected || editor.isDestroyed) return;
				setTag(readPill(editor, target));
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
				{field && <ContentMergeTag field={field} fallback={tag.fallback} before={tag.before} after={tag.after} />}
			</TooltipContent>
		</Tooltip>,
		document.body
	);
}

// The tooltip for a field, a tag's fallback (the text after its |) and the words around the tag.
export function ContentMergeTag({ field, fallback, before = "", after = "" }) {
	const name = inSentence(field.label);
	const example = getExample(field);
	return (
		<div className="flex w-72 flex-col gap-2">
			<span className="flex items-center gap-1.5 font-medium">
				{field.key === FIRST_NAME_KEY ? (
					<UserRound aria-hidden="true" className="size-3.5 shrink-0" />
				) : (
					<IconField type={field.type} className="size-3.5 shrink-0" />
				)}
				<span className="min-w-0 truncate">Each reader&apos;s {name}</span>
			</span>
			<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-md bg-background/10 px-2.5 py-2">
				<dt className="text-background/60">{example ? `${SAMPLE_FIRST_NAME} sees` : "A reader sees"}</dt>
				<dd>
					<Sentence before={before} after={after}>
						{example ?? <i>their {name}</i>}
					</Sentence>
				</dd>
				<dt className="text-background/60">No {name}</dt>
				<dd>
					<Sentence before={before} after={after}>
						{fallback}
					</Sentence>
				</dd>
			</dl>
			<p className="text-pretty text-background/60">
				{fallback ? (
					<>
						&ldquo;{shorten(fallback)}&rdquo; comes from after the <Code>|</Code>.
					</>
				) : (
					<>
						Fill the gap: add <Code>|</Code> and a word inside the braces.
					</>
				)}{" "}
				Pick a reader in Preview to see it for real.
			</p>
		</div>
	);
}

// The words around a tag in its sentence, up to another tag or a line break: "Hey " and "," for "Hey {{first_name}},".
export function getTagContext(text, from, to) {
	const before = text.slice(0, from).split(TAG_OR_BREAK).pop().split(SENTENCE_END).pop().replace(/\s+/g, " ");
	const after = text.slice(to).split(TAG_OR_BREAK)[0].match(/^[^.!?]*[.!?]?/)[0].replace(/\s+/g, " ");
	const wordsBefore = before.match(/\S+\s*/g) ?? [];
	const wordsAfter = after.match(/\s*\S+/g) ?? [];
	// Punctuation right after the tag goes with the next word: "Hi Jane, welcome." rather than "Hi Jane,…".
	if (wordsAfter.length > 1 && !/[\p{L}\p{N}]/u.test(wordsAfter[0])) wordsAfter.splice(0, 2, wordsAfter[0] + wordsAfter[1]);
	return {
		before: (wordsBefore.length > WORDS_BEFORE ? "…" : "") + wordsBefore.slice(-WORDS_BEFORE).join(""),
		after: wordsAfter.slice(0, WORDS_AFTER).join("") + (wordsAfter.length > WORDS_AFTER ? "…" : ""),
	};
}

// The tag's sentence with what it becomes in its place, set apart like the pill, or an empty slot.
function Sentence({ before, after, children }) {
	return (
		<span className="text-background/70">
			{before}
			{children ? (
				<span className="rounded-sm bg-background/15 px-1 text-background">{children}</span>
			) : (
				<span className="inline-block h-3.5 w-6 rounded-sm border border-dashed border-background/40 align-middle" />
			)}
			{after}
		</span>
	);
}

function Code({ children }) {
	return <code className="rounded-sm bg-background/15 px-1 font-mono">{children}</code>;
}

// Where the pill's first line is, in the window, with its key, its fallback and the words around it.
function readPill(editor, pill) {
	const { left, top, width, height } = pill.getClientRects()[0] ?? pill.getBoundingClientRect();
	const $pos = editor.state.doc.resolve(editor.view.posAtDOM(pill, 0));
	const block = $pos.parent;
	const text = block.textBetween(0, block.content.size, "\n", "\n");
	const context = getTagContext(text, $pos.parentOffset, $pos.parentOffset + pill.textContent.length);
	return { key: pill.dataset.key, fallback: pill.dataset.fallback ?? "", ...context, rect: { left, top, width, height } };
}

// What Jane, the sample reader, could have: a first name, or a number or a date as emails print them. Text could be
// anything.
function getExample({ key, type }) {
	if (key === FIRST_NAME_KEY) return SAMPLE_FIRST_NAME;
	if (type === "number") return formatMergeValue("number", 1250);
	if (type === "date") return formatMergeValue("date", "1991-04-12");
	return null;
}

function shorten(text) {
	return text.length > 24 ? `${text.slice(0, 23)}…` : text;
}
