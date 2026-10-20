import "server-only";
import { revalidatePath } from "next/cache";
import { sendAlert } from "@/lib/alerts";
import { revalidateArchive } from "@/lib/archive-data";
import { getAppUrl } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { publishJob, queueCampaign } from "@/lib/sending";
import { isObjectIdString } from "@/lib/validation";
import Campaign from "@/models/Campaign";

// QStash's free plan delays a message 7 days at most, so later jobs wake up on the way and wait again.
const MAX_WAIT_MS = 6 * 24 * 60 * 60 * 1000;
// Closer than this to its time, a job runs instead of waiting again.
const START_EARLY_MS = 60 * 1000;

// QStash's notBefore, in seconds, for a job due at that time.
export function getWakeAt(at, now = Date.now()) {
	return Math.floor(Math.min(at.getTime(), now + MAX_WAIT_MS) / 1000);
}

export function isTooEarly(at, now = Date.now()) {
	return at.getTime() - now > START_EARLY_MS;
}

export async function publishScheduledSend({ accountId, campaignId, scheduledAt, now = Date.now() }) {
	await publishJob({
		url: `${getAppUrl()}/api/jobs/send-scheduled`,
		body: { accountId: String(accountId), campaignId: String(campaignId), scheduledAt: scheduledAt.toISOString() },
		notBefore: getWakeAt(scheduledAt, now),
	});
}

// Runs when QStash delivers the job. A job whose campaign was rescheduled, unscheduled, sent or
// discarded since does nothing, so changing a schedule never needs to cancel the old job.
export async function runScheduledSend({ accountId, campaignId, scheduledAt }) {
	const isValid =
		isObjectIdString(String(accountId)) && isObjectIdString(String(campaignId)) && typeof scheduledAt === "string";
	if (!isValid) return { skipped: "invalid job" };

	await connectDb();
	const campaign = await Campaign.findOne({ accountId, _id: campaignId }).select("status scheduledAt subject").lean();
	if (campaign?.status !== "scheduled" || campaign.scheduledAt?.toISOString() !== scheduledAt) {
		return { skipped: "not scheduled for this time anymore" };
	}
	if (isTooEarly(campaign.scheduledAt)) {
		await publishScheduledSend({ accountId, campaignId, scheduledAt: campaign.scheduledAt });
		return { waiting: true };
	}

	try {
		const result = await queueCampaign({ accountId, campaignId: String(campaignId) });
		revalidatePath("/campaigns");
		revalidatePath(`/campaigns/${campaignId}`);
		revalidateArchive();
		// Held by the content check, it waits for an admin, paused, instead of going back to draft.
		return result.held ? result : { started: true, ...result };
	} catch (error) {
		// Only a campaign still waiting goes back to draft: one that started and then paused alerts on its own.
		const { modifiedCount } = await Campaign.updateOne(
			{ accountId, _id: campaignId, status: "scheduled" },
			{ $set: { status: "draft" }, $unset: { scheduledAt: 1 } }
		);
		if (modifiedCount) {
			await sendAlert({
				accountId,
				key: `scheduled-send-${campaignId}`,
				title: "Scheduled send didn't start",
				detail: `${error.message.replace(/\.$/, "")}. "${campaign.subject || "Untitled"}" is a draft again.`,
				path: `/campaigns/${campaignId}`,
				cooldownMinutes: 1,
			});
		}
		revalidatePath("/campaigns");
		return { failed: error.message, ...(error.code && { code: error.code }) };
	}
}
