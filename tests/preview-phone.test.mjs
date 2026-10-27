import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function read(path) {
	return readFileSync(join(root, path), "utf8");
}

test("the status bar's Wi-Fi is a wedge and two arcs", () => {
	const icon = read("components/IconWifi.jsx");
	const paths = [...icon.matchAll(/<path\b[^/]*\/>/g)].map((match) => match[0]);
	assert.equal(paths.length, 3);
	assert.equal(paths.filter((path) => /fill="currentColor"/.test(path)).length, 1);
	assert.equal(paths.filter((path) => /stroke="currentColor"/.test(path)).length, 2);
	assert.doesNotMatch(icon, /<circle/i);
});

test("the email preview's phone shows that Wi-Fi", () => {
	assert.match(read("components/DialogPreviewEmail.jsx"), /import IconWifi from "@\/components\/IconWifi"/);
	assert.doesNotMatch(read("components/DialogPreviewEmail.jsx"), /\{[^}]*\bWifi\b[^}]*\} from "lucide-react"/);
});

test("a fingertip taps the previewed issue's row until it has been opened, with no label or color of its own", () => {
	const preview = read("components/DialogPreviewEmail.jsx");
	assert.match(preview, /hasOpenedEmail/);
	assert.match(preview, /\{isHintShown && <HintTap \/>\}/);
	assert.match(preview, /animate-tap-finger/);
	assert.match(preview, /animate-tap-ripple/);
	assert.doesNotMatch(preview, /animate-pulse|>Open</);
	assert.match(preview, /Open the email from/, "screen readers still hear what the row does");

	const css = read("app/globals.css");
	for (const name of ["tap-finger", "tap-ripple", "tap-fade"]) assert.match(css, new RegExp(`@keyframes ${name} \\{`));
	const finger = css.slice(css.indexOf("@utility animate-tap-finger"), css.indexOf("@utility animate-tap-ripple"));
	assert.match(finger, /prefers-reduced-motion: reduce[\s\S]*tap-fade/, "without motion, the fingertip only fades");
	assert.doesNotMatch(css.slice(css.indexOf("@keyframes tap-finger"), css.indexOf("@utility animate-tap-finger")), /scale\(0\)/);
});

test("on a phone the mobile preview is the email edge to edge", () => {
	const preview = read("components/DialogPreviewEmail.jsx");
	assert.match(preview, /isEdgeToEdge/);
	assert.match(preview, /<ViewEmail /);
	assert.match(read("app/(site)/help/writing/page.js"), /edge to edge/);
});

test("the mail-app header stays put while the title and sender scroll with the email", () => {
	const preview = read("components/DialogPreviewEmail.jsx");
	assert.match(preview, /function ScreenEmail[\s\S]*?function /);
	const screenEmail = preview.slice(preview.indexOf("function ScreenEmail"), preview.indexOf("function FrameEmail"));
	assert.match(screenEmail, /shrink-0/);
	assert.match(screenEmail, /overflow-y-auto[\s\S]*<HeaderMessage/);
	const desktop = preview.slice(preview.indexOf("function FrameDesktop"), preview.indexOf("function FramePhone"));
	assert.match(desktop, /shrink-0/);
	assert.match(desktop, /overflow-y-auto[\s\S]*fromName/);
});
