import Link from "next/link";
import { Globe, Pause, Play } from "lucide-react";
import { pauseCampaign, resumeCampaign } from "@/app/(app)/campaigns/actions";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import BadgeStatus from "@/components/BadgeStatus";
import ButtonCampaignAction from "@/components/ButtonCampaignAction";
import ButtonCopy from "@/components/ButtonCopy";
import ButtonPreview from "@/components/ButtonPreview";
import CardStat from "@/components/CardStat";
import ChartOpens from "@/components/ChartOpens";
import DialogSendMore from "@/components/DialogSendMore";
import GatePlan from "@/components/GatePlan";
import HeaderPage from "@/components/HeaderPage";
import ImageFavicon from "@/components/ImageFavicon";
import InputCampaignSlug from "@/components/InputCampaignSlug";
import LinkHelp from "@/components/LinkHelp";
import ListLegend from "@/components/ListLegend";
import MenuReport from "@/components/MenuReport";
import NoticeWarmup from "@/components/NoticeWarmup";
import TableCampaignLinks from "@/components/TableCampaignLinks";
import TextEmpty from "@/components/TextEmpty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isPlanLimitCode } from "@/lib/account-state";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { LIMITS, isSendingEnabled } from "@/lib/config";
import { REVIEW_CODES, REVIEW_PAUSE_CODE } from "@/lib/content-review-codes";
import { formatCount, formatDate, formatNumber, formatRate, formatRateChange, formatWeekdayHour } from "@/lib/format";
import { rateTone } from "@/lib/health";
import { toPreviewFrame } from "@/lib/email-preview";
import { PROVIDER_DOMAINS, PROVIDER_LABELS } from "@/lib/providers";
import { describePublishTo, isOnWebsite, readPublishTo } from "@/lib/publish-to";
import { renderEmail } from "@/lib/render-email";
import { TIMELINE_HOURS, findPeak, hoursToHalf, reachedOf } from "@/lib/report-stats";
import { formatPaceTime } from "@/lib/send-spread";
import { getIssueWebUrl } from "@/lib/sending-rules";
import { timeZoneLabel } from "@/lib/time-zone";
import { cn } from "@/lib/utils";
import { BACKOFF_WHY, GMAIL_WHY, STEPS_WHY, getGmailLaterTrack, getGmailTrack, getStepItems } from "@/lib/warmup-status";

