// What happened to a contact besides its emails (lib/contact-emails.js), newest first, for its page's timeline: how it
// came in, then every change of its status (lib/status-changes.js). Contacts from before every change was recorded only
// kept dates (confirmed, unsubscribed, stopped, signed up again), which show when no recorded change says the same. And a
// change that starts from a status nothing explains, like a resubscribe undoing an unsubscribe nobody recorded, comes after
// one that went unrecorded: it shows too, dated before that change.
const SAME_TIME_MS = 60_000;
// After a signup: active, or pending until they confirm.
const JOINED = "joined";
const LEGACY_STATUSES = { confirmed: "active", unsubscribed: "unsubscribed", stopped: "bounced", "signed-up-again": JOINED };

function isNear(date, other) {
	return Math.abs(new Date(date).getTime() - new Date(other).getTime()) < SAME_TIME_MS;
}

function timeOf(event) {
	return new Date(event.at).getTime();
}

function fits(status, from) {
	if (status === null) return true;
	return status === JOINED ? from === "active" || from === "pending" : status === from;
}

export function getContactHistory(contact) {
	const added = contact.createdAt ?? contact.subscribedAt;
	const changes = (contact.statusChanges ?? [])
		.filter(({ at }) => at)
		.map(({ from, to, at, via, consent, source, reason }) => ({
			type: "status",
			at,
			from: from ?? null,
			to,
			via: via ?? null,
			consent: consent === true,
			source: source ?? null,
			reason: reason ?? null,
		}));
	const isRecorded = (date, matches) => changes.some((change) => matches(change) && isNear(change.at, date));
	const signedUpAgain =
		added &&
		contact.subscribedAt &&
		timeOf({ at: contact.subscribedAt }) - timeOf({ at: added }) >= SAME_TIME_MS &&
		!isRecorded(contact.subscribedAt, ({ from }) => from === "unsubscribed" || from === "dormant");
	const legacy = [
		contact.confirmedAt &&
			!isRecorded(contact.confirmedAt, ({ from }) => from === "pending") && { type: "confirmed", at: contact.confirmedAt },
		contact.unsubscribedAt &&
			!(added && isNear(contact.unsubscribedAt, added)) &&
			!isRecorded(contact.unsubscribedAt, ({ to }) => to === "unsubscribed") && { type: "unsubscribed", at: contact.unsubscribedAt },
		contact.undeliverableAt &&
			!isRecorded(contact.undeliverableAt, ({ to }) => to === "bounced") && {
				type: "stopped",
				at: contact.undeliverableAt,
				reason: contact.undeliverableReason ?? null,
			},
		signedUpAgain && { type: "signed-up-again", at: contact.subscribedAt },
	].filter(Boolean);

	// An import can bring contacts in with any status, so theirs is only known from their first change.
	let status = contact.source === "import" ? null : JOINED;
	const unrecorded = [];
	for (const event of [...changes, ...legacy].toSorted((a, b) => timeOf(a) - timeOf(b))) {
		if (event.type !== "status") {
			status = LEGACY_STATUSES[event.type];
			continue;
		}
		if (event.from && !fits(status, event.from)) {
			unrecorded.push({ type: "status", at: new Date(timeOf(event) - 1), from: null, to: event.from, via: null, before: event.at });
		}
		status = event.to;
	}

	return [...(added ? [{ type: "added", at: added }] : []), ...changes, ...legacy, ...unrecorded].toSorted(
		(a, b) => timeOf(b) - timeOf(a)
	);
}
