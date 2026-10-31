import { GLOBE_CENTERS, GLOBE_ROWS } from "./globe-data.js";
import { cellLongitude, rowCells, rowLatitude } from "./globe-grid.js";

const RADIANS = Math.PI / 180;
// Where a globe faces without a country: the Atlantic, between the Americas, Europe and Africa.
const DEFAULT_CENTER = [24, -28];

// Every land dot once, with what turning the globe needs: its latitude's sine and cosine, its longitude and its country.
const DOTS = GLOBE_ROWS.flatMap((cells, row) => {
	const lat = rowLatitude(row) * RADIANS;
	const count = rowCells(rowLatitude(row));
	const dots = [];
	for (let index = 0, cell = 0; index < cells.length; cell++) {
		if (cells[index] === ".") {
			index += 1;
			continue;
		}
		dots.push({ sinLat: Math.sin(lat), cosLat: Math.cos(lat), lon: cellLongitude(row, cell, count) * RADIANS, country: cells.slice(index, index + 2) });
		index += 2;
	}
	return dots;
});

// Where the globe turns for a country, [latitude, longitude], or null for one it can't place.
export function getGlobeCenter(country) {
	return GLOBE_CENTERS[country] ?? null;
}

// The side of the globe facing the viewer once it's turned to the country, seen from far away: each land dot's x and y
// from -1 to 1, north up, its depth from 0 at the edge to 1 in the middle, and whether it's the country's.
export function projectGlobe(country) {
	const [lat0, lon0] = (getGlobeCenter(country) ?? DEFAULT_CENTER).map((degrees) => degrees * RADIANS);
	const [sinLat0, cosLat0] = [Math.sin(lat0), Math.cos(lat0)];
	const dots = [];
	for (const dot of DOTS) {
		const cosLon = Math.cos(dot.lon - lon0);
		const depth = sinLat0 * dot.sinLat + cosLat0 * dot.cosLat * cosLon;
		if (depth <= 0) continue;
		dots.push({
			x: dot.cosLat * Math.sin(dot.lon - lon0),
			y: cosLat0 * dot.sinLat - sinLat0 * dot.cosLat * cosLon,
			depth,
			isCountry: dot.country === country,
		});
	}
	return dots;
}
