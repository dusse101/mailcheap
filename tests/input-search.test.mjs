import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import InputSearch from "../components/InputSearch.jsx";

// Search fields clear with MailCheap's own cross (components/ButtonClear.jsx), never the one browsers draw.
const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("a search field shows its cross once it has text, and a spinner while its results load", () => {
	const typed = renderToStaticMarkup(createElement(InputSearch, { name: "q", defaultValue: "jane", "aria-label": "Search accounts" }));
	for (const attribute of ['type="search"', 'name="q"', 'value="jane"', 'aria-label="Search accounts"']) assert.ok(typed.includes(attribute), attribute);
	assert.match(typed, /<button type="button"[^>]*aria-label="Clear the search"/);
	assert.match(typed, /<input[^>]*class="[^"]*\bpr-9\b/, "the text stops before the cross");

	const empty = renderToStaticMarkup(createElement(InputSearch, { value: "", onChange() {} }));
	assert.doesNotMatch(empty, /Clear the search/);
	assert.doesNotMatch(empty, /animate-spin/);
	assert.match(renderToStaticMarkup(createElement(InputSearch, { value: "jane", onChange() {}, isPending: true })), /animate-spin/);
});

test("every search field is an InputSearch, and the browser's cross never shows", async () => {
	const raw = [];
	for (const folder of ["app", "components"]) {
		for (const file of await readdir(join(ROOT, folder), { recursive: true })) {
			if (!/\.jsx?$/.test(file) || file === "InputSearch.jsx") continue;
			if (/type=["{]*search/.test(await readFile(join(ROOT, folder, file), "utf8"))) raw.push(`${folder}/${file}`);
		}
	}
	assert.deepEqual(raw, []);
	const css = await readFile(join(ROOT, "app/globals.css"), "utf8");
	assert.match(css, /input\[type="search"\]::-webkit-search-cancel-button \{\s*appearance: none;/);
});
