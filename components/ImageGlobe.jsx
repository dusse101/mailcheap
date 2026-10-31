import { getGlobeCenter, projectGlobe } from "@/lib/globe";
import { cn } from "@/lib/utils";

const CENTER = 100;
const RADIUS = 92;
// Dots shrink and fade toward the edge, so the globe reads as round.
const DEPTHS = [
	{ from: 0.75, width: 1.9, landOpacity: 0.42, countryOpacity: 1 },
	{ from: 0.45, width: 1.7, landOpacity: 0.3, countryOpacity: 0.9 },
	{ from: 0.2, width: 1.5, landOpacity: 0.19, countryOpacity: 0.7 },
	{ from: 0, width: 1.2, landOpacity: 0.1, countryOpacity: 0.45 },
];

// A dotted globe turned to face a country (lib/globe.js), its land lit and a pin in its middle; for a country it can't
// place, or none, the Atlantic.
export default function ImageGlobe({ country, className }) {
	const bands = DEPTHS.map(() => ({ land: [], country: [] }));
	for (const dot of projectGlobe(country)) {
		const band = bands[DEPTHS.findIndex(({ from }) => dot.depth >= from)];
		(dot.isCountry ? band.country : band.land).push([CENTER + dot.x * RADIUS, CENTER - dot.y * RADIUS]);
	}

	return (
		<svg viewBox="0 0 200 200" aria-hidden="true" className={cn("text-foreground", className)}>
			<defs>
				<radialGradient id="globe-shade" cx="36%" cy="30%" r="78%">
					<stop offset="0%" stopColor="currentColor" stopOpacity="0" />
					<stop offset="100%" stopColor="currentColor" stopOpacity="0.07" />
				</radialGradient>
			</defs>
			<circle cx={CENTER} cy={CENTER} r={RADIUS} fill="url(#globe-shade)" stroke="currentColor" strokeOpacity="0.09" />
			{DEPTHS.map(({ width, landOpacity }, index) => (
				<path key={`land-${index}`} d={toDots(bands[index].land)} stroke="currentColor" strokeOpacity={landOpacity} strokeWidth={width} strokeLinecap="round" />
			))}
			{DEPTHS.map(({ width, countryOpacity }, index) => (
				<path
					key={`country-${index}`}
					d={toDots(bands[index].country)}
					stroke="currentColor"
					strokeOpacity={countryOpacity}
					strokeWidth={width}
					strokeLinecap="round"
					className="text-sky-500"
				/>
			))}
			{getGlobeCenter(country) && (
				<g className="text-sky-500">
					<circle cx={CENTER} cy={CENTER} r="5" fill="currentColor" className="animate-globe-pulse" />
					<circle cx={CENTER} cy={CENTER} r="4" fill="currentColor" stroke="var(--card)" strokeWidth="2" />
				</g>
			)}
		</svg>
	);
}

// Each point as a dot of the path's stroke: a zero-length line, its round caps making the dot. Moves after the first
// are relative, which keeps the page small.
function toDots(points) {
	let d = "";
	let previous = null;
	for (const [x, y] of points) {
		d += previous ? `m${round(x - previous[0])} ${round(y - previous[1])}h0` : `M${round(x)} ${round(y)}h0`;
		previous = [round(x), round(y)];
	}
	return d;
}

function round(value) {
	return Math.round(value * 10) / 10;
}
