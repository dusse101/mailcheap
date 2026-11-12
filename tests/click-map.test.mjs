import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

process.env.BETTER_AUTH_SECRET = "s".repeat(40);

const { formatShare, placeCounts } = await import("../lib/click-map.js");
const { getLinkKey, normalizeLink, withLinkKeys } = await import("../lib/link-stats.js");
const { addTracking, readClickToken } = await import("../lib/tracking.js");

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const markedKeys = (html) => [...html.matchAll(/<a data-link-key="([^"]+)"/g)].map(([, key]) => key);

test("the preview marks each link with the key its clicks count under, read as its tracked link reads it", () => {
	const html = [
		'<p><a href="https://example.com/story?utm_source=news&amp;b=2&amp;a=1">The story</a></p>',
		'<p><a target="_blank" href="https://example.com/story/?a=1&b=2"><img src="https://cdn.example.com/s.png" alt="Story"></a></p>',
		"<p><a href='https://example.com/hi?name={{first_name|there}}'>Hi</a></p>",
	].join("");
	const tracked = addTracking(html, { baseUrl: "https://news.example.com", messageId: "65f000000000000000000003" });
	const clicked = [...tracked.matchAll(/\/c\/([^"']+)["']/g)].map(([, token]) => getLinkKey(normalizeLink(readClickToken(token).url)));
	const marked = withLinkKeys(html);
	assert.equal(clicked.length, 3);
	assert.deepEqual(markedKeys(marked), clicked);
	assert.equal(clicked[0], clicked[1], "the same page, whatever its tracking parameters");
	assert.equal(marked.replaceAll(/ data-link-key="[^"]+"/g, ""), html, "nothing else changes");
});

test("links whose clicks never count get no key", () => {
	const html = [
		'<a href="mailto:hi@example.com">Write</a>',
		'<a href="#top">Top</a>',
		'<a href="/p/an-issue">Relative</a>',
		'<a href="{{unsubscribe_url}}">Unsubscribe</a>',
		'<a href="http://localhost:3000/api/unsubscribe?token=abc">Unsubscribe</a>',
		'<a href="http://localhost:3000/keep?token=abc">Keep</a>',
		'<a href="javascript:alert(1)">Script</a>',
		'<map name="m"><area href="https://example.com/map" alt="Map"></map>',
	].join("");
	assert.equal(withLinkKeys(html), html);
});

const COUNT = { width: 100, height: 24 };
const box = (left, top, width = 40, height = 20) => ({ left, top, width, height });
const isApart = (a, b) => a.left + a.width <= b.left || b.left + b.width <= a.left || a.top + a.height <= b.top || b.top + b.height <= a.top;

test("counts of links side by side take turns above and below, each centered on its own link and none covering another", () => {
	const links = [0, 1, 2, 3].map((index) => box(80 + index * 60, 400));
	const spots = placeCounts(
		links.map((link) => ({ boxes: [link] })),
		links.map(() => COUNT),
		{ width: 600, links }
	);
	assert.deepEqual(
		spots.map(({ side, top }) => [side, top]),
		[
			["above", 370],
			["below", 426],
			["above", 370],
			["below", 426],
		]
	);
	for (const [index, spot] of spots.entries()) assert.equal(spot.left + spot.width / 2, links[index].left + 20, "centered on its link");
	for (const a of [...spots, ...links]) for (const b of [...spots, ...links]) assert.ok(a === b || isApart(a, b), "nothing covers anything");
});

test("a count goes below its link rather than cover the link on the line above, and sits on a picture", () => {
	const above = box(50, 100, 100);
	const link = box(60, 124, 100);
	const picture = box(200, 300, 300, 200);
	const links = [above, link, picture];
	const [, below, onPicture] = placeCounts(
		links.map((item) => ({ boxes: [item] })),
		links.map(() => COUNT),
		{ width: 600, links }
	);
	assert.deepEqual([below.side, below.top], ["below", 150]);
	assert.deepEqual([onPicture.side, onPicture.top, onPicture.left], ["inside", 306, 300]);
});

test("a count stays inside the email, and one with room keeps its place right above its link", () => {
	const links = [box(0, 100, 20), box(570, 100, 30), box(280, 500)];
	const [left, right, alone] = placeCounts(
		links.map((link) => ({ boxes: [link] })),
		links.map(() => ({ width: 80, height: 24 })),
		{ width: 600, links }
	);
	assert.equal(left.left, 4);
	assert.equal(right.left + right.width, 596);
	assert.deepEqual([alone.side, alone.left, alone.top], ["above", 260, 470]);
	const [wide] = placeCounts([{ boxes: [box(30, 100)] }], [{ width: 400, height: 24 }], { width: 300 });
	assert.equal(wide.left, 4, "wider than the email, it starts at its left edge");
});

test("crowded past every level, a count still keeps clear of the other counts", () => {
	const links = [box(100, 100, 300, 24), box(100, 130, 300, 24), box(100, 160, 300, 24), box(110, 190, 280, 24)];
	const spots = placeCounts(
		links.map((link) => ({ boxes: [link] })),
		links.map(() => COUNT),
		{ width: 600, links }
	);
	for (const a of spots) for (const b of spots) assert.ok(a === b || isApart(a, b), "no count covers another");
});

test("a link's share is in whole percents, <1% under half a percent, and never over 100%", () => {
	assert.equal(formatShare(896, 1149), "78%");
	assert.equal(formatShare(1, 1149), "<1%");
	assert.equal(formatShare(7, 1000), "1%");
	assert.equal(formatShare(12, 10), "100%");
	assert.equal(formatShare(3, 0), null);
});

test("the report's preview shows the clicks until Clicks hides them, and the help center says so", () => {
	const preview = read("components/DialogPreviewEmail.jsx");
	assert.match(preview, /aria-pressed=\{isClicksShown\}/);
	assert.match(preview, />Clicks</);
	assert.match(preview, /<OverlayClicks /);
	for (const frame of ["FrameDesktop", "ScreenEmail", "ViewEmail"]) {
		const body = preview.slice(preview.indexOf(`function ${frame}`));
		assert.match(body.slice(0, body.indexOf("\n}\n")), /<FrameEmail html=\{html\} clicks=\{clicks\} \/>/, frame);
	}
	assert.match(read("app/(site)/help/sending/page.js"), /Click map, in Links, shows the email as it went out/);
});
