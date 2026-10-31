// localStorage throws when the browser blocks storage; the archive then just forgets.
export function readStoredNumber(key) {
	try {
		return Number(localStorage.getItem(key)) || 0;
	} catch {
		return 0;
	}
}

export function storeValue(key, value) {
	try {
		localStorage.setItem(key, String(value));
	} catch {}
}

// A cookie of this page as the browser has it now, decoded, else null.
export function readCookie(name) {
	const value = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))?.[1];
	return value ? decodeURIComponent(value) : null;
}

export function subscribedKey(newsletterSlug) {
	return `mailcheap:subscribed:${newsletterSlug}`;
}

export function subscribeSnoozedKey(newsletterSlug) {
	return `mailcheap:subscribe-snoozed:${newsletterSlug}`;
}
