import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import InputTags, { pickSuggestions } from "../components/InputTags.jsx";

// The chips field for tags (components/InputTags.jsx), in a contact's Edit tags and the import.
test("a tags field says how to add one, and keeps saying it once it has some", () => {
	const empty = renderToStaticMarkup(createElement(InputTags, { value: [], onChange() {} }));
	assert.match(empty, /placeholder="Type a tag, then press Enter"/);

	const some = renderToStaticMarkup(createElement(InputTags, { value: ["vip"], onChange() {} }));
	assert.match(some, /placeholder="Add another"/, "not an empty field after the first one");
	assert.match(some, /aria-label="Remove vip"/);

	const full = renderToStaticMarkup(createElement(InputTags, { value: ["vip", "podcast"], onChange() {}, max: 2 }));
	assert.match(full, /disabled=""/);
	assert.doesNotMatch(full, /placeholder="[^"]/, "nothing to add once it's full");
});

test("the tags other contacts have are offered under the field, with how many have each, but not the ones it has", () => {
	const suggestions = [
		{ name: "customer", contacts: 1200 },
		{ name: "vip", contacts: 4 },
		{ name: "beta", contacts: 1 },
	];
	const html = renderToStaticMarkup(createElement(InputTags, { value: ["vip"], onChange() {}, suggestions }));
	assert.doesNotMatch(html, /<datalist|\slist="/, "not the browser's own list, which draws an arrow in the field");
	assert.match(html, /role="combobox"[^>]*aria-expanded="true"/);
	const options = [...html.matchAll(/<li[^>]*role="option"[^>]*title="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)].map(([, title, inner]) => [
		inner.replace(/<[^>]+>/g, ""),
		title,
	]);
	assert.deepEqual(options, [
		["customer1,200", "1,200 contacts"],
		["beta1", "1 contact"],
	]);

	const few = renderToStaticMarkup(createElement(InputTags, { value: [], onChange() {}, suggestions, maxSuggestions: 2 }));
	assert.equal(few.match(/role="option"/g).length, 2);
	const full = renderToStaticMarkup(createElement(InputTags, { value: ["vip", "podcast"], onChange() {}, max: 2, suggestions }));
	assert.doesNotMatch(full, /role="option"/, "nothing to pick once it's full");
});

test("typing a new tag keeps the others offered, and only takes off the one it spells", () => {
	const suggestions = ["customer", "beta", "cupcake"].map((name) => ({ name, contacts: 1 }));
	const names = (value, text) => pickSuggestions(suggestions, value, text).map(({ name }) => name);
	assert.deepEqual(names([], ""), ["customer", "beta", "cupcake"], "the most used first, as given");
	assert.deepEqual(names([], "cu"), ["customer", "beta", "cupcake"], "all of them, in the same order, while it's typed");
	assert.deepEqual(names([], " Beta "), ["customer", "cupcake"], "not the one typed, which Enter adds");
	assert.deepEqual(names(["customer"], ""), ["beta", "cupcake"], "not the ones it has");
});