// readOnly: an admin looking at a customer's campaign (app/admin/campaigns/[id]): its numbers without its owner's
// actions, and children above them. contactFields: the account's, for the preview to fill in.
export default function CampaignReport({
	campaign,
	newsletter,
	contactFields = [],
	providers,
	links,
	timeline = null,
	comparison = null,
	timeZone,
	remainingCount = 0,
	emailsLeft = 0,
	isBlocked = false,
	pace = null,
	newContacts = 0,
	gmail = null,
	gmailShare = 0,
	isSharedSender = false,
	readOnly = false,
	backHref = "/campaigns",
	children,
}) {
	const { stats } = campaign;
	const id = campaign._id.toString();
	// Held by the content check (lib/content-review.js): only MailCheap's review starts it, so it has no Resume.
	const reviewCode = campaign.status === "paused" && REVIEW_CODES.has(campaign.pauseCode) ? campaign.pauseCode : null;
	// A web-only issue sent no email (lib/publish-to.js): its page and views stand in for the email's numbers.
	const publishTo = readPublishTo(campaign);
	const isWebOnly = publishTo === "web";
	const hasPage = newsletter.archiveEnabled && Boolean(campaign.archiveSlug) && isOnWebsite(campaign);
	const isOnArchive = hasPage && campaign.archiveListed !== false;
	const statusLabel = reviewCode
		? reviewCode === REVIEW_PAUSE_CODE
			? "In review"
			: "Not sent"
		: isWebOnly && campaign.status === "sent"
			? "Published"
			: null;
	const reached = reachedOf(stats);
	const progress = stats.recipients ? Math.min(stats.sent / stats.recipients, 1) : 0;
	// Going out: its contacts never emailed in steps (a send from before had one slice), its Gmail readers a new domain
	// sends a later day, or a send from before steps spread over hours.
	const { firstSend } = campaign;
	const stepSizes = firstSend?.steps ?? (firstSend?.slice ? [firstSend.slice, firstSend.held ?? 0] : null);
	const step = firstSend?.step ?? 1;
	const isInSteps = campaign.status === "sending" && Boolean(stepSizes) && !firstSend.checkedAt;
	const gmailLater = campaign.status === "sending" && gmail?.later > 0 ? getGmailLaterTrack({ domain: newsletter.sendingDomain, ...gmail }) : null;
	const isSpread = campaign.status === "sending" && !isInSteps && Boolean(campaign.sendingUntil) && campaign.spreadHours > 0;
	const backoffTrack = gmail ? getGmailTrack(pace?.sender ?? null, gmail.waiting) : null;
	const { html } = renderEmail({
		format: campaign.format,
		markdown: campaign.markdown,
		html: campaign.html,
		subject: campaign.subject,
		previewText: campaign.previewText,
		newsletter,
	});
	const sender = {
		name: newsletter.name,
		fromName: newsletter.fromName,
		fromEmail: newsletter.fromEmail,
		imageUrl: newsletter.imageUrl,
	};

	return (
		<>
			<HeaderPage
				title={campaign.subject || "Untitled"}
				backHref={backHref}
				icon={<AvatarNewsletter newsletter={newsletter} size={28} />}
				meta={
					<span className="flex items-center gap-2">
						<BadgeStatus status={campaign.status} label={statusLabel} />
						{publishTo !== "both" && <span className="text-xs text-muted-foreground">{describePublishTo(campaign)}</span>}
					</span>
				}
			>
				{!readOnly && (
					<>
						{campaign.status === "sent" && remainingCount > 0 && isSendingEnabled() && !isBlocked && (
							<GatePlan reason="send">
								<DialogSendMore
									campaignId={id}
									sentCount={stats.recipients}
									remainingCount={remainingCount}
									emailsLeft={emailsLeft}
									isCleanupEnabled={Boolean(newsletter.cleanup?.enabled)}
									pace={pace}
									newContacts={newContacts}
									gmailShare={gmailShare}
									isSharedSender={isSharedSender}
								/>
							</GatePlan>
						)}
						{campaign.status === "sending" && (
							<ButtonCampaignAction action={pauseCampaign} id={id}>
								<Pause data-icon="inline-start" />
								Pause
							</ButtonCampaignAction>
						)}
						{campaign.status === "paused" && !reviewCode && (
							<GatePlan reason="send">
								<ButtonCampaignAction
									action={resumeCampaign}
									id={id}
									disabledReason={isBlocked ? "The account is blocked" : isSendingEnabled() ? null : "Sending is off"}
								>
									<Play data-icon="inline-start" />
									Resume
								</ButtonCampaignAction>
							</GatePlan>
						)}
						{!isWebOnly && (
							<ButtonPreview
								html={toPreviewFrame(html)}
								sender={sender}
								subject={campaign.subject}
								previewText={campaign.previewText}
								newsletterId={String(newsletter._id)}
								contactFields={contactFields}
							/>
						)}
						<MenuReport
							id={id}
							subject={campaign.subject}
							pageUrl={isOnArchive ? getArchiveUrls(newsletter).post(campaign.archiveSlug) : null}
							isPinned={Boolean(campaign.archivePinned)}
							isWebOnly={isWebOnly}
						/>
					</>
				)}
			</HeaderPage>

			<div className="flex flex-col gap-6">
				{campaign.status === "paused" && campaign.pauseCode === "rate_limited" ? (
					<NoticeWarmup
						sections={[
							{
								title: "Paused: Gmail asked to slow down",
								tracks: backoffTrack ? [backoffTrack] : [],
								why: BACKOFF_WHY,
								help: { article: "warm-up", section: "gmail" },
								children: !backoffTrack && <p className="text-pretty">{campaign.pauseReason}</p>,
							},
						]}
						className="animate-enter"
					/>
				) : (
					campaign.status === "paused" &&
					campaign.pauseReason && <TextPauseReason reason={campaign.pauseReason} code={campaign.pauseCode} canUpgrade={!readOnly} />
				)}
				{["sending", "paused"].includes(campaign.status) && !(reviewCode && !stats.recipients) && (
					<div className="flex flex-col gap-2 animate-enter">
						<div className="flex justify-between text-sm tabular-nums">
							<span className="text-muted-foreground">
								{formatNumber(stats.sent)} of {formatNumber(stats.recipients)}
							</span>
							<span>{Math.round(progress * 100)}%</span>
						</div>
						<div className="h-1.5 overflow-hidden rounded-full bg-muted">
							<div
								className="h-full rounded-full bg-foreground transition-[width] duration-500"
								style={{ width: `${progress * 100}%` }}
							/>
						</div>
					</div>
				)}
				{(isInSteps || gmailLater || isSpread) && (
					<NoticeWarmup
						sections={[
							isInSteps && {
								title: `New contacts get it in steps: ${step} of ${stepSizes.length}`,
								progress: { value: step, max: stepSizes.length, label: "Steps" },
								steps: getStepItems(stepSizes, { step, nextAt: firstSend.checkAt }),
								why: STEPS_WHY,
								help: { article: "sending", section: "first-send" },
							},
							gmailLater && {
								title: "Some Gmail readers get it tomorrow",
								tracks: [gmailLater],
								why: GMAIL_WHY,
								help: { article: "warm-up", section: "new-domain" },
							},
							isSpread && !gmailLater && { title: `Going out gradually: ${formatTimeLeft(hoursUntil(campaign.sendingUntil))} to go` },
						]}
						className="animate-enter"
					/>
				)}

				{children}

				{isWebOnly ? (
					!reviewCode && (
						<div style={{ "--stagger": 1 }} className="grid grid-cols-2 gap-3 animate-enter sm:grid-cols-3">
							<CardStat label="Page views" value={formatNumber(campaign.webViews ?? 0)} detail="Once per reader a day" />
							<CardStat label="Published" value={formatDate(campaign.sentAt ?? campaign.startedAt)} detail="No email went out" />
						</div>
					)
				) : (
					<EmailResults
						campaign={campaign}
						newsletter={newsletter}
						html={html}
						stats={stats}
						reached={reached}
						comparison={comparison}
						timeline={timeline}
						timeZone={timeZone}
						links={links}
						providers={providers}
						showComplaints={readOnly}
					/>
				)}

				{!readOnly && hasPage && (
					<div
						style={{ "--stagger": 6 }}
						className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-x-2 rounded-xl bg-card px-4 shadow-border transition-colors duration-150 animate-enter focus-within:bg-muted/40"
					>
						<span className="text-sm text-muted-foreground">URL</span>
						<InputCampaignSlug
							campaignId={id}
							initialSlug={campaign.archiveSlug}
							urlBase={getArchiveUrls(newsletter).absolutePost("")}
							isPublished
						/>
						<ButtonCopy value={getArchiveUrls(newsletter).absolutePost(campaign.archiveSlug)} label="Copy link" />
					</div>
				)}
			</div>
		</>
	);
}

