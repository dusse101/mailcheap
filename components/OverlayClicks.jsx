"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { formatShare, placeCounts } from "@/lib/click-map";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

// Dark with a faint light edge, so it shows on an email's dark parts too.
const COUNT =
	"absolute flex h-6 items-center rounded-full bg-zinc-900 px-2.5 text-[11px] leading-none font-medium whitespace-nowrap text-white tabular-nums shadow-[0_0_0_1px_rgb(255_255_255/0.2),0_4px_12px_-2px_rgb(0_0_0/0.4)]";
const EMPTY = { targets: [], spots: [] };

// A sent issue's clicks on its email, in the preview's frame: by each link that got some, the contacts who clicked it
// and their share of the contacts who clicked a link, as the report's links count them. The email's links carry the keys
// of their clicks (withLinkKeys in lib/link-stats.js). Pointing at a link or its count brings the count to the front and
// outlines the link, wherever the email has it.
export default function OverlayClicks({ frameRef, links, clickers }) {
	const [layout, setLayout] = useState(EMPTY);
	const [activeKey, setActiveKey] = useState(null);
	const overlayRef = useRef(null);
	const countsByKey = useMemo(() => new Map(links.map((link) => [link.key, link.clickers])), [links]);

	// Measured again at each load, since another reader's email is another document, and whenever the frame changes size:
	// the email's fonts and pictures coming in, or another width.
	useEffect(() => {
		const frame = frameRef.current;
		let email = null;
		let request = 0;
		const measure = () => {
			cancelAnimationFrame(request);
			request = requestAnimationFrame(() => setLayout(measureLayout(frame, overlayRef.current, countsByKey, clickers)));
		};
		const point = (event) => setActiveKey(event.target.closest?.("a[data-link-key]")?.getAttribute("data-link-key") ?? null);
		const leave = (event) => event.relatedTarget || setActiveKey(null);
		const watch = () => {
			email?.removeEventListener("mouseover", point);
			email?.removeEventListener("mouseout", leave);
			email = frame.contentDocument;
			email?.addEventListener("mouseover", point);
			email?.addEventListener("mouseout", leave);
			measure();
		};
		const observer = new ResizeObserver(measure);
		observer.observe(frame);
		frame.addEventListener("load", watch);
		watch();
		return () => {
			cancelAnimationFrame(request);
			observer.disconnect();
			frame.removeEventListener("load", watch);
			email?.removeEventListener("mouseover", point);
			email?.removeEventListener("mouseout", leave);
		};
	}, [frameRef, countsByKey, clickers]);

	return (
		<div ref={overlayRef} aria-hidden="true" className="pointer-events-none absolute inset-0">
			{layout.targets.map(({ key, boxes }, index) =>
				key === activeKey
					? boxes.map((box, part) => (
							<span
								key={`${index}.${part}`}
								style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
								className="absolute rounded-[4px] shadow-[0_0_0_2px_#fff,0_0_0_3.5px_#18181b]"
							/>
						))
					: null
			)}
			{layout.targets.map((target, index) => {
				const spot = layout.spots[index];
				const isActive = target.key === activeKey;
				const stem = getStem(target.boxes[0], spot);
				return (
					<Fragment key={index}>
						{stem && (
							<span
								style={stem}
								className={cn("absolute w-px bg-zinc-900 shadow-[0_0_0_1px_rgb(255_255_255/0.2)]", isActive && "z-10")}
							/>
						)}
						<span
							onPointerEnter={() => setActiveKey(target.key)}
							onPointerLeave={() => setActiveKey(null)}
							style={{ left: spot.left, top: spot.top, "--stagger": Math.min(index, 12) / 4 }}
							className={cn(COUNT, "pointer-events-auto animate-enter", isActive && "z-10")}
						>
							{target.count}
							{target.share && <span className="text-white/55">&nbsp;· {target.share}</span>}
						</span>
					</Fragment>
				);
			})}
		</div>
	);
}

// Each clicked link the email shows, with its count placed by it, clear of the email's other links where it fits.
function measureLayout(frame, overlay, countsByKey, total) {
	const email = frame.contentDocument;
	const view = email?.defaultView;
	if (!view || !overlay) return EMPTY;
	const targets = [];
	const links = [];
	for (const anchor of email.querySelectorAll("a[data-link-key]")) {
		const key = anchor.getAttribute("data-link-key");
		const boxes = getBoxes(anchor, view);
		links.push(...boxes);
		const clicked = countsByKey.get(key);
		if (clicked && boxes.length) {
			targets.push({ key, boxes, count: `${formatNumber(clicked)} clicked`, share: formatShare(clicked, total) });
		}
	}
	const spots = placeCounts(targets, measureCounts(overlay, targets), { width: frame.clientWidth, links });
	return { targets, spots };
}

// The line from a count to its link's edge, at the link's middle as far as the count reaches; none on the link itself.
function getStem(box, spot) {
	const left = clamp(box.left + box.width / 2, spot.left + 8, spot.left + spot.width - 8) - 0.5;
	if (spot.side === "above") return { left, top: spot.top + spot.height, height: box.top - spot.top - spot.height };
	if (spot.side === "below") return { left, top: box.top + box.height, height: spot.top - box.top - box.height };
	return null;
}

// Where the reader saw a link: the pictures it wraps, or else its lines of text, top first. Hidden ones have no size.
function getBoxes(anchor, view) {
	const images = anchor.querySelectorAll("img");
	const rects = images.length ? [...images].map((image) => image.getBoundingClientRect()) : [...anchor.getClientRects()];
	return rects
		.filter(({ width, height }) => width > 0 && height > 0)
		.map(({ left, top, width, height }) => ({ left: left + view.scrollX, top: top + view.scrollY, width, height }));
}

// Each count's size as it renders, from hidden copies laid out together.
function measureCounts(overlay, targets) {
	const copies = targets.map(({ count, share }) => {
		const copy = overlay.ownerDocument.createElement("span");
		copy.className = `${COUNT} invisible`;
		copy.textContent = share ? `${count}\u00a0· ${share}` : count;
		return copy;
	});
	overlay.append(...copies);
	const sizes = copies.map(({ offsetWidth, offsetHeight }) => ({ width: offsetWidth, height: offsetHeight }));
	for (const copy of copies) copy.remove();
	return sizes;
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(value, max));
}
