import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ListImportGuides from "../components/ListImportGuides.jsx";
import { siteExtensions as defaults } from "../lib/site-extensions.js";

// The import dialog's guides to exporting a list from other platforms, under its drop zone (siteExtensions.importGuides).
const GUIDES = [
	{ brand: "beehiiv", name: "beehiiv", href: "/guides/beehiiv" },
	{ brand: "kit", name: "Kit", href: "/guides/kit" },
];

function readLinks(html) {
	return [...html.matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attributes, inside]) => ({
		attributes,
		name: inside.replace(/<[^>]+>/g, ""),
		hasIcon: inside.startsWith("<svg"),
	}));
}

test("each guide is a button with its platform's icon and name, and opens in a new tab", () => {
	const links = readLinks(renderToStaticMarkup(createElement(ListImportGuides, { guides: GUIDES })));
	assert.deepEqual(
		links.map(({ name, hasIcon }) => [name, hasIcon]),
		[
			["beehiiv", true],
			["Kit", true],
		]
	);
	for (const [index, { attributes }] of links.entries()) {
		assert.ok(attributes.includes(`href="${GUIDES[index].href}"`), attributes);
		assert.match(attributes, /target="_blank"/);
		assert.match(attributes, /rel="noopener"/);
	}
});

test("a self-hosted server has none, and the dialog shows nothing in their place", () => {
	assert.deepEqual(defaults.importGuides, []);
	assert.equal(renderToStaticMarkup(createElement(ListImportGuides, { guides: defaults.importGuides })), "");
});