// What the email did: delivery, opens and clicks against the newsletter's average, bounces and unsubscribes, opens over
// time, inboxes and links. Complaints are for an admin to act on: the owner, who can't, sees them by inbox.
function EmailResults({ campaign, newsletter, html, stats, reached, comparison, timeline, timeZone, links, providers, showComplaints }) {
	const cards = [
		{ label: "Delivered", value: formatRate(stats.delivered, stats.sent), detail: formatNumber(stats.delivered) },
		{ label: "Opened", value: formatRate(stats.opened, reached), detail: formatNumber(stats.opened), change: toChange(comparison, "opened") },
		{ label: "Clicked", value: formatRate(stats.clicked, reached), detail: formatNumber(stats.clicked), change: toChange(comparison, "clicked") },
		{
			label: "Bounced",
			value: formatQuietRate(stats.bounced, stats.sent, 2),
			detail: formatNumber(stats.bounced),
			tone: rateTone(stats.bounced, stats.sent, LIMITS.pause.bounceRate),
		},
		showComplaints && {
			label: "Complaints",
			value: formatQuietRate(stats.complained, stats.sent, 3),
			detail: formatNumber(stats.complained),
			tone: rateTone(stats.complained, stats.sent, LIMITS.pause.complaintRate),
		},
		{ label: "Unsubscribed", value: formatQuietRate(stats.unsubscribed, reached, 2), detail: formatNumber(stats.unsubscribed) },
	].filter(Boolean);
	const isRow = cards.length === 5;

	return (
		<>
			<div style={{ "--stagger": 1 }} className={cn("grid grid-cols-2 gap-3 animate-enter", isRow ? "lg:grid-cols-5" : "sm:grid-cols-3")}>
				{cards.map((card, index) => (
					<CardStat key={card.label} {...card} className={isRow && index === 0 ? "max-lg:col-span-2" : undefined} />
				))}
			</div>

			{timeline && reached > 0 && <CardOpens style={{ "--stagger": 3 }} timeline={timeline} timeZone={timeZone} />}

			{providers.length > 0 && <TableProviders style={{ "--stagger": 4 }} providers={providers} />}

			{links?.links.length > 0 && (
				<TableCampaignLinks style={{ "--stagger": 5 }} stats={links} html={html} webUrl={getIssueWebUrl({ campaign, newsletter })} />
			)}
		</>
	);
}

