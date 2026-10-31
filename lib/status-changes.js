import Contact from "../models/Contact.js";

// Every change of a contact's status is kept on it (Contact.statusChanges), oldest first, for its page and as the record of
// consent: what it was, what it became, when, and what made it (via):
// - dashboard, api, mcp: someone set it (lib/contact-status.js), kept with who and the person's consent;
// - signup: they signed up again (with the signup's source), confirmation: they confirmed;
// - link: the unsubscribe link in an email, mail-app: their mail app's unsubscribe button, provider: the email provider's;
// - bounce, complaint: what an email got;
// - cleanup: the list cleanup made them dormant, keep: they answered its last-chance email;
// - hygiene: the list hygiene stopped them for their domain (with its reason) or let them back;
// - undeliverable: a send skipped an address MailCheap knows can't receive email, admin: an admin let it back;
// - import: an import gave them a stricter status.
export const STATUS_CHANGES_KEPT = 100;

// The update that changes a contact's status, recording the change next to the rest of the update.
export function withStatusChange(update, change) {
	return {
		...update,
		$set: { ...update.$set, status: change.to },
		$push: { ...update.$push, statusChanges: { $each: [change], $slice: -STATUS_CHANGES_KEPT } },
	};
}

// A contact the filter picks, from whichever of the statuses given it has: one try per status, so the change records the
// one it left. options: findOneAndUpdate's. The contact as they return it, or null when none matched.
export async function moveContact(filter, { from, to, via, update = {}, options = {}, at = new Date(), ...details }) {
	for (const status of from) {
		const contact = await Contact.findOneAndUpdate(
			{ ...filter, status },
			withStatusChange(update, { from: status, to, at, via, ...details }),
			options
		).lean();
		if (contact) return contact;
	}
	return null;
}

// The same for every contact the filter picks: how many moved.
export async function moveContacts(filter, { from, to, via, update = {}, options = {}, at = new Date(), ...details }) {
	let moved = 0;
	for (const status of from) {
		const { modifiedCount } = await Contact.updateMany(
			{ ...filter, status },
			withStatusChange(update, { from: status, to, at, via, ...details }),
			options
		);
		moved += modifiedCount;
	}
	return moved;
}
