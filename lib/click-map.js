// The report's preview shows each clicked link's count on the email (components/OverlayClicks.jsx), centered on the link
// and kept inside the email, joined to it by a stem: on a link as tall as a picture, else above it, or below it, or a
// level further out. Counts never cover each other; covering another link costs as much as going a level and a half out,
// so a count leaves a link clear when it can stay close, and long stems across the email stay rare.
const LIFT = 6;
const GAP = 4;
const EDGE = 4;
const MAX_LEVEL = 3;
const COVER_COST = 3;

// targets: each clicked link's boxes in the email, first its top one, the one its count goes by; sizes: each count's
// { width, height }; links: the boxes of every link the email counts; width: the email's. Each count's box, with its
// side of the link: "inside", "above" or "below".
export function placeCounts(targets, sizes, { width, links = [] }) {
	const placed = [];
	const spots = [];
	const order = targets.map((_, index) => index).sort((a, b) => compareBoxes(targets[a].boxes[0], targets[b].boxes[0]));
	for (const index of order) {
		const { boxes } = targets[index];
		const others = links.filter((box) => !boxes.includes(box));
		const candidates = getCandidates(boxes[0], sizes[index], width);
		const cost = (spot) => spot.cost + (covers(spot, spot.side === "inside" ? others : links) ? COVER_COST : 0);
		const spot = candidates
			.filter((candidate) => !covers(candidate, placed))
			.reduce((best, candidate) => (!best || cost(candidate) < cost(best) ? candidate : best), null);
		placed.push(spot ?? candidates[0]);
		spots[index] = spot ?? candidates[0];
	}
	return spots;
}

// A link's share of the contacts who clicked a link: "78%", or "<1%" for one that rounds to nothing.
export function formatShare(part, total) {
	if (!total) return null;
	const share = Math.min(part / total, 1);
	return share > 0 && share < 0.005 ? "<1%" : `${Math.round(share * 100)}%`;
}

// Below costs a little more than above, each level out more again, and a picture's own count is best on it.
function getCandidates(box, size, width) {
	// Narrower than a count, the email keeps it on its left edge.
	const left = Math.max(EDGE, Math.min(box.left + box.width / 2 - size.width / 2, width - EDGE - size.width));
	const spot = (side, top, cost) => ({ side, left, top, ...size, cost });
	const candidates = box.height >= size.height * 3 ? [spot("inside", box.top + LIFT, -1)] : [];
	for (let level = 0; level <= MAX_LEVEL; level += 1) {
		const step = level * (size.height + GAP);
		candidates.push(
			spot("above", box.top - LIFT - size.height - step, level * 2),
			spot("below", box.top + box.height + LIFT + step, level * 2 + 1)
		);
	}
	return candidates;
}

// Reading order: top to bottom, then left to right.
function compareBoxes(a, b) {
	return a.top - b.top || a.left - b.left;
}

function covers(spot, boxes) {
	return boxes.some((box) => overlaps(spot, box));
}

function overlaps(a, b) {
	return (
		a.left < b.left + b.width + GAP &&
		b.left < a.left + a.width + GAP &&
		a.top < b.top + b.height + GAP &&
		b.top < a.top + a.height + GAP
	);
}
