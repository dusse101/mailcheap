import Contact from "@/models/Contact";

// A newsletter's contacts the list hygiene stopped (lib/list-hygiene.js), by reason.
export async function countStoppedContacts({ accountId, newsletterId }) {
	const rows = await Contact.aggregate([
		{ $match: { accountId, newsletterId, status: "bounced", undeliverableReason: { $exists: true } } },
		{ $group: { _id: "$undeliverableReason", count: { $sum: 1 } } },
	]);
	const counts = Object.fromEntries(rows.map(({ _id, count }) => [_id, count]));
	return { noMailServer: counts["no-mail-server"] ?? 0, spamDomain: counts["spam-domain"] ?? 0 };
}
