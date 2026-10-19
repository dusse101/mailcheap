import { CircleAlert, CircleCheck, CircleX } from "lucide-react";
import CardSettings from "@/components/CardSettings";
import { cn } from "@/lib/utils";

// The review step's checks (lib/presend-checks.js): the ones to fix, then the ones to check, each with its fix, then
// the ones that pass. Each group reads as one block, so lines only fall between groups.
export default function ListChecks({ checks, renderFix }) {
	const toFix = checks.filter(({ isOk, isWarning }) => !isOk && !isWarning);
	const toCheck = checks.filter(({ isOk, isWarning }) => !isOk && isWarning);
	const passed = checks.filter(({ isOk }) => isOk);

	return (
		<CardSettings title="Checklist">
			{toFix.length > 0 && <ListProblems checks={toFix} label="To fix" renderFix={renderFix} />}
			{toCheck.length > 0 && <ListProblems checks={toCheck} label="To check" isWarning renderFix={renderFix} />}
			{passed.length > 0 && (
				<ul aria-label="Passed" className="grid gap-x-6 gap-y-2.5 px-4 py-3.5 sm:grid-cols-2">
					{passed.map(({ id, label, detail }) => (
						<li key={id} className="flex min-w-0 items-center gap-2 text-sm">
							<CircleCheck aria-hidden="true" className="size-4 shrink-0 text-emerald-500" />
							<span className="truncate text-muted-foreground">{label}</span>
							{detail && <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{detail}</span>}
						</li>
					))}
				</ul>
			)}
		</CardSettings>
	);
}

function ListProblems({ checks, label, isWarning = false, renderFix }) {
	const Icon = isWarning ? CircleAlert : CircleX;

	return (
		<ul aria-label={label} className="py-1.5">
			{checks.map((check) => {
				const description = check.message ?? check.fix?.hint;
				return (
					<li key={check.id} className="flex items-center gap-3 px-4 py-2.5">
						<Icon aria-hidden="true" className={cn("size-4 shrink-0", isWarning ? "text-amber-500" : "text-red-500")} />
						<div className="min-w-0 flex-1">
							<p className="text-sm font-medium">
								{check.label}
								{check.detail && <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">{check.detail}</span>}
							</p>
							{description && <p className="text-sm text-pretty text-muted-foreground">{description}</p>}
						</div>
						{renderFix(check)}
					</li>
				);
			})}
		</ul>
	);
}
