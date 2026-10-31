import { useEffect } from "react";

// The campaign editor collapses the dashboard's sidebar while it's open (NavSidebar), unless the sidebar is expanded
// there. Each time it opens is a new visit, so expanding the sidebar during one doesn't carry over to the next.
let lastVisit = 0;
let openVisit = 0;
const listeners = new Set();

export function useCollapsedSidebar() {
	useEffect(() => openSidebarVisit(), []);
}

// Returns what ends the visit.
export function openSidebarVisit() {
	const visit = ++lastVisit;
	setOpenVisit(visit);
	return () => {
		if (openVisit === visit) setOpenVisit(0);
	};
}

export function subscribeToSidebarVisits(listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

// The open visit's number, 0 when no page collapses the sidebar.
export function readSidebarVisit() {
	return openVisit;
}

// isLeftCollapsed: the sidebar's cookie. expandedVisit: the visit it was last expanded in.
export function isSidebarCollapsed({ isLeftCollapsed, visit, expandedVisit }) {
	return isLeftCollapsed || (visit !== 0 && expandedVisit !== visit);
}

function setOpenVisit(visit) {
	openVisit = visit;
	for (const listener of listeners) listener();
}
