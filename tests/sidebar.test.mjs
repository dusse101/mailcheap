import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { describe, test } from "node:test";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LayoutDashboard from "../components/LayoutDashboard.jsx";
import NavSidebar from "../components/NavSidebar.jsx";
import { TooltipProvider } from "../components/ui/tooltip.jsx";
import { SIDEBAR_COLLAPSED, SIDEBAR_COOKIE, SIDEBAR_EXPANDED } from "../lib/sidebar.js";
import { isSidebarCollapsed, openSidebarVisit, readSidebarVisit, subscribeToSidebarVisits } from "../lib/use-collapsed-sidebar.js";
import { runWithRequest } from "./stubs/next-headers.mjs";

// The dashboard's sidebar folds down to its icons from the button next to the logo, and opens again from the logo. The
// button saves the choice in a cookie, which the layout reads to render the next page's sidebar the same way.
const USER = { name: "Ada", email: "ada@example.com", image: null };
const ACCOUNT = { _id: "6ad8aca8d652cc82ddbb1086", status: "active" };
const LINKS = ["Overview", "Campaigns", "Contacts", "Settings", "Domains", "API keys"];

async function findSidebarProps(cookie) {
	const jar = new Map(cookie === undefined ? [] : [[SIDEBAR_COOKIE, cookie]]);
	const layout = await runWithRequest({ jar }, () => LayoutDashboard({ user: USER, account: ACCOUNT, isAdmin: false, children: null }));
	return findElement(layout, NavSidebar).props;
}

function findElement(node, type) {
	if (Array.isArray(node)) return node.map((child) => findElement(child, type)).find(Boolean) ?? null;
	if (!isValidElement(node)) return null;
	return node.type === type ? node : findElement(node.props.children, type);
}

function renderSidebar(isCollapsed) {
	return renderToStaticMarkup(
		createElement(TooltipProvider, null, createElement(NavSidebar, { isCollapsed, isAdmin: false, switcher: null, footer: null }))
	);
}

