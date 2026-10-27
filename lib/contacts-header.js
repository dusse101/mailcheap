// From this many contacts, a list came from an import or signups rather than by hand, so Add contact moves into the
// Contacts page's ⋯ menu.
export const LIST_STARTED_AT = 3;

// From this many contacts, segments have people to tell apart, so the Segments page has a button.
export const SEGMENTS_FROM = 2;

// The actions at the top of the Contacts page for a newsletter with this many contacts, of any status: the buttons, then
// the ⋯ menu, in their order. Import, the way in, is always a button, and the menu always ends on the help article.
// Without contacts, the page's card has Add contact and there's nothing to export, so the menu holds the fields. An
// action in both is a button on wider screens and in the menu on phones, where the buttons keep to a row.
export function getContactsHeader(count) {
	if (count === 0) return { buttons: ["import"], menu: ["fields", "help"] };
	const segments = count >= SEGMENTS_FROM ? ["segments"] : [];
	if (count < LIST_STARTED_AT) return { buttons: [...segments, "fields", "add", "import"], menu: [...segments, "fields", "export", "help"] };
	return { buttons: ["segments", "fields", "import"], menu: ["add", "segments", "fields", "export", "help"] };
}
