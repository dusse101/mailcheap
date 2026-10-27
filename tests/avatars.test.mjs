import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AvatarContact from "../components/AvatarContact.jsx";
import AvatarUser from "../components/AvatarUser.jsx";
import { gravatarHash } from "../lib/gravatar.js";

// A person shown by their email address has their picture next to it (AGENTS.md): their Gravatar photo, their email
// domain's logo, then their initial.
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

test("the hash Gravatar gets is of the address as typed in any case or spacing, never the address", () => {
	assert.equal(gravatarHash(" Lena.Hart@Example.com "), sha256("lena.hart@example.com"));
	assert.match(gravatarHash("lena.hart@example.com"), /^[0-9a-f]{64}$/);
	assert.equal(gravatarHash(undefined), sha256(""));
});

test("a contact's picture asks Gravatar for a hash of the address, and the logo service for its domain only", () => {
	const html = renderToStaticMarkup(createElement(AvatarContact, { email: "lena.hart@news.example.com", gravatarHash: gravatarHash("lena.hart@news.example.com"), size: 32 }));
	assert.ok(html.includes(`https://gravatar.com/avatar/${sha256("lena.hart@news.example.com")}?s=64&amp;d=blank`), html);
	assert.ok(html.includes("s2/favicons?domain=example.com&amp;"), "the logo of the email's domain");
	assert.ok(!html.includes("lena.hart"), "the address itself goes nowhere");
	assert.match(html, /<span aria-hidden="true"[^>]*>l</, "the initial underneath, hidden from screen readers next to the address");

	const gmail = renderToStaticMarkup(createElement(AvatarContact, { email: "omar@gmail.com", gravatarHash: gravatarHash("omar@gmail.com") }));
	assert.ok(!gmail.includes("s2/favicons"), "Gmail's logo says nothing about the person");
	assert.ok(gmail.includes("gravatar.com/avatar/"));
});

test("the signed-in member shows their photo, else their address's picture, and an author without an address their initial", () => {
	const photo = renderToStaticMarkup(
		createElement(AvatarUser, { name: "Lena", email: "lena@example.com", image: "https://cdn.example.com/lena.png", gravatarHash: gravatarHash("lena@example.com") })
	);
	assert.ok(photo.includes('src="https://cdn.example.com/lena.png"'));
	assert.ok(!photo.includes("gravatar.com"), "a photo they have comes first");

	const noPhoto = renderToStaticMarkup(createElement(AvatarUser, { name: "Lena", email: "lena@example.com", gravatarHash: gravatarHash("lena@example.com"), size: 32 }));
	assert.ok(noPhoto.includes(`gravatar.com/avatar/${sha256("lena@example.com")}`), noPhoto);

	const author = renderToStaticMarkup(createElement(AvatarUser, { name: "Lena Hart", image: "" }));
	assert.ok(!author.includes("<img"), author);
	assert.match(author, />L<\/span>$/);
});
