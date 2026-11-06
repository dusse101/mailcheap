import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { openLinksOutside, toPreviewFrame } from "../lib/email-preview.js";
import { renderEmail } from "../lib/render-email.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

// A preview's frame as the dashboard reaches it: the listeners on its email's document.
function previewFrame() {
	const listeners = {};
	return { listeners, contentDocument: { addEventListener: (type, listener) => (listeners[type] = listener) } };
}

function linkTo(href) {
	const link = { getAttribute: (name) => (name === "href" ? href : null) };
	link.closest = () => link;
	return link;
}

function press(frame, target, { type = "click", button = 0 } = {}) {
	const event = {
		target,
		button,
		isPrevented: false,
		preventDefault() {
			this.isPrevented = true;
		},
	};
	frame.listeners[type](event);
	return event;
}

test("a link clicked in a preview opens in a new tab, with nothing of the dashboard passed to it", (t) => {
	const opened = [];
	const assigned = [];
	globalThis.window = { open: (...args) => opened.push(args), location: { assign: (url) => assigned.push(url) } };
	t.after(() => delete globalThis.window);
	const frame = previewFrame();
	openLinksOutside(frame);

	assert.ok(press(frame, linkTo("https://example.com/post?utm_source=news")).isPrevented, "the frame never loads it");
	assert.deepEqual(opened, [["https://example.com/post?utm_source=news", "_blank", "noopener,noreferrer"]]);
	press(frame, linkTo("https://example.com/podcast"), { type: "auxclick", button: 1 });
	assert.equal(opened.length, 2, "a middle click opens it too");
	press(frame, linkTo("mailto:hi@example.com"));
	assert.deepEqual(assigned, ["mailto:hi@example.com"], "an email address opens the mail app");

	for (const href of ["#", "/p/an-issue", "javascript:alert(1)", "data:text/html,hi", ""]) {
		assert.ok(press(frame, linkTo(href)).isPrevented, `${href || "an empty href"} doesn't load in the frame`);
	}
	assert.equal(opened.length, 2, "and opens nothing");
	assert.equal(assigned.length, 1);
	assert.equal(press(frame, linkTo("https://example.com/post"), { type: "auxclick", button: 2 }).isPrevented, false, "a right click keeps its menu");
	assert.equal(press(frame, { closest: () => null }).isPrevented, false, "a click beside the links is the email's");
});

test("the dashboard's email previews open their links outside the frame, and the email gets no permission of its own", () => {
	for (const path of ["components/DialogPreviewEmail.jsx", "components/PreviewEmail.jsx"]) {
		const source = read(path);
		assert.match(source, /openLinksOutside\(event\.currentTarget\)/, path);
		const sandboxes = [...source.matchAll(/sandbox=(\{[^}]*\}|"[^"]*")/g)].map(([, value]) => value);
		assert.deepEqual(sandboxes, ['"allow-same-origin"'], `${path}: nothing in the email runs, opens or navigates on its own`);
	}
	const email = renderEmail({ format: "markdown", markdown: "Read [the post](https://example.com/post).", newsletter: { name: "Weekly" } }).html;
	const frame = toPreviewFrame(email);
	assert.doesNotMatch(frame, /<base\b|target=/i, "the email's links stay as they are written");
	assert.ok(frame.includes('href="https://example.com/post"'));
	assert.match(read("app/(site)/help/writing/page.js"), /A link you click in it opens in a new tab/);
});
