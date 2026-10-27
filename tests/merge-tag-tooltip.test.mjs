import assert from "node:assert/strict";
import { test } from "node:test";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentMergeTag } from "../components/TooltipMergeTag.jsx";
import { MergeTags } from "../lib/editor-merge-tags.js";

// A tag's pill in the editor (lib/editor-merge-tags.js) and the tooltip pointing at it shows
// (components/TooltipMergeTag.jsx): its field, what a reader with a value gets, the fallback after its |, and Preview.
const FIELDS = [
	{ key: "company", label: "Company", type: "text" },
	{ key: "vip_tier", label: "VIP tier", type: "text" },
	{ key: "points", label: "Points", type: "number" },
	{ key: "birthday", label: "Birthday", type: "date" },
];

function readTooltip(field, fallback = "") {
	return renderToStaticMarkup(createElement(ContentMergeTag, { field, fallback }))
		.replace(/<[^>]+>/g, " ")
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

test("the tooltip says what a reader gets with a value and without one, and points to Preview", () => {
	assert.equal(
		readTooltip({ key: "first_name", label: "First name", type: "text" }, "there"),
		"First name With one like Jane Without one there After the | is what readers without one get. Pick a reader in Preview to see theirs."
	);
	assert.equal(
		readTooltip(FIELDS[2]),
		"Points With one like 1,250 Without one nothing Add | and a word before the }} for readers without one. Pick a reader in Preview to see theirs."
	);
});

test("its example follows the field's type, and text fields read their own name", () => {
	assert.match(readTooltip(FIELDS[3], "soon"), /With one like April 12, 1991 Without one soon/);
	assert.match(readTooltip(FIELDS[0], "your team"), /With one their company Without one your team/);
	assert.match(readTooltip(FIELDS[1]), /With one their VIP tier/);
});
