import { scoped } from "@/lib/account-scope";
import { BACKOFF, SENDER_WARMUP } from "@/lib/config";
import { isNewDomain } from "@/lib/domain-age";
import { getSenderDayStart } from "@/lib/send-spread";
import { getSendingDomain, isSharedSendingDomain } from "@/lib/sender-rules";
import { CAMPAIGN_MESSAGE_KINDS } from "@/lib/sending-rules";
import Message from "@/models/Message";
import Newsletter from "@/models/Newsletter";
import SenderDomain from "@/models/SenderDomain";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WAITING_STATUSES = ["queued", "held"];

// The account's newsletters sending from a domain: the ones that last sent from it, and the ones whose from address is
// on it now.
export async function findDomainNewsletterIds(account, domain) {
	const newsletters = await Newsletter.find(scoped(account)).select({ fromEmail: 1, slug: 1, sendingDomain: 1 }).lean();
	return newsletters
		.filter((newsletter) => newsletter.sendingDomain === domain || getSendingDomain(newsletter) === domain)
		.map(({ _id }) => _id);
}

// A kept domain's held-back Gmail readers: its start, its first day's Gmail emails, and how many days, 1 for a new
// domain, BACKOFF.days after a back-off, whose days spread their emails, 0 for a domain Gmail already knows. Ones kept
// before days were are a back-off's, or a new domain's first day.
function readKept(kept) {
	const isBackoff = Boolean(kept.backoffAt);
	return {
		startedAt: kept.startedAt ?? null,
		firstDay: kept.days === undefined && !isBackoff ? SENDER_WARMUP.gmailFirstDay : kept.firstDay,
		days: kept.days ?? (isBackoff ? BACKOFF.days : 1),
		isGradual: isBackoff,
	};
}

function isHeldBack({ startedAt, days }, now) {
	return days >= 1 && (!startedAt || now.getTime() - new Date(startedAt).getTime() < days * DAY_MS);
}

// How Gmail's readers of a domain the account sends from are held back (lib/send-spread.js getSenderPace). A domain it
// never sent from starts with its next send: on its first day if it's new to Gmail, a newsletter's own subdomain of the
// shared domain or a domain not proven older than SENDER_WARMUP.newDomainDays (lib/domain-age.js), else not at all. A
// newsletter that sent before domains were kept counts from its first campaign email. While another of the account's
// domains backs off (lib/send-backoff.js), a new one goes on with that back-off, so moving to another domain doesn't skip it.
export async function getSenderWarmup(account, newsletter, domain, now = new Date()) {
	const kept = await SenderDomain.findOne(scoped(account, { domain })).lean();
	// Without startedAt: started over ahead of its next send, which starts it.
	if (kept) return { ...readKept(kept), isKept: Boolean(kept.startedAt) };
	const [first, backingOff] = await Promise.all([
		newsletter.sendingDomain
			? null
			: Message.findOne(scoped(account, { newsletterId: newsletter._id, kind: { $in: CAMPAIGN_MESSAGE_KINDS }, sentAt: { $ne: null } }))
					.sort({ sentAt: 1 })
					.select({ sentAt: 1 })
					.lean(),
		SenderDomain.findOne(scoped(account, { backoffAt: { $gt: new Date(now.getTime() - BACKOFF.hours * HOUR_MS) } }))
			.sort({ startedAt: -1 })
			.lean(),
	]);
	if (first) return { startedAt: first.sentAt, firstDay: SENDER_WARMUP.gmailFirstDay, days: 1, isGradual: false, isKept: false };
	if (backingOff) return { ...readKept(backingOff), firstDay: Math.min(SENDER_WARMUP.gmailFirstDay, backingOff.firstDay), isKept: false };
	const isNew = isSharedSendingDomain(domain) || (await isNewDomain(domain, now));
	return { startedAt: null, firstDay: SENDER_WARMUP.gmailFirstDay, days: isNew ? 1 : 0, isGradual: false, isKept: false };
}

// At a send: the domain's held-back Gmail readers, started now if it never sent and kept for every newsletter of the
// account sending from it, and the domain the newsletter sends from.
export async function startSenderWarmup(account, newsletter, domain, now = new Date()) {
	const warmup = await getSenderWarmup(account, newsletter, domain, now);
	if (!warmup.isKept) {
		try {
			await SenderDomain.updateOne(
				scoped(account, { domain, startedAt: null }),
				{ $set: { startedAt: warmup.startedAt ?? now, firstDay: warmup.firstDay, days: warmup.days } },
				{ upsert: true }
			);
		} catch (error) {
			// Another send of the domain started it first.
			if (error?.code !== 11000) throw error;
		}
	}
	if (newsletter.sendingDomain !== domain) {
		await Newsletter.updateOne(scoped(account, { _id: newsletter._id }), { $set: { sendingDomain: domain } });
	}
	return readKept(await SenderDomain.findOne(scoped(account, { domain })).lean());
}

// The domain's Gmail emails: the ones the account's sends from it still have to send, which go before a new send's, and
// the ones it sent since `since`. campaign: the send being scheduled, whose own don't count; isReleasing: a step of it,
// after its own already queued.
async function countSenderGmail(account, domain, { since, campaignId = null, isReleasing = false }) {
	const newsletterIds = await findDomainNewsletterIds(account, domain);
	const gmail = { newsletterId: { $in: newsletterIds }, kind: { $in: CAMPAIGN_MESSAGE_KINDS }, provider: "gmail" };
	const others = campaignId && (isReleasing ? { $or: [{ campaignId: { $ne: campaignId } }, { status: "queued" }] } : { campaignId: { $ne: campaignId } });
	const [inFlight, sentToday] = await Promise.all([
		Message.countDocuments(scoped(account, { ...gmail, sentAt: null, status: { $in: WAITING_STATUSES }, ...others })),
		since ? Message.countDocuments(scoped(account, { ...gmail, sentAt: { $gte: since } })) : 0,
	]);
	return { inFlight, sentToday };
}

// What the dashboard needs for the pace of the domain a newsletter sends from (getSenderPace).
export async function getSenderVolumes(account, newsletter, domain, now = new Date()) {
	const warmup = await getSenderWarmup(account, newsletter, domain, now);
	const { startedAt, firstDay, days, isGradual } = warmup;
	if (!isHeldBack(warmup, now)) return { startedAt, firstDay, days, isGradual, domain };
	const counts = await countSenderGmail(account, domain, { since: startedAt && getSenderDayStart(startedAt, now) });
	return { startedAt, firstDay, days, isGradual, ...counts, domain };
}

// For a send's batches: the domain its newsletter sent from when it was queued, while its Gmail readers are held back,
// with what it sent today and what the account's sends from it still have to send. null otherwise.
export async function getCampaignSenderVolumes(campaign, { isReleasing = false, now = new Date() } = {}) {
	const account = { _id: campaign.accountId };
	const newsletter = await Newsletter.findOne(scoped(account, { _id: campaign.newsletterId })).select({ sendingDomain: 1 }).lean();
	const domain = newsletter?.sendingDomain;
	const kept = domain ? await SenderDomain.findOne(scoped(account, { domain })).lean() : null;
	if (!kept?.startedAt) return null;
	const warmup = readKept(kept);
	if (!isHeldBack(warmup, now)) return null;
	const counts = await countSenderGmail(account, domain, {
		since: getSenderDayStart(warmup.startedAt, now),
		campaignId: campaign._id,
		isReleasing,
	});
	return { ...warmup, ...counts, domain };
}
