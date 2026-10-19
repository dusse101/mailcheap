"use client";

import { useRef, useState, useTransition } from "react";
import { CalendarClock, ListFilter, Loader2, Plus, Send, X } from "lucide-react";
import { setCampaignSegment } from "@/app/(app)/campaigns/actions";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import CardSettings from "@/components/CardSettings";
import DialogSegment from "@/components/DialogSegment";
import InputCampaignSlug from "@/components/InputCampaignSlug";
import ListCleanupPreview from "@/components/ListCleanupPreview";
import NoticeFirstSend from "@/components/NoticeFirstSend";
import NoticeWarmup from "@/components/NoticeWarmup";
import PickerSendTime from "@/components/PickerSendTime";
import RowCampaign from "@/components/RowCampaign";
import TextPlanLimit from "@/components/TextPlanLimit";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FIRST_SEND } from "@/lib/config";
import { formatCount, formatNumber, formatSendTime } from "@/lib/format";
import { getPaceHours } from "@/lib/send-spread";
import { slugify } from "@/lib/slug";
import { toast } from "@/lib/toast";
import { useIsClient } from "@/lib/use-is-client";
import { cn } from "@/lib/utils";

// The send step: who gets the issue, everyone unless a segment or a filter narrows it, then now or at a time, and how
// fast it goes out. Its button is in the editor's bar, and lib/use-send-campaign.js holds what it does. audienceCount:
// the segment's active contacts, or everyone's (everyoneCount).
export default function PanelSend({
	sending,
	campaign,
	newsletter,
	subject,
	audienceCount,
	everyoneCount,
	segments,
	isSegmentDeleted,
	emailsLeft,
	pace,
	newContacts,
	archiveUrlBase,
}) {
	const isClient = useIsClient();
	const [isFiltered, setIsFiltered] = useState(Boolean(sending.limit));
	const [segmentId, setSegmentId] = useState(campaign.segmentId ?? null);
	const [isCreatingSegment, setIsCreatingSegment] = useState(false);
	const [isChangingSegment, startChangingSegment] = useTransition();
	const filterInputRef = useRef(null);
	const isFilterNewRef = useRef(false);
	const isOpeningDialogRef = useRef(false);
	const segment = segments.find(({ id }) => id === segmentId) ?? null;
	const scheduledAt = campaign.status === "scheduled" ? campaign.scheduledAt : null;
	// The browser's time zone, which the server doesn't know.
	const scheduledTime = scheduledAt && isClient ? formatSendTime(scheduledAt) : null;
	const isNow = sending.choice === "now";
	// As the send and schedule dialogs counted them: a send with its last-chance emails, a schedule its contacts.
	const paceEmails = isNow ? sending.sendEmails : sending.scheduleRecipients;
	const isPaced = Boolean(pace?.warmup) || getPaceHours(pace, { emails: paceEmails, newContacts }) > 0;
	const hasFirstSlice = newContacts > FIRST_SEND.minSlice;
	const isCleanupEnabled = Boolean(newsletter.cleanup?.enabled);
	const isOverPlan = isNow && emailsLeft !== null && sending.sendEmails > emailsLeft;
	const from = newsletter.fromName ? `${newsletter.fromName} <${newsletter.fromEmail}>` : newsletter.fromEmail;
	const recipients = sending.scheduleRecipients;

	function toggleFilter(isOn) {
		setIsFiltered(isOn);
		isFilterNewRef.current = isOn;
		sending.setLimit(isOn ? String(getStartingLimit(audienceCount)) : "");
	}

	// Saved right away: the page counts the new audience, and the list cleanup's preview reads it again.
	function changeSegment(id) {
		const previous = segmentId;
		setSegmentId(id);
		startChangingSegment(async () => {
			const result = await setCampaignSegment(campaign._id, id);
			if (result?.error) {
				setSegmentId(previous);
				return void toast.error(result.error);
			}
			sending.prepare();
		});
	}

	function createSegment() {
		isOpeningDialogRef.current = true;
		setIsCreatingSegment(true);
	}

	// A filter just added takes the focus the menu would give back to its button, and a dialog opening keeps it.
	function moveMenuFocus(event) {
		if (isOpeningDialogRef.current) {
			isOpeningDialogRef.current = false;
			return event.preventDefault();
		}
		if (!isFilterNewRef.current) return;
		isFilterNewRef.current = false;
		event.preventDefault();
		filterInputRef.current?.focus();
	}

	return (
		<div className="flex flex-col gap-6">
			<CardSettings
				title="Who gets it"
				action={
					<MenuFilter
						segments={segments}
						segmentId={segmentId}
						onSegmentChange={changeSegment}
						onNewSegment={createSegment}
						isFiltered={isFiltered}
						onToggle={toggleFilter}
						onCloseAutoFocus={moveMenuFocus}
					/>
				}
			>
				<RowCampaign label="From">
					<span className="truncate text-sm">{from}</span>
				</RowCampaign>
				<RowCampaign label="To">
					<span className="flex min-w-0 items-center gap-2 text-sm">
						<AvatarNewsletter newsletter={newsletter} size={18} />
						<span className="truncate">{newsletter.name}</span>
						<span
							className={cn(
								"ml-auto shrink-0 text-muted-foreground tabular-nums transition-opacity duration-150",
								isChangingSegment && "opacity-40"
							)}
						>
							{recipients < everyoneCount
								? `${formatNumber(recipients)} of ${formatCount(everyoneCount, "contact")}`
								: `All ${formatCount(everyoneCount, "contact")}`}
						</span>
					</span>
				</RowCampaign>
				{segmentId && (
					<RowCampaign label="Segment">
						<span className="flex min-w-0 items-center gap-2 text-sm animate-enter">
							{segment ? (
								<>
									<span className="shrink-0 font-medium">{segment.name}</span>
									<span className="truncate text-muted-foreground">{segment.description}</span>
								</>
							) : isSegmentDeleted && segmentId === campaign.segmentId ? (
								<span className="truncate text-destructive">Deleted, pick another</span>
							) : (
								<Loader2 aria-hidden="true" className="size-4 animate-spin text-muted-foreground" />
							)}
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Send to everyone"
								onClick={() => changeSegment(null)}
								disabled={isChangingSegment}
								className="ml-auto text-muted-foreground"
							>
								<X />
							</Button>
						</span>
					</RowCampaign>
				)}
				{isFiltered && (
					<RowCampaign label="Filter">
						<span className="flex min-w-0 items-center gap-2 text-sm">
							<input
								ref={filterInputRef}
								type="number"
								min={1}
								inputMode="numeric"
								value={sending.limit}
								onChange={(event) => sending.setLimit(event.target.value)}
								onFocus={(event) => event.target.select()}
								aria-label="How many of the most engaged contacts"
								className="h-8 w-20 shrink-0 rounded-md bg-muted px-2.5 tabular-nums outline-none transition-shadow duration-150 focus-visible:ring-3 focus-visible:ring-ring/50"
							/>
							<span className="truncate text-muted-foreground">most engaged contacts</span>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Remove the filter"
								onClick={() => toggleFilter(false)}
								className="ml-auto text-muted-foreground"
							>
								<X />
							</Button>
						</span>
					</RowCampaign>
				)}
				{archiveUrlBase && (
					<RowCampaign label="Web page">
						<InputCampaignSlug
							campaignId={campaign._id}
							initialSlug={campaign.archiveSlug ?? ""}
							placeholder={slugify(subject, 80) || "issue"}
							urlBase={archiveUrlBase}
						/>
					</RowCampaign>
				)}
				{isCleanupEnabled &&
					(isNow ? (
						<div className="p-3">
							<ListCleanupPreview summary={sending.summary} isCounting={sending.isCounting} error={sending.preview?.error} />
						</div>
					) : (
						<p className="px-4 py-3 text-sm text-pretty text-muted-foreground">
							The list cleanup runs when it goes out, so cold contacts get the last-chance email instead.
						</p>
					))}
			</CardSettings>

			<CardSettings title="When" stagger={1}>
				<div className="flex flex-col gap-4 p-3">
					<div role="radiogroup" aria-label="When" className="grid gap-2 sm:grid-cols-2">
						<CardChoice
							icon={Send}
							title="Send now"
							description={scheduledTime ? `Instead of ${scheduledTime}` : "Goes out right away"}
							isSelected={isNow}
							onSelect={() => sending.setChoice("now")}
						/>
						<CardChoice
							icon={CalendarClock}
							title="Schedule"
							description={scheduledTime ? `Scheduled for ${scheduledTime}` : "Pick a day and time"}
							isSelected={!isNow}
							onSelect={() => sending.setChoice("later")}
						/>
					</div>
					{!isNow && sending.sendAt && (
						<div className="flex flex-col gap-4 px-1 pt-1 animate-enter">
							<PickerSendTime value={sending.sendAt} onChange={sending.setSendAt} />
							<div className="flex min-h-10 items-center justify-between gap-3 rounded-lg bg-muted/60 py-1 pr-1 pl-3">
								<TextSendTime value={sending.sendAt} isLastIssueTime={sending.isLastIssueTime} />
								{scheduledAt && (
									<Button variant="ghost" size="sm" onClick={sending.unschedule} disabled={sending.isPending}>
										Unschedule
									</Button>
								)}
							</div>
						</div>
					)}
					{(isPaced || hasFirstSlice) && (
						<div className="flex flex-col gap-2">
							<NoticeWarmup pace={pace} emails={paceEmails} newContacts={newContacts} />
							{hasFirstSlice && <NoticeFirstSend count={newContacts} />}
						</div>
					)}
				</div>
			</CardSettings>

			{isOverPlan && <TextPlanLimit emailsLeft={emailsLeft} />}

			<DialogSegment
				newsletterId={newsletter._id}
				open={isCreatingSegment}
				onOpenChange={setIsCreatingSegment}
				onSaved={changeSegment}
			/>

			<Dialog open={sending.isConfirmOpen} onOpenChange={sending.setIsConfirmOpen}>
				<DialogContent className="sm:max-w-sm">
					<DialogHeader>
						<DialogTitle className="tabular-nums">Send to {formatCount(sending.sendRecipients, "contact")}?</DialogTitle>
						<DialogDescription>
							{scheduledTime ? `It goes out now instead of ${scheduledTime}.` : "Most engaged contacts receive it first."}
							{sending.sendRecipients < sending.issueAudience && " Send it to more later from its page."}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button variant="outline">Cancel</Button>
						</DialogClose>
						<Button onClick={sending.send} disabled={sending.isPending} className="min-w-20">
							{sending.isPending ? <Loader2 className="animate-spin" /> : "Send"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

// A segment and filters narrow a send that goes to everyone otherwise. The most engaged go first, and the rest can get
// it later from the campaign's page.
function MenuFilter({ segments, segmentId, onSegmentChange, onNewSegment, isFiltered, onToggle, onCloseAutoFocus }) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="sm" className="-mr-1.5 text-muted-foreground">
					<ListFilter data-icon="inline-start" />
					Filter
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" onCloseAutoFocus={onCloseAutoFocus} className="w-64">
				<DropdownMenuLabel className="text-xs text-muted-foreground">Segment</DropdownMenuLabel>
				<DropdownMenuRadioGroup value={segmentId ?? EVERYONE} onValueChange={(value) => onSegmentChange(value === EVERYONE ? null : value)}>
					<DropdownMenuRadioItem value={EVERYONE}>Everyone</DropdownMenuRadioItem>
					{segments.map(({ id, name, description }) => (
						<DropdownMenuRadioItem key={id} value={id} className="items-start py-2">
							<span className="flex min-w-0 flex-col gap-0.5">
								<span className="truncate">{name}</span>
								<span className="line-clamp-2 text-xs text-pretty text-muted-foreground">{description}</span>
							</span>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				<DropdownMenuItem onSelect={onNewSegment} className="text-muted-foreground">
					<Plus />
					New segment
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuCheckboxItem checked={isFiltered} onCheckedChange={onToggle} className="items-start py-2">
					<span className="flex flex-col gap-0.5">
						<span>Most engaged contacts</span>
						<span className="text-xs text-pretty text-muted-foreground">Only some of them, by opens and clicks. The rest can get it later.</span>
					</span>
				</DropdownMenuCheckboxItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function CardChoice({ icon: Icon, title, description, isSelected, onSelect }) {
	return (
		<button
			type="button"
			role="radio"
			aria-checked={isSelected}
			onClick={onSelect}
			className={cn(
				"flex items-start gap-3 rounded-lg p-3 text-left outline-none transition-[background-color,box-shadow,scale] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99]",
				isSelected ? "bg-muted/60 shadow-[inset_0_0_0_1.5px_var(--foreground)]" : "shadow-border hover:bg-muted/60"
			)}
		>
			<span
				aria-hidden="true"
				className={cn(
					"mt-0.5 grid size-4 shrink-0 place-items-center rounded-full transition-colors duration-150",
					isSelected ? "bg-foreground" : "shadow-border"
				)}
			>
				{isSelected && <span className="size-1.5 rounded-full bg-background" />}
			</span>
			<span className="min-w-0">
				<span className="flex items-center gap-1.5 text-sm font-medium">
					<Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
					{title}
				</span>
				<span className="block text-sm text-pretty text-muted-foreground tabular-nums">{description}</span>
			</span>
		</button>
	);
}

function TextSendTime({ value, isLastIssueTime }) {
	const zone = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
		.formatToParts(value)
		.find(({ type }) => type === "timeZoneName")?.value;

	return (
		<p className="text-sm text-pretty tabular-nums">
			<span className="text-muted-foreground">Goes out </span>
			<span className="font-medium">{formatSendTime(value)}</span> <span className="text-muted-foreground">{zone}</span>
			{isLastIssueTime && <span className="text-muted-foreground"> · Same time as your last issue</span>}
		</p>
	);
}

const EVERYONE = "everyone";

// Half the list, to 2 significant digits.
function getStartingLimit(audienceCount) {
	const half = Math.max(1, Math.round(audienceCount / 2));
	if (half < 100) return half;
	const step = 10 ** (Math.floor(Math.log10(half)) - 1);
	return Math.round(half / step) * step;
}
