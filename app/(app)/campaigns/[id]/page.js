import { isValidObjectId } from "mongoose";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import CampaignReport from "@/components/CampaignReport";
import FormCampaign from "@/components/FormCampaign";
import { scoped } from "@/lib/account-scope";
import { getAccountSendProblem, hasActiveSubscription, isBlocked } from "@/lib/account-state";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { findCampaignLinks } from "@/lib/campaign-links";
import { getCampaignActivity, getCampaignComparison } from "@/lib/campaign-report";
import { countCampaignGmail, countRemainingContacts, sendTimesPipeline } from "@/lib/campaign-queries";
import { getSharedDomain, isSendingEnabled } from "@/lib/config";
import { getFieldOptions } from "@/lib/contact-fields";
import { getStoredTips } from "@/lib/content-review";
import { getPostalAddress } from "@/lib/postal-address";
import { countAudience, countSegmentCards, findCampaignSegmentFilter, listLiveSegments } from "@/lib/segment-queries";
import { compileSegment, describeSegment } from "@/lib/segments";
import { getSelectedNewsletter, openNewsletter } from "@/lib/selected-newsletter";
import { getPace } from "@/lib/send-spread";
import { serialize } from "@/lib/serialize";
import { findAccountDomains, loadSender } from "@/lib/sender";
import { getOwnDomainNudge, isOnSharedDomain, isOwnDomainNudgeShown } from "@/lib/sender-rules";
import { getSenderVolumes } from "@/lib/sender-warmup";
import { siteExtensions } from "@/lib/site-extensions";
import { TIME_ZONE_COOKIE, resolveTimeZone } from "@/lib/time-zone";
import { countEmailsInFlight, getUsage } from "@/lib/usage";
import Campaign from "@/models/Campaign";
import Newsletter from "@/models/Newsletter";

export const metadata = { title: "Campaign" };

export default async function CampaignPage({ params }) {
	const [{ id }, view] = await Promise.all([params, getSelectedNewsletter()]);
	const { user, account } = view;
	if (!isValidObjectId(id)) notFound();

	const campaign = await Campaign.findOne(scoped(account, { _id: id })).lean();
	if (!campaign) notFound();
	openNewsletter(view, campaign.newsletterId, `/campaigns/${id}`);
	const stored = await Newsletter.findOne(scoped(account, { _id: campaign.newsletterId })).lean();
	if (!stored) notFound();
	// The previews and the checks show the address its emails print.
	const newsletter = { ...stored, postalAddress: getPostalAddress(stored, siteExtensions.defaultPostalAddress) };
	const plan = await getPlanState(account);

	if (!["draft", "scheduled"].includes(campaign.status)) {
		const [{ providers, timeline }, comparison, remainingCount, links, cookieStore] = await Promise.all([
			getCampaignActivity(campaign),
			getCampaignComparison(campaign),
			countRemainingContacts(campaign),
			findCampaignLinks(campaign),
			cookies(),
		]);
		// For a next step's dialog, and how a send going out reaches Gmail's readers.
		const isGoingOut = ["sending", "paused"].includes(campaign.status);
		const [audience, senderVolumes, gmail] = await Promise.all([
			remainingCount > 0 ? countAudience(account, newsletter._id, await findCampaignSegmentFilter(campaign)) : null,
			remainingCount > 0 || isGoingOut ? loadSenderVolumes(account, newsletter) : null,
			isGoingOut ? countCampaignGmail(campaign) : null,
		]);
		return (
			<CampaignReport
				campaign={serialize(campaign)}
				newsletter={serialize(newsletter)}
				contactFields={getFieldOptions(account)}
				providers={providers}
				links={serialize(links)}
				timeline={timeline}
				comparison={comparison}
				timeZone={resolveTimeZone(cookieStore.get(TIME_ZONE_COOKIE)?.value)}
				remainingCount={remainingCount}
				emailsLeft={plan.emailsLeft}
				isBlocked={isBlocked(account)}
				pace={getPace({ sender: senderVolumes })}
				newContacts={audience?.neverMailed ?? 0}
				gmail={gmail}
				gmailShare={getGmailShare(audience)}
				isSharedSender={isOnSharedDomain(newsletter.fromEmail, getSharedDomain())}
			/>
		);
	}

	// A draft whose segment was deleted goes to nobody until it gets another one.
	const segments = await listLiveSegments(account, newsletter._id);
	const segment = campaign.segmentId ? segments.find(({ _id }) => _id.equals(campaign.segmentId)) : null;
	const isSegmentDeleted = Boolean(campaign.segmentId && !segment);
	const [audience, everyone, sender, sendTimes, domains, tips] = await Promise.all([
		isSegmentDeleted ? { contacts: 0, neverMailed: 0, gmail: 0 } : countAudience(account, newsletter._id, segment && compileSegment(segment)),
		campaign.segmentId ? countSegmentCards(account, newsletter._id, []) : null,
		loadSender(account, newsletter),
		getSendTimes(campaign),
		findAccountDomains(account._id),
		getStoredTips({ campaign, newsletter }),
	]);
	const senderVolumes = sender.identity ? await getSenderVolumes(account, newsletter, sender.identity) : null;
	const sharedDomain = getSharedDomain();
	const domainNudge = getOwnDomainNudge({ fromEmail: newsletter.fromEmail, domains, sharedDomain });
	// Without a plan there's no shared address yet, and adding a domain waits for one.
	const isDomainNudgeShown = hasActiveSubscription(account) && isOwnDomainNudgeShown(domainNudge, newsletter);

	return (
		<FormCampaign
			campaign={serialize(campaign)}
			newsletter={serialize(newsletter)}
			audienceCount={audience.contacts}
			everyoneCount={everyone?.everyone ?? audience.contacts}
			segments={segments.map(({ _id, name, match, conditions }) => ({
				id: String(_id),
				name,
				description: describeSegment({ match, conditions }, account.contactFields ?? []),
			}))}
			contactFields={getFieldOptions(account)}
			isSegmentDeleted={isSegmentDeleted}
			senderProblem={sender.problem ?? null}
			isSharedSender={isOnSharedDomain(newsletter.fromEmail, sharedDomain)}
			domainNudge={isDomainNudgeShown ? domainNudge : null}
			isSendingEnabled={isSendingEnabled()}
			testEmail={user.email}
			sendTimes={sendTimes}
			archiveUrlBase={newsletter.archiveEnabled ? getArchiveUrls(newsletter).absolutePost("") : null}
			planProblem={plan.problem}
			emailsLeft={plan.emailsLeft}
			pace={getPace({ sender: senderVolumes })}
			newContacts={audience.neverMailed}
			gmailShare={getGmailShare(audience)}
			tips={tips}
		/>
	);
}

