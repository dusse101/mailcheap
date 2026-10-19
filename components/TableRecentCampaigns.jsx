import BadgeStatus from "@/components/BadgeStatus";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LIMITS } from "@/lib/config";
import { formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

// Customers' newest campaigns (lib/admin-stats.js listRecentCampaigns). The numbers are the issue's, and turn red past
// the rates that pause a send.
export default function TableRecentCampaigns({ campaigns }) {
	if (campaigns.length === 0) {
		return <p className="rounded-xl bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-border">No campaigns yet</p>;
	}

	return (
		<div className="overflow-hidden rounded-xl bg-card shadow-border">
			<Table>
				<TableHeader>
					<TableRow className="hover:bg-transparent">
						<TableHead className="pl-4">Campaign</TableHead>
						<TableHead className="hidden sm:table-cell">Status</TableHead>
						<TableHead className="hidden text-right md:table-cell">Sent to</TableHead>
						<TableHead className="hidden text-right lg:table-cell">Delivered</TableHead>
						<TableHead className="hidden text-right md:table-cell">Bounced</TableHead>
						<TableHead className="pr-4 text-right">Spam</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{campaigns.map((campaign) => (
						<TableRow key={campaign.id} className="tabular-nums">
							<TableCell className="max-w-0 py-2.5 pl-4 sm:w-1/2">
								<span className="block truncate font-medium">{campaign.subject || "Untitled"}</span>
								<span className="block truncate text-xs text-muted-foreground">
									{campaign.ownerEmail ?? "Unknown owner"}
									{campaign.at && ` · ${formatDate(campaign.at)}`}
								</span>
							</TableCell>
							<TableCell className="hidden sm:table-cell">
								<BadgeStatus status={campaign.status} />
							</TableCell>
							<TableCell className="hidden text-right md:table-cell">{formatNumber(campaign.recipients)}</TableCell>
							<TableCell className="hidden text-right lg:table-cell">{formatNumber(campaign.delivered)}</TableCell>
							<TableCell className={cn("hidden text-right md:table-cell", isOver(campaign.bounced, campaign.recipients, LIMITS.pause.bounceRate) && RED)}>
								{formatNumber(campaign.bounced)}
							</TableCell>
							<TableCell className={cn("pr-4 text-right", isOver(campaign.complained, campaign.recipients, LIMITS.pause.complaintRate) && RED)}>
								{formatNumber(campaign.complained)}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

function isOver(count, recipients, rate) {
	return recipients > 0 && count / recipients > rate;
}

const RED = "text-red-600 dark:text-red-400";