// Opens and clicks hour by hour after sending, with when most came and how fast half of the opens did.
function CardOpens({ timeline, timeZone, style }) {
	const peak = findPeak(timeline.hours);
	const half = hoursToHalf(timeline);
	const summary = [
		peak !== null && `Peak ${formatWeekdayHour(timeline.hours[peak].at, timeZone)}`,
		half !== null && `half of opens in ${half === 1 ? "the first hour" : formatSpan(half)}`,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<section style={style} className="flex flex-col gap-5 rounded-xl bg-card p-5 shadow-border animate-enter sm:p-6">
			<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
				<div className="flex flex-col gap-1">
					<h2 className="text-sm font-medium text-muted-foreground">After sending</h2>
					{summary && <p className="text-sm text-pretty tabular-nums">{summary}</p>}
				</div>
				<ListLegend
					items={[{ swatch: "ghost", label: "Opens" }, { swatch: "bar", label: "Clicks" }, { label: timeZoneLabel(timeZone) }]}
				/>
			</div>
			<ChartOpens timeline={timeline} timeZone={timeZone} />
			{timeline.later.opens > 0 && (
				<p className="text-xs text-muted-foreground tabular-nums">
					{formatCount(timeline.later.opens, "open")} came after {formatSpan(TIMELINE_HOURS)}.
				</p>
			)}
		</section>
	);
}

