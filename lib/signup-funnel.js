// Fork: the signup funnel of a newsletter, day by day: signed up, confirmation email sent, confirm page opened,
// confirmed; and who is still pending. app/api/signup-funnel/route.js serves it to tacoandtell.com's daily report.
import { shiftDateKey, startOfDateKey, toDateKey } from "@/lib/time-zone";
import Contact from "@/models/Contact";
import Message from "@/models/Message";

export const MAX_FUNNEL_DAYS = 90;
export const MAX_PENDING_LISTED = 500;

// A plain path on the site, like /frisco or /issues/some-slug: no host, query, fragment or anything to escape.
const SIGNUP_PATH_PATTERN = /^\/[A-Za-z0-9\-_./]{0,199}$/;

export function readSignupPath(value) {
	return typeof value === "string" && SIGNUP_PATH_PATTERN.test(value) && !value.includes("//") ? value : null;
}

// The confirm page showed a pending contact its button: the first time only, so a refresh keeps the first open.
// Never changes the status: only the button's POST confirms.
export async function markConfirmOpened({ accountId, newsletterId, contactId, at = new Date() }) {
	await Contact.updateOne(
		{ accountId, newsletterId, _id: contactId, status: "pending", confirmOpenedAt: { $exists: false } },
		{ $set: { confirmOpenedAt: at } }
	);
}

function dayOf(date, timeZone) {
	return { $dateToString: { date, format: "%Y-%m-%d", timezone: timeZone } };
}

async function countByDay(model, match, field, timeZone) {
	const rows = await model.aggregate([{ $match: match }, { $group: { _id: dayOf(`$${field}`, timeZone), count: { $sum: 1 } } }]);
	return new Map(rows.map(({ _id, count }) => [_id, count]));
}

// signedUp: contacts whose subscribedAt is that day (a signup again that brought someone back counts again).
// confirmSent: confirmation emails sent that day, a resend included. confirmOpened: contacts whose confirm page first
// showed the button that day. confirmed: contacts whose confirmedAt is that day.
export async function getSignupFunnel({ newsletter, days = 7, timeZone = "UTC", pendingLimit = 100, now = new Date() }) {
	const { accountId, _id: newsletterId } = newsletter;
	const today = toDateKey(now, timeZone);
	const dates = Array.from({ length: days }, (_, index) => shiftDateKey(today, index - days + 1));
	const since = startOfDateKey(dates[0], timeZone);
	const contacts = { accountId, newsletterId };

	const [signedUp, confirmSent, confirmOpened, confirmed, pending, pendingTotal] = await Promise.all([
		countByDay(Contact, { ...contacts, subscribedAt: { $gte: since } }, "subscribedAt", timeZone),
		countByDay(Message, { accountId, newsletterId, kind: "confirmation", sentAt: { $gte: since } }, "sentAt", timeZone),
		countByDay(Contact, { ...contacts, confirmOpenedAt: { $gte: since } }, "confirmOpenedAt", timeZone),
		countByDay(Contact, { ...contacts, confirmedAt: { $gte: since } }, "confirmedAt", timeZone),
		Contact.find({ ...contacts, status: "pending" })
			.sort({ subscribedAt: -1, _id: -1 })
			.limit(pendingLimit)
			.select({ email: 1, subscribedAt: 1, confirmOpenedAt: 1, source: 1, signupPath: 1 })
			.lean(),
		Contact.countDocuments({ ...contacts, status: "pending" }),
	]);
	const lastSent = await findLastConfirmationSent(accountId, pending);

	const byDay = dates.map((date) => ({
		date,
		signedUp: signedUp.get(date) ?? 0,
		confirmSent: confirmSent.get(date) ?? 0,
		confirmOpened: confirmOpened.get(date) ?? 0,
		confirmed: confirmed.get(date) ?? 0,
	}));
	const totals = Object.fromEntries(
		["signedUp", "confirmSent", "confirmOpened", "confirmed"].map((key) => [key, byDay.reduce((sum, day) => sum + day[key], 0)])
	);
	return {
		newsletter: newsletter.slug,
		days,
		from: dates[0],
		to: today,
		timeZone,
		totals,
		byDay,
		pending: pending.map((contact) => ({
			email: contact.email,
			subscribedAt: toIso(contact.subscribedAt),
			confirmSentAt: toIso(lastSent.get(String(contact._id))),
			confirmOpenedAt: toIso(contact.confirmOpenedAt),
			source: contact.source ?? null,
			signupPath: contact.signupPath ?? null,
		})),
		pendingTotal,
	};
}

// When each contact's latest confirmation email went out: a queued one that hasn't left yet doesn't count.
async function findLastConfirmationSent(accountId, contacts) {
	if (contacts.length === 0) return new Map();
	const rows = await Message.aggregate([
		{ $match: { accountId, kind: "confirmation", contactId: { $in: contacts.map(({ _id }) => _id) }, sentAt: { $type: "date" } } },
		{ $group: { _id: "$contactId", sentAt: { $max: "$sentAt" } } },
	]);
	return new Map(rows.map(({ _id, sentAt }) => [String(_id), sentAt]));
}

function toIso(value) {
	return value ? new Date(value).toISOString() : null;
}
