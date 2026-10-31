import ImageFavicon from "@/components/ImageFavicon";
import LinkHelp from "@/components/LinkHelp";
import ProgressWarmup from "@/components/ProgressWarmup";
import { cn } from "@/lib/utils";

// Every place the dashboard says a send goes slower than at once, in one card: a section for each reason (lib/
// warmup-status.js), like a first send's steps and a new domain's Gmail readers, each with what happens, its steps
// (done, current, next) and a bar of them once it's going out (progress), how Gmail's readers are held back (tracks),
// and why, with a link to read more.
export default function NoticeWarmup({ sections, className }) {
	return (
		<div className={cn("flex flex-col rounded-xl bg-muted/60 text-sm", className)}>
			{sections.filter(Boolean).map((section, index) => (
				<SectionPace key={section.title} section={section} isFirst={index === 0} />
			))}
		</div>
	);
}

function SectionPace({ section, isFirst }) {
	const { title, progress, steps = [], tracks = [], why, help, children } = section;
	return (
		<div className={cn("flex flex-col gap-3 p-3.5", !isFirst && "border-t border-border/60")}>
			<p className="font-medium text-balance">{title}</p>
			{progress && <ProgressWarmup value={progress.value} max={progress.max} isStepped label={progress.label} />}
			{steps.length > 0 && (
				<ol className="flex flex-col gap-1.5">
					{steps.map((step, index) => (
						<li key={step.text} className="flex gap-2 text-pretty tabular-nums">
							<span
								className={cn(
									"grid size-5 shrink-0 place-items-center rounded-full text-xs font-medium",
									step.state === "done" && "bg-foreground text-background",
									step.state === "current" && "bg-background text-foreground ring-1 ring-foreground ring-inset",
									step.state === "next" && "bg-foreground/10 text-muted-foreground"
								)}
							>
								{index + 1}
							</span>
							<span className={step.state === "current" ? undefined : "text-muted-foreground"}>{step.text}</span>
						</li>
					))}
				</ol>
			)}
			{tracks.map((track) => (
				<TrackPace key={track.label} track={track} />
			))}
			{why && (
				<p className="text-xs text-pretty text-muted-foreground">
					{why} {help && <LinkHelp article={help.article} section={help.section} />}
				</p>
			)}
			{children}
		</div>
	);
}

function TrackPace({ track }) {
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center justify-between gap-3 text-xs">
				<span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
					{track.domain && <ImageFavicon domain={track.domain} size={14} />}
					<span className="truncate">{track.label}</span>
				</span>
				<span className="shrink-0 font-medium tabular-nums">{track.day ? `Day ${track.day} of ${track.days}` : `${track.days} days`}</span>
			</div>
			<ProgressWarmup
				value={track.day}
				max={track.days}
				progress={track.progress}
				isStepped={track.isStepped}
				label={`${track.label}: Gmail's days`}
			/>
			<p className="text-pretty tabular-nums">
				{track.now}
				{track.next && <span className="text-muted-foreground"> Next: {track.next}</span>}
			</p>
		</div>
	);
}