// The opening tag of the element named by this aria-label.
function findTag(html, label) {
	return html.match(new RegExp(`<[a-z]+\\b[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? null;
}

// What sits inside the element the inert wrapper opens, up to the expand button that follows it.
function findInertPart(html) {
	const start = html.indexOf(' inert=""');
	return start === -1 ? "" : html.slice(start, html.indexOf('aria-label="Expand sidebar"', start));
}

describe("the dashboard's sidebar", () => {
	test("renders folded only when the cookie says so", async () => {
		assert.equal((await findSidebarProps(undefined)).isCollapsed, false, "open by default");
		assert.equal((await findSidebarProps(SIDEBAR_COLLAPSED)).isCollapsed, true);
		assert.equal((await findSidebarProps(SIDEBAR_EXPANDED)).isCollapsed, false);
		for (const value of ["COLLAPSED", "1", "true", ""]) assert.equal((await findSidebarProps(value)).isCollapsed, false, value);
	});

	test("open, shows the logo with the collapse button next to it, and the expand button can't be reached", () => {
		const html = renderSidebar(false);
		assert.doesNotMatch(html, /data-sidebar-(collapsed|folded)/);
		assert.ok(findTag(html, "Collapse sidebar"));
		assert.match(findTag(html, "Expand sidebar"), / inert=""/);
		assert.equal(findInertPart(html).includes("Collapse sidebar"), false, "the logo and the collapse button work");
		assert.match(html, /<a[^>]*href="\/"[^>]*>.*?MailCheap<\/span><\/a>/);
	});

	test("collapsed, starts folded: the logo opens it, the button that keeps it open waits for it to unfold, and every link keeps its name", () => {
		const html = renderSidebar(true);
		assert.match(html, /<aside data-sidebar-collapsed="" data-sidebar-folded=""/);
		assert.doesNotMatch(findTag(html, "Expand sidebar"), / inert=""/);
		assert.equal(findTag(html, "Collapse sidebar"), null);
		const inert = findInertPart(html);
		assert.ok(inert.includes('href="/"') && inert.includes('aria-label="Keep sidebar open"'), "the logo's link and that button wait");
		for (const label of LINKS) assert.match(html, new RegExp(`<span class="sidebar-label">${label}</span>`), label);
	});

	test("the campaign editor folds it while it's open, until it's opened there, and the next page shows it as it was left", () => {
		const collapsed = (isLeftCollapsed, visit, expandedVisit) => isSidebarCollapsed({ isLeftCollapsed, visit, expandedVisit });
		assert.equal(collapsed(false, 0, 0), false, "outside the editor, as it was left");
		assert.equal(collapsed(true, 0, 3), true);
		assert.equal(collapsed(false, 3, 0), true, "the editor folds it");
		assert.equal(collapsed(false, 3, 2), true, "opened during an earlier visit, it folds again");
		assert.equal(collapsed(false, 3, 3), false, "opened during this one, it stays open");
		assert.equal(collapsed(true, 3, 3), true, "folded by hand there, it stays folded on the next page too");

		const seen = [];
		const unsubscribe = subscribeToSidebarVisits(() => seen.push(readSidebarVisit()));
		const endFirst = openSidebarVisit();
		const first = readSidebarVisit();
		endFirst();
		const endSecond = openSidebarVisit();
		const second = readSidebarVisit();
		endFirst();
		assert.equal(readSidebarVisit(), second, "a visit that ended doesn't end the next one");
		endSecond();
		unsubscribe();
		assert.ok(first > 0 && second > first);
		assert.deepEqual(seen, [first, 0, second, 0]);
	});

	test("the editor has it folded from the first paint, before any script runs, and takes the whole width", async () => {
		const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
		assert.match(css, /html:has\(\[data-campaign-steps\]\):not\(:has\(\[data-sidebar-expanded\]\)\) \{\s*--sidebar-width: calc\(4\.25rem \+ 1px\);/);
		assert.match(
			css,
			/@custom-variant sidebar-folded \(&:where\(\[data-sidebar-folded\] \*, :root:has\(\[data-campaign-steps\]\):not\(:has\(\[data-sidebar-expanded\], \[data-sidebar-peek\]\)\) \[data-sidebar\] \*\)\);/,
			"only what's in the sidebar, the phone's top bar and menu sharing its components, and not while it unfolds under the mouse"
		);
		assert.match(css, /@utility sidebar-label \{[^}]*@variant sidebar-folded \{/);
		assert.match(renderSidebar(false), /<aside data-sidebar=""/);

		const editor = await readFile(new URL("../components/FormCampaign.jsx", import.meta.url), "utf8");
		assert.match(editor, /<div ref=\{rootRef\} data-campaign-steps/);
		assert.match(editor, /\n\tuseCollapsedSidebar\(\);\n/);
		const layout = await readFile(new URL("../components/LayoutDashboard.jsx", import.meta.url), "utf8");
		assert.match(layout, /has-\[\[data-campaign-steps\]\]:max-w-none/);
	});

	test("its only tooltip is the button's next to the logo: the links and the logo have none", async () => {
		const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
		assert.doesNotMatch(await read("components/NavLinks.jsx"), /Tooltip/);
		const sidebar = await read("components/NavSidebar.jsx");
		assert.equal(sidebar.match(/<Tooltip>/g)?.length, 1);
		assert.match(sidebar, /<TooltipContent side="bottom">\{toggleLabel\}<\/TooltipContent>/);

		for (const name of await readdir(new URL("../components/", import.meta.url), { recursive: true })) {
			if (!name.endsWith(".jsx")) continue;
			assert.doesNotMatch(await read(`components/${name}`), /&& \(?\s*<TooltipContent/, `${name}: a tooltip opened without its content has nothing to close it`);
		}
	});
});
