import Link from "next/link";
import { Ban, Bell, CircleCheck, CirclePause } from "lucide-react";
import { describeBlocker } from "@/lib/account-state";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

// What may need a look (lib/admin-stats.js listAttention): blocked accounts, customers' paused campaigns, then the alerts
// of the last 7 days, each newest first.
export default function ListAttention({ attention, now }) {
	const items = [
		...attention.blockedAccounts.map((account) => ({
			id: `account-${account.id}`,
			icon: Ban,
			tone: "text-red-500",
			title: account.ownerEmail ?? "Unknown owner",
			detail: `Blocked by ${describeBlocker(account.by)}${account.reason ? `: ${account.reason}` : ""}`,
			at: account.at,
			href: `/admin?account=${account.id}`,
		})),
		...attention.pausedCampaigns.map((campaign) => ({
			id: `campaign-${campaign.id}`,
			icon: CirclePause,
			tone: "text-amber-500",
			title: campaign.subject || "Untitled",
			detail: [campaign.ownerEmail, campaign.reason].filter(Boolean).join(" · "),
			at: campaign.at,
		})),
		...attention.alerts.map((alert) => ({
			id: `alert-${alert.id}`,
			icon: Bell,
			tone: "text-muted-foreground",
			title: alert.title,
			detail: alert.ownerEmail,
			at: alert.at,
		})),
	];

	if (items.length === 0) {
		return (
			<p className="flex items-center justify-center gap-2 rounded-xl bg-card px-4 py-8 text-sm text-muted-foreground shadow-border">
				<CircleCheck className="size-4 text-emerald-500" aria-hidden="true" />
				Nothing needs a look
			</p>
		);
	}

	return (
		<ul className="max-h-[26rem] overflow-y-auto rounded-xl bg-card py-1.5 shadow-border">
			{items.map(({ id, icon: Icon, tone, title, detail, at, href }) => {
				const content = (
					<>
						<Icon className={cn("mt-0.5 size-4 shrink-0", tone)} aria-hidden="true" />
						<span className="min-w-0 flex-1">
							<span className="block truncate text-sm font-medium">{title}</span>
							{detail && <span className="line-clamp-2 text-xs text-pretty text-muted-foreground">{detail}</span>}
						</span>
						{at && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatRelative(at, now)}</span>}
					</>
				);
				return (
					<li key={id}>
						{href ? (
							<Link href={href} className="flex items-start gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-muted/50">
								{content}
							</Link>
						) : (
							<div className="flex items-start gap-3 px-4 py-2.5">{content}</div>
						)}
					</li>
				);
			})}
		</ul>
	);
}
