import "server-only";
import { scoped } from "@/lib/account-scope";
import { sendAlert } from "@/lib/alerts";
import { BACKOFF, SENDER_WARMUP, isCloud } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { getSendingDomain } from "@/lib/sender-rules";
import { findDomainNewsletterIds } from "@/lib/sender-warmup";
import { CAMPAIGN_MESSAGE_KINDS } from "@/lib/sending-rules";
import { pauseRateLimitedSends } from "@/lib/sending";
import Message from "@/models/Message";
import Newsletter from "@/models/Newsletter";
import SenderDomain from "@/models/SenderDomain";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const RATE_LIMIT_REASON = `Gmail asked to slow down, so this newsletter's sends wait ${BACKOFF.hours} hours, then go on by themselves, more slowly at first`;

// The domain's back-off, started now unless one already runs: BACKOFF.hours to wait, then Gmail's readers held back from
// half the Gmail emails the account's newsletters sent from it in the day before.
async function claimBackoff(account, domain, newsletterIds, now) {
	const gmailLastDay = await Message.countDocuments(
		scoped(account, {
			newsletterId: { $in: newsletterIds },
			kind: { $in: CAMPAIGN_MESSAGE_KINDS },
			provider: "gmail",
			sentAt: { $gte: new Date(now.getTime() - DAY_MS) },
		})
	);
	const resumeAt = new Date(now.getTime() + BACKOFF.hours * HOUR_MS);
	const firstDay = Math.max(BACKOFF.minFirstDay, Math.ceil(gmailLastDay / 2));
	try {
		// A domain sending since before domains were kept has none yet.
		await SenderDomain.updateOne(
			scoped(account, { domain }),
			{ $setOnInsert: { startedAt: now, firstDay: SENDER_WARMUP.gmailFirstDay, days: 0 } },
			{ upsert: true }
		);
	} catch (error) {
		if (error?.code !== 11000) throw error;
	}
	const { modifiedCount } = await SenderDomain.updateOne(
		scoped(account, { domain, $or: [{ backoffAt: null }, { backoffAt: { $lte: new Date(now.getTime() - BACKOFF.hours * HOUR_MS) } }] }),
		{ $set: { startedAt: resumeAt, firstDay, days: BACKOFF.days, backoffAt: now } }
	);
	if (modifiedCount) return { isNew: true, resumeAt, firstDay };
	const running = await SenderDomain.findOne(scoped(account, { domain })).lean();
	return { isNew: false, resumeAt: running.startedAt, firstDay: running.firstDay };
}

// Gmail rate limiting the domain a newsletter sent from (lib/email-event-rules.js): sending on would only tell it
// nobody listens. So the sends of every newsletter of the account sending from that domain pause, and BACKOFF.hours
// later Gmail gets half the emails the domain sent it in the day before, spread over the day, doubling each day for
// BACKOFF.days (lib/send-spread.js getSenderPace). Gmail saying it again in those hours, about emails still in the
// provider's queue, only pauses a send resumed early again. MailCheap Cloud only.
export async function backOffSender({ accountId, newsletterId, reason, now = new Date() }) {
	if (!isCloud()) return { skipped: "self-hosted" };
	await connectDb();
	const account = { _id: accountId };
	const newsletter = await Newsletter.findOne(scoped(account, { _id: newsletterId })).select({ name: 1, fromEmail: 1, slug: 1, sendingDomain: 1 }).lean();
	if (!newsletter) return { skipped: "newsletter not found" };
	const domain = newsletter.sendingDomain ?? getSendingDomain(newsletter);
	const newsletterIds = await findDomainNewsletterIds(account, domain);
	const backoff = await claimBackoff(account, domain, newsletterIds, now);
	const paused = await pauseRateLimitedSends({ accountId, newsletterIds, reason: RATE_LIMIT_REASON, resumeAt: backoff.resumeAt });
	if (!backoff.isNew) return { paused, skipped: "already backing off" };

	const sends = paused.length === 1 ? "Its send paused" : `Its ${paused.length} sends paused`;
	await sendAlert({
		accountId: null,
		key: `gmail-backoff:${newsletterId}`,
		title: "Gmail is rate limiting a newsletter",
		detail: `${newsletter.name} (${domain}), account ${accountId}. Gmail answered: ${reason}`,
		action: `${paused.length ? sends : "Nothing was going out"} for ${BACKOFF.hours} hours, then Gmail gets ${formatNumber(backoff.firstDay)} of its emails a day, twice as many each day, for ${BACKOFF.days} days. If it happens again, look at where its contacts came from.`,
		path: `/admin/newsletters/${newsletterId}`,
	});
	return { paused, firstDay: backoff.firstDay, resumeAt: backoff.resumeAt };
}
