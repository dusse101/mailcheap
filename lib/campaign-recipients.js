import "server-only";
import { scoped } from "@/lib/account-scope";
import { RECIPIENT_COUNTS, RECIPIENT_MATCHES, toRecipientCounts } from "@/lib/campaign-recipient-rules";
import { getEmailOutcome } from "@/lib/email-outcome";
import CampaignLink from "@/models/CampaignLink";
import Contact from "@/models/Contact";
import Message from "@/models/Message";

const FIELDS = {
	contactId: 1,
	email: 1,
	status: 1,
	error: 1,
	sentAt: 1,
	deliveredAt: 1,
	openedAt: 1,
	clickedAt: 1,
	clickedLinks: 1,
	bouncedAt: 1,
	complainedAt: 1,
	unsubscribedAt: 1,
};

function sentEmails(account, campaign) {
	return scoped(account, { campaignId: campaign._id, kind: "campaign", sentAt: { $ne: null } });
}

// How many recipients each filter of lib/campaign-recipient-rules.js picks.
export async function countCampaignRecipients(account, campaign) {
	const [row] = await Message.aggregate([{ $match: sentEmails(account, campaign) }, { $group: { _id: null, ...RECIPIENT_COUNTS } }]);
	return toRecipientCounts(row);
}

// A page of the recipients a filter picks, in the order they joined the list, each with what the email came to
// (lib/email-outcome.js) and the links they clicked. A contact deleted since shows without its address, which only its
// emails still have. after: the previous page's last contact ID. nextCursor: this page's, when there's another.
export async function listCampaignRecipients(account, campaign, { filter = "all", limit, after = null }) {
	const messages = await Message.find({
		...sentEmails(account, campaign),
		...RECIPIENT_MATCHES[filter],
		...(after && { contactId: { $gt: after } }),
	})
		.sort({ contactId: 1 })
		.limit(limit + 1)
		.select(FIELDS)
		.lean();
	const page = messages.slice(0, limit);
	const keys = [...new Set(page.flatMap(({ clickedLinks }) => clickedLinks ?? []))];
	const [contacts, links] = await Promise.all([
		page.length > 0
			? Contact.find(scoped(account, { _id: { $in: page.map(({ contactId }) => contactId) } }))
					.select({ firstName: 1 })
					.lean()
			: [],
		keys.length > 0
			? CampaignLink.find(scoped(account, { campaignId: campaign._id, key: { $in: keys } }))
					.select({ key: 1, url: 1 })
					.lean()
			: [],
	]);
	const names = new Map(contacts.map(({ _id, firstName }) => [String(_id), firstName || null]));
	const urls = new Map(links.map(({ key, url }) => [key, url]));

	return {
		recipients: page.map((message) => {
			const contactId = String(message.contactId);
			const isKept = names.has(contactId);
			return {
				contactId: isKept ? contactId : null,
				email: isKept ? message.email : null,
				firstName: names.get(contactId) ?? null,
				outcome: getEmailOutcome(message),
				sentAt: message.sentAt ?? null,
				deliveredAt: message.deliveredAt ?? null,
				openedAt: message.openedAt ?? null,
				clickedAt: message.clickedAt ?? null,
				bouncedAt: message.bouncedAt ?? null,
				complainedAt: message.complainedAt ?? null,
				unsubscribedAt: message.unsubscribedAt ?? null,
				clickedLinks: (message.clickedLinks ?? []).map((key) => urls.get(key)).filter(Boolean),
			};
		}),
		nextCursor: messages.length > limit ? String(page.at(-1).contactId) : null,
	};
}
