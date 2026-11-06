import assert from "node:assert/strict";
import { test } from "node:test";
import { Editor, getSchema } from "@tiptap/core";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MenuMergeTag, getFieldItems } from "../components/MenuSlash.jsx";
import { ButtonBlock } from "../lib/editor-button.js";
import { findMergeTagMatch, matchFields } from "../lib/editor-merge-tags.js";

// Typing "{{" in the editor suggests the fields a tag could be (components/MenuSlash.jsx): what the menu reads as the
// tag being typed (lib/editor-merge-tags.js), which fields it shows for it, and what picking one writes.
const FIELDS = [
	{ key: "company", label: "Company", type: "text" },
	{ key: "gift_points", label: "Gift points", type: "number" },
	{ key: "points", label: "Points", type: "number" },
	{ key: "birthday", label: "Birthday", type: "date" },
];
const schema = getSchema([StarterKit, ButtonBlock]);

// The paragraph's text with the caret at its ‸, or at its end.
function typed(text, type = "paragraph") {
	const caret = text.includes("‸") ? text.indexOf("‸") : text.length;
	const content = text.replace("‸", "");
	const doc = schema.node("doc", null, [schema.node(type, null, content ? [schema.text(content)] : [])]);
	const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1 + caret) });
	const match = findMergeTagMatch({ $position: state.selection.$from });
	return match && { query: match.query, text: doc.textBetween(match.range.from, match.range.to) };
}

function titles(query) {
	return matchFields(getFieldItems(FIELDS), query).map(({ title }) => title);
}

test("the tag being typed is the {{ before the caret and the start of a key", () => {
	assert.deepEqual(typed("Hi {{"), { query: "", text: "{{" });
	assert.deepEqual(typed("Hi {{fi"), { query: "fi", text: "{{fi" });
	assert.deepEqual(typed("Hi {{ fi"), { query: "fi", text: "{{ fi" });
	assert.deepEqual(typed("{{plan}} and {{po"), { query: "po", text: "{{po" }, "only the last one");
	assert.deepEqual(typed("Claim your {{po", "button"), { query: "po", text: "{{po" }, "in a button's text too");
});

test("a |, a closed tag or a space after the key ends it", () => {
	assert.equal(typed("Hi {{first_name|"), null);
	assert.equal(typed("Hi {{first_name|th"), null);
	assert.equal(typed("Hi {{first_name}}"), null);
	assert.equal(typed("Hi {{first name"), null);
	assert.equal(typed("Hi {fi"), null);
});

test("the rest of a tag already after the caret goes in what a pick replaces", () => {
	assert.deepEqual(typed("Hi {{first_‸name}},"), { query: "first_", text: "{{first_name}}" });
	assert.deepEqual(typed("Hi {{po‸ints|0}} left"), { query: "po", text: "{{points|0}}" });
	assert.deepEqual(typed("Hi {{po‸ and more"), { query: "po", text: "{{po" }, "text that isn't a tag stays");
});

test("it suggests the first name and the account's fields, by key or name, those starting with what's typed first", () => {
	assert.deepEqual(titles(""), ["First name", "Company", "Gift points", "Points", "Birthday"]);
	assert.deepEqual(titles("po"), ["Points", "Gift points"]);
	assert.deepEqual(titles("NA"), ["First name"]);
	assert.deepEqual(titles("first_n"), ["First name"]);
	assert.deepEqual(titles("giftp"), ["Gift points"]);
	assert.deepEqual(titles("plan"), []);
});

test("its menu lists them with their keys, the first one picked, and shows nothing when none match", () => {
	const html = renderToStaticMarkup(createElement(MenuMergeTag, { items: matchFields(getFieldItems(FIELDS), "po"), query: "po", command() {} }));
	assert.match(html, />Contact fields</);
	assert.match(html, /aria-selected="true"[^>]*>.*?>Points<\/span><span[^>]*>points<\/span>/);
	assert.match(html, /aria-selected="false"[^>]*>.*?>Gift points<\/span><span[^>]*>gift_points<\/span>/);
	assert.equal(renderToStaticMarkup(createElement(MenuMergeTag, { items: [], query: "plan", command() {} })), "");
});

test("picking a field writes its whole tag in place of what was typed", () => {
	for (const [text, title, expected] of [
		["Hi {{fi", "First name", "Hi {{first_name|there}}"],
		["You have {{po‸ points", "Points", "You have {{points}} points"],
		["Hi {{first_‸name}}, welcome", "First name", "Hi {{first_name|there}}, welcome"],
	]) {
		const content = text.replace("‸", "");
		const editor = new Editor({
			element: null,
			extensions: [StarterKit],
			content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: content }] }] },
		});
		editor.commands.setTextSelection(1 + (text.includes("‸") ? text.indexOf("‸") : text.length));
		const { range } = findMergeTagMatch({ $position: editor.state.selection.$from });
		const tag = getFieldItems(FIELDS)
			.find((item) => item.title === title)
			.run({ insertContent: (inserted) => inserted });
		editor.view.dispatch(editor.state.tr.insertText(tag, range.from, range.to));
		assert.equal(editor.state.doc.textContent, expected);
		editor.destroy();
	}
});