// Results by inbox provider, each with its share of the send.
function TableProviders({ providers, style }) {
	const total = providers.reduce((sum, { sent }) => sum + sent, 0);

	return (
		<div style={style} className="overflow-hidden rounded-xl shadow-border animate-enter">
			<Table>
				<TableHeader>
					<TableRow className="hover:bg-transparent">
						<TableHead className="pl-4">Inbox</TableHead>
						<TableHead className="text-right">Share</TableHead>
						<TableHead className="text-right">Delivered</TableHead>
						<TableHead className="text-right max-sm:pr-4">Opened</TableHead>
						<TableHead className="hidden text-right sm:table-cell">Clicked</TableHead>
						<TableHead className="hidden text-right sm:table-cell">Bounced</TableHead>
						<TableHead className="hidden pr-4 text-right sm:table-cell">Complaints</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{providers.map((row) => (
						<TableRow key={row.provider} className="tabular-nums">
							<TableCell className="pl-4">
								<span className="flex items-center gap-2.5">
									{PROVIDER_DOMAINS[row.provider] ? (
										<ImageFavicon domain={PROVIDER_DOMAINS[row.provider]} size={16} />
									) : (
										<Globe className="size-4 shrink-0 text-muted-foreground" />
									)}
									<span className="flex min-w-0 flex-col">
										<span className="truncate font-medium">{PROVIDER_LABELS[row.provider] || PROVIDER_LABELS.other}</span>
										<span className="text-xs text-muted-foreground">{formatNumber(row.sent)} sent</span>
									</span>
								</span>
							</TableCell>
							<TableCell>
								<span className="flex items-center justify-end gap-2.5">
									<span aria-hidden="true" className="hidden h-1 w-10 overflow-hidden rounded-full bg-muted sm:block">
										<span className="block h-full rounded-full bg-foreground/70" style={{ width: `${(row.sent / total) * 100}%` }} />
									</span>
									<span className="w-9 text-right">{formatRate(row.sent, total, 0)}</span>
								</span>
							</TableCell>
							<TableCell className="text-right">{formatRate(row.delivered, row.sent) ?? <TextEmpty />}</TableCell>
							<TableCell className="text-right max-sm:pr-4">{formatRate(row.opened, row.delivered) ?? <TextEmpty />}</TableCell>
							<TableCell className="hidden text-right sm:table-cell">{formatRate(row.clicked, row.delivered) ?? <TextEmpty />}</TableCell>
							<TableCell className="hidden text-right sm:table-cell">{formatQuietRate(row.bounced, row.sent, 2) ?? <TextEmpty />}</TableCell>
							<TableCell className="hidden pr-4 text-right sm:table-cell">
								{formatQuietRate(row.complained, row.sent, 3) ?? <TextEmpty />}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

function TextPauseReason({ reason, code, canUpgrade }) {
	if (REVIEW_CODES.has(code)) {
		return (
			<p className="rounded-xl bg-muted/60 px-4 py-3 text-sm text-pretty animate-enter">
				{reason} <LinkHelp article="sending" section="content-check" />
			</p>
		);
	}
	return (
		<p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-amber-500/10 px-4 py-3 text-sm animate-enter">
			<span className="text-pretty">Paused: {reason}</span>
			{canUpgrade && isPlanLimitCode(code) && (
				<Link href="/billing" className="font-medium underline underline-offset-4">
					Upgrade
				</Link>
			)}
		</p>
	);
}

// "+4.2% vs avg" against the newsletter's earlier issues, with their average in the title; none while the send's own
// opens still come in.
function toChange(comparison, key) {
	if (!comparison?.isSettled) return null;
	const text = formatRateChange(comparison.delta[key]);
	if (!text) return null;
	return {
		text,
		note: "vs avg",
		isUp: text.startsWith("+"),
		title: `Your last ${formatCount(comparison.issues, "issue")} averaged ${(comparison.average[key] * 100).toFixed(1)}%`,
	};
}

// A rate with its decimals, or "0%" when nothing happened, so a quiet row stays quiet.
function formatQuietRate(part, total, digits) {
	return part === 0 && total ? "0%" : formatRate(part, total, digits);
}

// "12 h", "3 days"
function formatSpan(hours) {
	if (hours < 48) return `${hours} h`;
	return `${Math.round(hours / 24)} days`;
}

// Whole hours left, at least one: the last batch's time is approximate.
function hoursUntil(date) {
	return Math.max(1, Math.ceil((new Date(date).getTime() - Date.now()) / 3_600_000));
}

function formatTimeLeft(hours) {
	return hours >= 48 ? formatPaceTime(hours) : `about ${formatCount(hours, "hour")}`;
}