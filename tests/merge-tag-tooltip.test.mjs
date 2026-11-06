import assert from "node:assert/strict";
import { test } from "node:test";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentMergeTag, getTagContext } from "../components/TooltipMergeTag.jsx";
import { MergeTags } from "../lib/editor-merge-tags.js";

// A tag's pill in the editor (lib/editor-merge-tags.js) and the tooltip pointing at it shows
// (components/TooltipMergeTag.jsx): its sentence as Jane gets it and as a reader without a value does, where that text
// comes from, and Preview.
const FIELDS = [
	{ key: "company", label: "Company", type: "text" },
	{ key: "vip_tier", label: "VIP tier", type: "text" },
	{ key: "points", label: "Points", type: "number" },
	{ key: "birthday", label: "Birthday", type: "date" },
];
const FIRST_NAME = { key: "first_name", label: "First name", type: "text" };

function renderTooltip(props) {
	return renderToStaticMarkup(createElement(ContentMergeTag, props));
}

// Its words as read: a space between its lines, none within a sentence.
function readTooltip(props) {
	return renderTooltip(props)
		.replace(/<\/?(dl|dt|dd|p|div)\b[^>]*>/g, " ")
		.replace(/<[^>]+>/g, "")
		.replaceAll("&#x27;", "'")
		.replace(/\s+/g, " ")
		.trim();
}

test("each pill carries its tag's key and fallback", () => {
	const editor = new Editor({
		element: null,
		extensions: [StarterKit, MergeTags.configure({ contactFields: FIELDS })],
		content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi {{first_name|there}}, {{ points }} {{nope}}" }] }] },
	});
	// Mounting it in a page adds its plugins.
	editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
	const plugin = editor.state.plugins.find((candidate) => candidate.key.startsWith("mergeTags$"));
	const pills = plugin.getState(editor.state).find();
	assert.deepEqual(
		pills.map(({ from, to, type }) => [editor.state.doc.textBetween(from, to), type.attrs]),
		[
			["{{first_name|there}}", { class: "merge-tag", "data-key": "first_name", "data-fallback": "there" }],
			["{{ points }}", { class: "merge-tag", "data-key": "points", "data-fallback": "" }],
		]
	);
	editor.destroy();
});

test("the tooltip reads the tag's sentence as Jane gets it and as a reader without one does", () => {
	assert.equal(
		readTooltip({ field: FIRST_NAME, fallback: "there", before: "Hey ", after: "," }),
		"Each reader's first name Jane sees Hey Jane, No first name Hey there, “there” comes from after the |. Pick a reader in Preview to see it for real."
	);
	assert.equal(
		readTooltip({ field: FIELDS[0], fallback: "your team", before: "…crew at ", after: " gets…" }),
		"Each reader's company A reader sees …crew at their company gets… No company …crew at your team gets… “your team” comes from after the |. Pick a reader in Preview to see it for real."
	);
});

test("without a fallback, the reader without one gets a gap, and the tooltip says how to fill it", () => {
	const props = { field: FIELDS[2], fallback: "", before: "You have ", after: " points…" };
	assert.equal(
		readTooltip(props),
		"Each reader's points Jane sees You have 1,250 points… No points You have points… Fill the gap: add | and a word inside the braces. Pick a reader in Preview to see it for real."
	);
	assert.match(renderTooltip(props), /You have <span class="[^"]*border-dashed[^"]*"><\/span> points…/);
});

test("its examples follow the field's type and name", () => {
	assert.match(readTooltip({ field: FIELDS[3], fallback: "soon" }), /Each reader's birthday Jane sees April 12, 1991 No birthday soon/);
	assert.match(readTooltip({ field: FIELDS[1], fallback: "gold" }), /Each reader's VIP tier A reader sees their VIP tier No VIP tier gold/);
	assert.match(readTooltip({ field: FIRST_NAME, fallback: "a very long way to say hello to you" }), /“a very long way to say …” comes from/);
});

test("the examples quote a few words of the tag's sentence, up to another tag or a line break", () => {
	const quote = (text, tag) => getTagContext(text, text.indexOf(tag), text.indexOf(tag) + tag.length);
	assert.deepEqual(quote("Hey {{first_name|there}},", "{{first_name|there}}"), { before: "Hey ", after: "," });
	assert.deepEqual(quote("Hi {{first_name}}, welcome to the list.", "{{first_name}}"), { before: "Hi ", after: ", welcome…" });
	assert.deepEqual(quote("This week the whole crew at {{company}} gets early access.", "{{company}}"), { before: "…crew at ", after: " gets…" });
	assert.deepEqual(quote("The seed swap. You have {{points}} points. See you", "{{points}}"), { before: "You have ", after: " points." });
	assert.deepEqual(quote("Hey {{first_name}} {{plan}} plan", "{{first_name}}"), { before: "Hey ", after: "" });
	assert.deepEqual(quote("Thanks\n{{first_name}}", "{{first_name}}"), { before: "", after: "" });
	assert.deepEqual(quote("{{first_name}}", "{{first_name}}"), { before: "", after: "" });
});
