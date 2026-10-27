import { Lightbulb } from "lucide-react";
import CardSettings from "@/components/CardSettings";
import LinkHelp from "@/components/LinkHelp";

// The content check's tips for the issue as it is (lib/content-review.js), in the review step: words that tend to land
// email in spam, highlighted, each with what to change and its fix. Only there when there are some.
export default function CardTips({ tips, renderFix, stagger = 0 }) {
	return (
		<CardSettings title="Tips for more opens" action={<LinkHelp article="sending" section="tips" className="text-xs" />} stagger={stagger}>
			<ListTips tips={tips} renderFix={renderFix} className="py-1.5" />
		</CardSettings>
	);
}

// The same rows in the send step's dialog, when a send or a schedule stops for them.
export function ListTips({ tips, renderFix, className }) {
	return (
		<ul aria-label="Tips" className={className}>
			{tips.map((tip) => (
				<li key={`${tip.field}:${tip.quote}`} className="flex items-center gap-3 px-4 py-2.5">
					<Lightbulb aria-hidden="true" className="size-4 shrink-0 text-amber-500" />
					<div className="min-w-0 flex-1">
						<p className="text-sm font-medium break-words">
							<mark className="rounded-sm bg-amber-300/45 px-0.5 text-foreground [box-decoration-break:clone] dark:bg-amber-300/20">
								{tip.quote}
							</mark>
						</p>
						<p className="mt-0.5 text-sm text-pretty text-muted-foreground">{tip.tip}</p>
					</div>
					{renderFix(tip)}
				</li>
			))}
		</ul>
	);
}
