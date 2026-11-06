import { getAppUrl } from "./config.js";
import { createContactToken, verifyContactToken } from "./contact-token.js";

// Its own key, so an unsubscribe link can never confirm a subscription or the other way around.
const INFO = "mailcheap-confirm-v1";
// A link minted with a message keeps working this long from that message's createdAt, including a retried send.
export const CONFIRM_LINK_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// A pending contact who signs up again gets the confirmation email again, once the last one is waitMinutes old and at
// most perDay in 24 hours: a script can't mail an address over and over, and nobody waits for a link forever.
export const CONFIRMATION_RESENDS = { waitMinutes: 10, perDay: 3 };

export function createConfirmToken({ contactId, newsletterId }, now = Date.now()) {
	return createContactToken({ info: INFO, contactId, newsletterId }, now);
}

export function verifyConfirmToken(token, now = Date.now()) {
	return verifyContactToken(token, { info: INFO, maxAgeMs: CONFIRM_LINK_MAX_AGE_MS, now });
}

// now: when the email was created, so a retried send carries the same link.
export function getConfirmUrl({ contactId, newsletterId }, baseUrl = getAppUrl(), now = Date.now()) {
	return `${baseUrl}/confirm?token=${createConfirmToken({ contactId, newsletterId }, now)}`;
}
