import { decodeEntities } from "./clean-html.js";
import { escapeHtml } from "./render-email.js";

// {{first_name}} prints the reader's first name, {{first_name|there}} prints "there" for a reader without one, and each
// of the account's own fields (Account.contactFields, lib/contact-fields.js) prints the same way by its key: {{plan}},
// {{birthday|soon}}. They work in the subject, the preview text and the content of issues, welcome, confirmation and
// last-chance emails, filled in per recipient as the email goes out (lib/sending-rules.js). Anywhere public, like the
// archive, they print the fallback. Any other {{...}} goes out as written: another platform's tag, a typo, or text about
// templates.
const TAG_PATTERN = /\{\{\s*([a-z][a-z0-9_]{0,39})\s*(?:\|([^{}]{0,100}?))?\s*\}\}/gi;
export const FIRST_NAME_KEY = "first_name";
export const DEFAULT_FALLBACK = "there";
// Who the dashboard's previews and test emails greet when the test address isn't a contact with a name.
export const SAMPLE_FIRST_NAME = "Jane";
// A field's value as emails print it: the same in the browser's preview and on the server, whatever their time zone.
const NUMBER_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export function firstNameTag(fallback = DEFAULT_FALLBACK) {
	return fallback ? `{{first_name|${fallback}}}` : "{{first_name}}";
}

export function fieldTag(key) {
	return `{{${key}}}`;
}

// The type each tag prints as, by key: the first name, then the account's fields.
function getTagTypes(contactFields = []) {
	return new Map([[FIRST_NAME_KEY, "text"], ...(contactFields ?? []).map(({ key, type }) => [key, type])]);
}

// Each tag in the text that prints something, where it is, with its fallback ("" for none): what the editor draws as a
// placeholder.
export function findMergeTags(text, contactFields = []) {
	const types = getTagTypes(contactFields);
	return [...String(text ?? "").matchAll(new RegExp(TAG_PATTERN.source, "gi"))]
		.filter(([, key]) => types.has(key.toLowerCase()))
		.map((match) => ({
			index: match.index,
			length: match[0].length,
			key: match[1].toLowerCase(),
			fallback: (match[2] ?? "").trim(),
		}));
}

const ANY_TAG_PATTERN = /\{\{[^{}]{0,200}\}\}/g;
const WHOLE_TAG_PATTERN = new RegExp(`^${TAG_PATTERN.source}$`, "i");

// {{...}} that isn't the first name or one of the account's fields: another platform's tag, a typo, or a tag split by
// formatting. It would go out as written, so the review step points it out.
export function findBrokenMergeTags(values, contactFields = []) {
	const types = getTagTypes(contactFields);
	const broken = new Set();
	for (const value of values) {
		for (const [token] of String(value ?? "").matchAll(ANY_TAG_PATTERN)) {
			const match = WHOLE_TAG_PATTERN.exec(token);
			if (!match || !types.has(match[1].toLowerCase())) broken.add(token);
		}
	}
	return [...broken];
}

// The first name's and the account's fields' tags without a |: readers without a value get nothing in their place, a gap
// the review step points out. A | with nothing after it, as in {{plan|}}, leaves the gap on purpose. Each tag once, as
// written, with what it prints as a sentence names it: { tag, name }.
export function findTagsWithoutFallback(values, contactFields = []) {
	const names = new Map([[FIRST_NAME_KEY, "first name"], ...(contactFields ?? []).map(({ key, label }) => [key, inSentence(label)])]);
	const found = new Map();
	for (const value of values) {
		for (const [tag, key, fallback] of String(value ?? "").matchAll(new RegExp(TAG_PATTERN.source, "gi"))) {
			const name = names.get(key.toLowerCase());
			if (name && fallback === undefined && !found.has(tag)) found.set(tag, name);
		}
	}
	return [...found].map(([tag, name]) => ({ tag, name }));
}

// A field's label in a sentence: "Company" reads "company", "VIP tier" or "URL" as they are.
export function inSentence(label) {
	return /^\p{Lu}\p{Ll}/u.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
}

// What a field's value prints: text as it is, a number with its thousands separated (1,250), a date as people write it
// (April 12, 1991), as stored or as the API gives it (1991-04-12). "" without one.
export function formatMergeValue(type, value) {
	if (value === null || value === undefined || value === "") return "";
	if (type === "number") {
		const number = Number(value);
		return Number.isFinite(number) ? NUMBER_FORMAT.format(number) : "";
	}
	if (type === "date") {
		const date = value instanceof Date ? value : new Date(value);
		return Number.isNaN(date.getTime()) ? "" : DATE_FORMAT.format(date);
	}
	return String(value).trim();
}

// firstName and values (the reader's field values, by key) fill the tags; contactFields says which keys are tags.
// isHtml: the value is HTML, where what's filled in prints as text. The fallback is read as HTML text first, so
// "Tom &amp; Jerry", as the editor writes it, stays as it was, and markup typed into it shows as written, never as markup.
export function fillMergeTags(value, { firstName = "", values = {}, contactFields = [], isHtml = false } = {}) {
	const text = String(value ?? "");
	if (!text.includes("{{")) return text;
	const types = getTagTypes(contactFields);
	return text.replace(TAG_PATTERN, (tag, rawKey, fallback = "") => {
		const key = rawKey.toLowerCase();
		if (!types.has(key)) return tag;
		const filled =
			key === FIRST_NAME_KEY ? String(firstName ?? "").trim() : formatMergeValue(types.get(key), values && Object.hasOwn(values, key) ? values[key] : null);
		if (filled) return isHtml ? escapeHtml(filled) : filled;
		return isHtml ? escapeHtml(decodeEntities(fallback.trim())) : fallback.trim();
	});
}

// What a reader without a first name or field values sees: the archive, its share images and anything else public.
export function withMergeFallbacks(value, { isHtml = false, contactFields = [] } = {}) {
	return fillMergeTags(value, { isHtml, contactFields });
}

// A page's address from a subject: every tag gives way to its fallback, whether or not it's one of the account's, so
// no address holds braces, and the address is the same wherever it's worked out.
export function withoutMergeTags(value) {
	return String(value ?? "").replace(TAG_PATTERN, (_, __, fallback = "") => fallback.trim());
}

// The dashboard's previews: what a reader called Jane, with no field values, sees.
export function fillSampleName(value, { isHtml = false, contactFields = [] } = {}) {
	return fillMergeTags(value, { firstName: SAMPLE_FIRST_NAME, contactFields, isHtml });
}

// A subject is a header: whatever the values hold, it stays on one line.
export function fillSubject(subject, options) {
	return fillMergeTags(subject, options)
		.replace(/[\r\n]+/g, " ")
		.trim();
}

// Who the previews show an email to until a contact is picked: a first name, and no field values, so each field
// prints its fallback, as for a reader without one.
export const SAMPLE_READER = Object.freeze({ firstName: SAMPLE_FIRST_NAME });

// One reader's copy of an email, from a contact (its first name and its fields' values) or SAMPLE_READER, with the
// account's fields. Each recipient's email and the dashboard's previews are filled in here, so a preview shows what that
// reader gets.
export function fillForReader({ subject, previewText, html, text }, reader, contactFields = []) {
	const options = { firstName: reader?.firstName ?? "", values: reader?.fields ?? {}, contactFields };
	return {
		subject: fillSubject(subject, options),
		previewText: fillMergeTags(previewText, options),
		html: fillMergeTags(html, { ...options, isHtml: true }),
		text: fillMergeTags(text, options),
	};
}