// What the send dialogs need: emails left after the sends already going out (null: no limit), and what
// blocks any send. Without a plan, the send buttons open the paywall instead.
async function getPlanState(account) {
	if (!hasActiveSubscription(account)) return { emailsLeft: null, problem: null };
	const [usage, inFlight] = await Promise.all([getUsage(account), countEmailsInFlight(account._id)]);
	const accountProblem = getAccountSendProblem(account)?.message ?? null;
	if (usage.emailsLimit === null) return { emailsLeft: null, problem: accountProblem };
	const emailsLeft = Math.max(0, usage.emailsLimit - usage.emailsSent - inFlight);
	const problem =
		accountProblem ??
		(usage.subscribers > usage.subscribersLimit
			? "Over your plan's subscriber limit"
			: emailsLeft === 0
				? "This month's emails are used up"
				: null);
	return { emailsLeft, problem };
}

// How its domain holds Gmail's readers back: none while the newsletter can't send.
async function loadSenderVolumes(account, newsletter) {
	const sender = await loadSender(account, newsletter);
	return sender.identity ? getSenderVolumes(account, newsletter, sender.identity) : null;
}

function getGmailShare(audience) {
	return audience?.contacts ? audience.gmail / audience.contacts : 0;
}

// A newsletter's first issue borrows the times the account's other newsletters go out.
async function getSendTimes(campaign) {
	const { accountId } = campaign;
	const own = await Campaign.aggregate(
		sendTimesPipeline({ accountId, newsletterId: campaign.newsletterId, excludeId: campaign._id })
	);
	const rows = own.length > 0 ? own : await Campaign.aggregate(sendTimesPipeline({ accountId, excludeId: campaign._id }));
	return {
		history: rows.map(({ at }) => at.toISOString()),
		taken: own.filter(({ status }) => status === "scheduled").map(({ at }) => at.toISOString()),
	};
}
