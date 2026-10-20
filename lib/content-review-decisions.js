import "server-only";
import { blockAccount } from "@/lib/account-blocks";
import { sendAlert } from "@/lib/alerts";
import { REJECTED_PAUSE_CODE, REJECTED_PAUSE_REASON, REVIEW_PAUSE_CODE } from "@/lib/content-review-codes";
import { connectDb } from "@/lib/db";
import { queueCampaign } from "@/lib/sending";
import Campaign from "@/models/Campaign";

const MAX_NOTE_LENGTH = 300;
const ACCEPTABLE_USE = "It doesn't follow MailCheap's acceptable use policy.";

// The campaign a content check holds, whatever its account: admins decide on any of them (app/admin/actions.js).
async function findHeld(campaignId) {
	await connectDb();
	const campaign = await Campaign.findById(campaignId).select({ accountId: 1, status: 1, pauseCode: 1, subject: 1 }).setOptions({ crossAccount: true }).lean();
	return campaign?.status === "paused" && campaign.pauseCode === REVIEW_PAUSE_CODE ? campaign : null;
}

// Back to draft with the decision on it, then sent as its owner sent it: the check passes the content it approved.
export async function approveReview({ campaignId, admin }) {
	const campaign = await findHeld(campaignId);
	if (!campaign) return { error: "Nothing waits for a review here" };
	const { modifiedCount } = await Campaign.updateOne(
		{ accountId: campaign.accountId, _id: campaign._id, status: "paused", pauseCode: REVIEW_PAUSE_CODE },
		{
			$set: { status: "draft", "review.decision": "approved", "review.decidedBy": admin.email, "review.decidedAt": new Date() },
			$unset: { pauseCode: 1, pauseReason: 1, scheduledAt: 1 },
		}
	);
	if (!modifiedCount) return { error: "It changed, refresh and try again" };
	console.info(`[admin] ${admin.email} approved campaign ${campaign._id} after its content check`);
	try {
		await queueCampaign({ accountId: String(campaign.accountId), campaignId: String(campaign._id) });
	} catch (error) {
		await sendAlert({
			accountId: campaign.accountId,
			key: `content-approved:${campaign._id}`,
			title: "Send didn't start",
			detail: `Your issue was approved, but it couldn't go out: ${error.message.replace(/\.$/, "")}. It's a draft again.`,
			path: `/campaigns/${campaign._id}`,
			cooldownMinutes: 1,
		});
		return { error: `Approved, but the send didn't start: ${error.message}. It's a draft again.` };
	}
	return { ok: true };
}

// It stays paused for good; its owner reads the note, or a plain line, and can duplicate it to change it.
export async function rejectReview({ campaignId, admin, note = "", block = false }) {
	const campaign = await findHeld(campaignId);
	if (!campaign) return { error: "Nothing waits for a review here" };
	const text = String(note ?? "")
		.trim()
		.slice(0, MAX_NOTE_LENGTH)
		.replace(/\.+$/, "");
	const { modifiedCount } = await Campaign.updateOne(
		{ accountId: campaign.accountId, _id: campaign._id, status: "paused", pauseCode: REVIEW_PAUSE_CODE },
		{
			$set: {
				pauseCode: REJECTED_PAUSE_CODE,
				pauseReason: text ? `${REJECTED_PAUSE_REASON}: ${text}` : REJECTED_PAUSE_REASON,
				"review.decision": "rejected",
				"review.decidedBy": admin.email,
				"review.decidedAt": new Date(),
				...(text && { "review.note": text }),
			},
		}
	);
	if (!modifiedCount) return { error: "It changed, refresh and try again" };
	console.info(`[admin] ${admin.email} rejected campaign ${campaign._id} after its content check${block ? " and blocked its account" : ""}`);
	await sendAlert({
		accountId: campaign.accountId,
		key: `content-rejected:${campaign._id}`,
		title: "An issue can't be sent",
		detail: text ? `${text}.` : ACCEPTABLE_USE,
		path: `/campaigns/${campaign._id}`,
		cooldownMinutes: 1,
	});
	if (block) {
		await blockAccount(campaign.accountId, {
			reason: text || "Your account is under review",
			by: "admin",
			detail: `Blocked by ${admin.email} after the content check of campaign ${campaign._id}`,
		});
	}
	return { ok: true };
}
