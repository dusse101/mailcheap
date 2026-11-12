// Who a sent campaign went to, by what they did with it, among its emails that went out (lib/campaign-recipients.js).
// unopened: delivered, and neither opened, bounced nor marked as spam. undelivered: no delivery and no hard bounce, so
// still on its way or turned away by their inbox, like a full mailbox. unsubscribed: through this issue
// (models/Message.js).
export const RECIPIENT_FILTERS = ["all", "opened", "clicked", "unopened", "undelivered", "bounced", "unsubscribed"];

// Each filter's part of the query on the campaign's emails.
export const RECIPIENT_MATCHES = {
	all: {},
	opened: { openedAt: { $ne: null } },
	clicked: { clickedAt: { $ne: null } },
	unopened: { deliveredAt: { $ne: null }, openedAt: null, bouncedAt: null, complainedAt: null },
	undelivered: { deliveredAt: null, bouncedAt: null },
	bounced: { bouncedAt: { $ne: null } },
	unsubscribed: { unsubscribedAt: { $ne: null } },
};

const isSet = (field) => ({ $gt: [`$${field}`, null] });
const isUnset = (field) => ({ $not: [isSet(field)] });
const countWhen = (condition) => ({ $sum: { $cond: [condition, 1, 0] } });

// How many each filter picks, in a $group over the same emails.
export const RECIPIENT_COUNTS = {
	all: { $sum: 1 },
	opened: countWhen(isSet("openedAt")),
	clicked: countWhen(isSet("clickedAt")),
	unopened: countWhen({ $and: [isSet("deliveredAt"), isUnset("openedAt"), isUnset("bouncedAt"), isUnset("complainedAt")] }),
	undelivered: countWhen({ $and: [isUnset("deliveredAt"), isUnset("bouncedAt")] }),
	bounced: countWhen(isSet("bouncedAt")),
	unsubscribed: countWhen(isSet("unsubscribedAt")),
};

export function readRecipientFilter(value) {
	return RECIPIENT_FILTERS.includes(value) ? value : "all";
}

export function toRecipientCounts(row) {
	return Object.fromEntries(RECIPIENT_FILTERS.map((filter) => [filter, row?.[filter] ?? 0]));
}
