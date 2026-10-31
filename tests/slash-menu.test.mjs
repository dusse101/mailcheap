import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LinkHelpFields from "../components/LinkHelpFields.jsx";
import MenuSlash, { getSlashItems } from "../components/MenuSlash.jsx";
import { fitMenu, getSlashMenu, listSlashOptions } from "../lib/editor-slash-menu.js";

// The editor's slash menu (components/MenuSlash.jsx, lib/editor-slash-menu.js): the blocks first, the contact fields
// behind one entry, a search that reaches both, how to add fields at the end of their list, and where the menu shows.
// Its links into the help center: tests/help.test.mjs.
const FIELDS = [
	{ key: "plan", label: "Plan", type: "text" },
	{ key: "stripe_customer_id", label: "Stripe customer ID", type: "text" },
	{ key: "campaign_channel", label: "Campaign channel", type: "text" },
	{ key: "birthday", label: "Birthday", type: "date" },
];
const BLOCKS = ["Text", "Heading 1", "Heading 2", "Heading 3", "Bulleted list", "Numbered list", "Image", "Quote", "Divider", "Box", "Button", "HTML"];

// What the arrows go through, in order: items by title, the menu's own rows by id (the entry to the fields, back from
// them, and how to add them).
function rows(query, { view = "blocks", fields = FIELDS } = {}) {
	return listSlashOptions(getSlashMenu(getSlashItems(fields), { query, view })).map((option) => (option.run ? option.title : option.id));
}

function render(query, fields = FIELDS) {
	return renderToStaticMarkup(createElement(MenuSlash, { items: getSlashItems(fields), query, command: () => {} }));
}

test("the blocks come first, and the contact fields wait behind one entry under them", () => {
	assert.deepEqual(rows(""), [...BLOCKS, "fields"]);
	assert.deepEqual(rows("", { fields: [] }), [...BLOCKS, "fields"], "the first name is behind it too");
	const html = render("");
	assert.match(html, />Contact fields<\/span><span[^>]*>Filled in for each reader</);
	assert.ok(html.indexOf(">Box<") < html.indexOf(">Contact fields<"));
	for (const title of ["First name", "Plan", "Stripe customer ID", "Campaign channel", "Birthday"]) assert.ok(!html.includes(`>${title}<`), title);
});

test("inside the entry: back, the first name, each field, then how to add them", () => {
	assert.deepEqual(rows("", { view: "fields" }), ["back", "First name", "Plan", "Stripe customer ID", "Campaign channel", "Birthday", "help"]);
	assert.deepEqual(rows("", { view: "fields", fields: [] }), ["back", "First name", "help"], "without fields of the account's own");
	assert.deepEqual(rows("bir", { view: "fields" }), ["back", "Birthday", "help"], "typing narrows the fields");
	assert.deepEqual(rows("pl", { view: "fields" }), ["back", "Plan", "help"], "and leaves the blocks out");
	assert.deepEqual(rows("zzz", { view: "fields" }), ["back", "help"], "nothing found keeps the way back");
	const menu = getSlashMenu(getSlashItems(FIELDS), { view: "fields" });
	assert.equal(menu.header.id, "back");
	assert.equal(menu.footer.id, "help");
});

test("what's typed after the slash finds fields by name or key, in a group of their own under the blocks", () => {
	assert.deepEqual(rows("pl"), ["Image", "Plan"], "Image's keywords have upload");
	assert.deepEqual(rows("plan"), ["Plan"]);
	assert.deepEqual(rows("PLAN"), ["Plan"]);
	assert.deepEqual(rows("stripe"), ["Stripe customer ID"]);
	assert.deepEqual(rows("campaign_ch"), ["Campaign channel"], "by key");
	assert.deepEqual(rows("first"), ["First name"]);
	assert.deepEqual(rows("field"), ["First name", "Plan", "Stripe customer ID", "Campaign channel", "Birthday"]);
	assert.deepEqual(rows("quote"), ["Quote"]);
	assert.deepEqual(rows("zzz"), []);

	const { groups, footer } = getSlashMenu(getSlashItems(FIELDS), { query: "pl" });
	assert.deepEqual(
		groups.map(({ label, items }) => [label, items.map(({ title }) => title)]),
		[
			[undefined, ["Image"]],
			["Contact fields", ["Plan"]],
		]
	);
	assert.equal(footer, null, "a search shows the fields themselves, not the entry");

	const html = render("pl");
	assert.match(html, /role="group" aria-labelledby="([^"]+)"><p id="\1"[^>]*>Contact fields<\/p>/);
	assert.ok(html.indexOf(">Image<") < html.indexOf(">Contact fields<"));
	assert.ok(html.indexOf(">Contact fields<") < html.indexOf(">Plan<"));
	assert.equal(render("zzz"), "", "nothing found, no menu");
});

test("a field inserts its tag, and the first name its tag with a fallback", () => {
	const items = getSlashItems(FIELDS);
	const insert = (title) => items.find((item) => item.title === title).run({ insertContent: (content) => content });
	assert.equal(insert("Plan"), "{{plan}}");
	assert.equal(insert("Stripe customer ID"), "{{stripe_customer_id}}");
	assert.equal(insert("First name"), "{{first_name|there}}");
});

test("how to add names and fields opens the contacts article's steps in a new tab", () => {
	const html = renderToStaticMarkup(createElement(LinkHelpFields));
	assert.match(html, /^<a href="\/help\/contacts#fields" target="_blank" rel="noopener"/);
	assert.match(html, />How to add names and fields to contacts</);
});

test("the menu shows whole where it opens, and the page only moves when it fits neither below nor above the caret", () => {
	const caret = (top) => ({ top, bottom: top + 24 });
	const fit = (top, area) => fitMenu({ caret: caret(top), height: 320, area, gap: 4 });
	// A laptop's screen under the campaign's top bar.
	const area = { top: 80, bottom: 784 };
	assert.deepEqual(fit(300, area), { maxHeight: 676, scroll: 0 }, "below");
	assert.equal(fit(436, area).scroll, 0, "just fits below");
	assert.equal(fit(437, area).scroll, 0, "fits above instead");
	assert.equal(fit(736, area).scroll, 0, "at the bottom of the screen, above");

	const short = { top: 80, bottom: 544 };
	assert.equal(fit(110, short).scroll, 0, "below, on a short screen");
	assert.equal(fit(450, short).scroll, 0, "above, on a short screen");
	assert.deepEqual(fit(254, short), { maxHeight: 436, scroll: 58 }, "neither: just enough for its bottom to show");
	assert.equal(fitMenu({ caret: { top: 254, bottom: 276.4 }, height: 320, area: short, gap: 4 }).scroll, 57, "parts of a pixel count");
	assert.equal(fitMenu({ caret: { top: 60, bottom: 84 }, height: 900, area, gap: 4 }).scroll, 0, "never with the caret under the top bar");
});

test("on a short screen, like a phone's with its keyboard open, the menu shrinks to what's left next to the caret", () => {
	const area = { top: 120, bottom: 380 };
	const caret = { top: 300, bottom: 324 };
	const { maxHeight } = fitMenu({ caret, height: 320, area, gap: 4 });
	assert.equal(maxHeight, 232);
	assert.equal(fitMenu({ caret, height: maxHeight, area, gap: 4 }).scroll, 180, "the caret ends at the area's top and the menu's bottom at its bottom");
	assert.equal(fitMenu({ caret, height: 120, area: { top: 300, bottom: 360 }, gap: 4 }).maxHeight, 120, "three options at least");
});
