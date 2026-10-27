// Writes lib/globe-data.js, the land the contact page's globe draws as dots, from Natural Earth's 1:50m countries
// (public domain, github.com/nvkelso/natural-earth-vector):
//   node scripts/generate-globe.mjs ne_50m_admin_0_countries.geojson
import { readFileSync, writeFileSync } from "node:fs";
import { STEP, TOP, ROWS, cellLongitude, rowCells, rowLatitude } from "../lib/globe-grid.js";

// Natural Earth's areas without a code of their own, by the country ISO 3166 counts them in.
const CODES_BY_NAME = { Somaliland: "SO", "N. Cyprus": "CY" };
// Places with a code but no shape at this scale, or inside another country's: where the globe turns for them.
const EXTRA_CENTERS = {
	AX: [60.2, 20], BL: [17.9, -62.8], BQ: [12.2, -68.3], BV: [-54.4, 3.4], CC: [-12.2, 96.9], CX: [-10.5, 105.6],
	EH: [24.2, -12.9], GF: [3.9, -53.1], GI: [36.1, -5.4], GP: [16.2, -61.6], MF: [18.1, -63.1], MQ: [14.6, -61],
	PM: [46.9, -56.3], RE: [-21.1, 55.5], SJ: [78.2, 15.6], TK: [-9.2, -171.8], TV: [-7.1, 177.6], UM: [19.3, 166.6],
	YT: [-12.8, 45.2],
};

const source = JSON.parse(readFileSync(process.argv[2], "utf8"));
const polygons = [];
for (const { properties, geometry } of source.features) {
	const code = /^[A-Z]{2}$/.test(properties.ISO_A2_EH) ? properties.ISO_A2_EH : CODES_BY_NAME[properties.NAME];
	if (!code || code === "AQ" || !geometry) continue;
	const shapes = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
	for (const rings of shapes) polygons.push({ code, rings, box: boxOf(rings[0]), area: areaOf(rings[0]) });
}

const rows = [];
for (let row = 0; row < ROWS; row++) {
	const lat = rowLatitude(row);
	let cells = "";
	for (let cell = 0; cell < rowCells(lat); cell++) cells += findCountry(cellLongitude(row, cell, rowCells(lat)), lat) ?? ".";
	rows.push(cells.replace(/\.+$/, ""));
}

const centers = {};
for (const polygon of polygons.toSorted((a, b) => a.area - b.area)) centers[polygon.code] = centroidOf(polygon.rings[0]);
Object.assign(centers, Object.fromEntries(Object.entries(EXTRA_CENTERS).filter(([code]) => !centers[code])));
const sortedCenters = Object.fromEntries(Object.entries(centers).toSorted(([a], [b]) => a.localeCompare(b)));

writeFileSync(
	new URL("../lib/globe-data.js", import.meta.url),
	`// Made by scripts/generate-globe.mjs from Natural Earth's 1:50m countries (public domain): don't edit it by hand.
// Each row is a line of latitude (lib/globe-grid.js), west to east: "." for sea, else the country's two-letter code.
export const GLOBE_ROWS = ${JSON.stringify(rows, null, "\t")};

// Where the globe turns for each country: the middle of its largest land, [latitude, longitude].
export const GLOBE_CENTERS = ${JSON.stringify(sortedCenters)};
`
);
console.log(`${ROWS} rows from ${TOP}° every ${STEP}°, ${rows.join("").replace(/\./g, "").length / 2} land dots, ${Object.keys(sortedCenters).length} centers`);

function findCountry(lon, lat) {
	const polygon = polygons.find(({ box, rings }) => lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3] && isInside(rings, lon, lat));
	return polygon?.code ?? null;
}

// Inside the outer ring and none of its holes, by ray casting: Natural Earth splits shapes at the antimeridian.
function isInside([outer, ...holes], lon, lat) {
	return isInRing(outer, lon, lat) && !holes.some((hole) => isInRing(hole, lon, lat));
}

function isInRing(ring, lon, lat) {
	let isIn = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) isIn = !isIn;
	}
	return isIn;
}

function boxOf(ring) {
	const lons = ring.map(([lon]) => lon);
	const lats = ring.map(([, lat]) => lat);
	return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

// Degrees squared, with longitudes shrunk toward the poles: enough to tell a country's largest land.
function areaOf(ring) {
	const [, south, , north] = boxOf(ring);
	return Math.abs(shoelace(ring)) * Math.cos((((south + north) / 2) * Math.PI) / 180);
}

function shoelace(ring) {
	let sum = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
	return sum / 2;
}

function centroidOf(ring) {
	const area = shoelace(ring);
	let lon = 0;
	let lat = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
		lon += (ring[j][0] + ring[i][0]) * cross;
		lat += (ring[j][1] + ring[i][1]) * cross;
	}
	return [Math.round((lat / (6 * area)) * 10) / 10, Math.round((lon / (6 * area)) * 10) / 10];
}
