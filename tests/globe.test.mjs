import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CardLocation from "../components/CardLocation.jsx";
import { getCountryName } from "../lib/countries.js";
import { GLOBE_CENTERS, GLOBE_ROWS } from "../lib/globe-data.js";
import { ROWS } from "../lib/globe-grid.js";
import { getGlobeCenter, projectGlobe } from "../lib/globe.js";

// The contact page's globe (components/ImageGlobe.jsx): land as dots from lib/globe-data.js, turned to face a country.
test("the land is countries' dots, and every country with land can be turned to", () => {
	assert.equal(GLOBE_ROWS.length, ROWS);
	const codes = new Set(GLOBE_ROWS.join("").replaceAll(".", "").match(/[A-Z]{2}/g));
	assert.ok(codes.size > 140, `${codes.size} countries big enough for a dot`);
	for (const code of codes) {
		assert.ok(getCountryName(code), `${code} is a country`);
		assert.ok(GLOBE_CENTERS[code], `${code} has a center`);
	}
	for (const [code, [lat, lon]] of Object.entries(GLOBE_CENTERS)) {
		assert.ok(Math.abs(lat) <= 90 && Math.abs(lon) <= 180, code);
	}
	assert.deepEqual(getGlobeCenter("FR"), [46.6, 2.5], "France's middle, not its overseas regions'");
	assert.ok(getGlobeCenter("SG") && getGlobeCenter("RE"), "small places and regions inside another country's shape too");
	assert.equal(getGlobeCenter("XX"), null);
	assert.equal(getGlobeCenter(undefined), null);
});

test("turned to a country, the globe shows its near side with the country in the middle", () => {
	const dots = projectGlobe("FR");
	assert.ok(dots.length > 1000, `${dots.length} dots`);
	assert.ok(dots.every(({ x, y, depth }) => depth > 0 && depth <= 1 && Math.hypot(x, y) <= 1 + 1e-9), "only the side facing the viewer");
	const france = dots.filter(({ isCountry }) => isCountry);
	const isNear = ({ x, y }) => Math.hypot(x, y) < 0.2;
	assert.ok(france.filter(isNear).length >= 10, "France around the middle");
	assert.ok(france.filter((dot) => !isNear(dot)).every(({ x }) => x < -0.5), "and French Guiana, France too, far to the west");

	const australia = projectGlobe("AU").filter(({ isCountry }) => isCountry);
	const middle = australia.reduce(([x, y], dot) => [x + dot.x / australia.length, y + dot.y / australia.length], [0, 0]);
	assert.ok(Math.hypot(...middle) < 0.1, "the southern hemisphere turns to the middle too");
	assert.equal(projectGlobe("SG").filter(({ isCountry }) => isCountry).length, 0, "too small for a dot: the pin shows it");
	assert.equal(projectGlobe(null).filter(({ isCountry }) => isCountry).length, 0);
});

test("the location card lights the contact's country, or says where one comes from", () => {
	const france = renderToStaticMarkup(createElement(CardLocation, { country: "FR", source: "embed" }));
	assert.ok(france.includes(">France</p>") && france.includes("https://flagcdn.com/fr.svg"));
	assert.ok(france.includes("Where they signed up from"));
	assert.match(france, /<path d="M[^"]+"[^>]*class="text-sky-500"/, "the country's dots");
	assert.ok(france.includes("animate-globe-pulse"), "and the pin on it");

	const imported = renderToStaticMarkup(createElement(CardLocation, { country: "BR", source: "import" }));
	assert.ok(imported.includes("Where they first clicked from"));

	for (const country of [null, "ZZ", "<b>"]) {
		const unknown = renderToStaticMarkup(createElement(CardLocation, { country, source: "import" }));
		assert.ok(unknown.includes("No location yet"), String(country));
		assert.ok(!unknown.includes("animate-globe-pulse") && !unknown.includes("flagcdn"), String(country));
	}
});
