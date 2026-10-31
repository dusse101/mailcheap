// Where the globe's dots sit (lib/globe.js, scripts/generate-globe.mjs): rows STEP degrees of latitude apart from TOP
// southward, each spread evenly around its circle of latitude, every other row shifted half a dot so they interlock.
export const STEP = 1.8;
export const TOP = 83.1;
export const ROWS = 78;

export function rowLatitude(row) {
	return Math.round((TOP - row * STEP) * 100) / 100;
}

export function rowCells(lat) {
	return Math.max(1, Math.round((360 * Math.cos((lat * Math.PI) / 180)) / STEP));
}

export function cellLongitude(row, cell, cells) {
	const lon = -180 + ((cell + 0.5 + (row % 2) / 2) * 360) / cells;
	return lon > 180 ? lon - 360 : lon;
}
