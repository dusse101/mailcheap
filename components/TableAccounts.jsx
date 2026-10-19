import BadgeStatus from "@/components/BadgeStatus";
import IconWarmup from "@/components/IconWarmup";
import MenuAccount from "@/components/MenuAccount";
import TextEmpty from "@/components/TextEmpty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { describeBlocker, getAccountStatus, isBlocked } from "@/lib/account-state";
import { LIMITS, isCloud } from "@/lib/config";
import { formatCompact, formatDate, formatNumber } from "@/lib/format";
import { getAccountLimits, getAccountPlan, getPlan, hasActiveFreePlan, isOnFreePlan } from "@/lib/plans";
import { getWarmup } from "@/lib/send-spread";
import { cn } from "@/lib/utils";

// A box that scrolls under its header, so a long list stays short on the page.
export default function TableAccounts({ accounts, pinnedId }) {
	const hasPlans = isCloud();
	return (
		<div className="overflow-hidden rounded-xl bg-card shadow-border [&_[data-slot=table-container]]:max-h-[min(30rem,70dvh)] [&_[data-slot=table-container]]:overflow-y-auto [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card [&_th]:shadow-[inset_0_-1px_0_var(--border)]">
			<Table>
				<TableHeader>
					<TableRow className="hover:bg-transparent">
						<TableHead className="pl-4">Owner</TableHead>
						{hasPlans && <TableHead>Plan</TableHead>}
						<TableHead>Status</TableHead>
						<TableHead className="hidden text-right md:table-cell">Emails this month</TableHead>
						<TableHead className="hidden text-right md:table-cell">Subscribers</TableHead>
						<TableHead className="hidden text-right lg:table-cell">Last 7 days</TableHead>
						<TableHead className="hidden text-right sm:table-cell">Created</TableHead>
						<TableHead className="w-12 pr-2" />
					</TableRow>
				</TableHeader>
				<TableBody>
					{accounts.map((account) => {
						const plan = getAccountPlan(account);
						const freePlan = hasActiveFreePlan(account) ? { plan: account.comp.plan, until: account.comp.until ?? null } : null;
						const limits = getAccountLimits(account);
						const hasOverrides = Object.values(account.limitOverrides ?? {}).some((value) => value !== undefined && value !== null);
						const isSpreading = getWarmup(account) !== null;
						const blockedBy = isBlocked(account) ? `Blocked by ${describeBlocker(account.pausedBy)}` : null;
						return (
							<TableRow key={account._id} data-state={account._id === pinnedId ? "selected" : undefined} className="tabular-nums">
								<TableCell className="max-w-0 py-2.5 pl-4 sm:w-1/4">
									<span className="block truncate font-medium">{account.ownerEmail ?? <TextEmpty />}</span>
									{blockedBy && (
										<span className="block truncate text-xs text-red-600 dark:text-red-400" title={account.pauseReason}>
											{blockedBy}
											{account.pauseReason && `: ${account.pauseReason}`}
										</span>
									)}
									{isSpreading && (
										<span className="flex items-center gap-1 text-xs text-muted-foreground">
											<IconWarmup className="size-3" />
											<span className="truncate">
												{account.spreadUntil ? `Warming up until ${formatDate(account.spreadUntil)}` : "Warms up from the first campaign"}
											</span>
										</span>
									)}
								</TableCell>
								{hasPlans && (
									<TableCell className="whitespace-nowrap">
										<PlanName account={account} plan={plan} freePlan={freePlan} />
									</TableCell>
								)}
								<TableCell>
									<BadgeStatus status={getAccountStatus(account)} />
								</TableCell>
								<TableCell className="hidden text-right md:table-cell">
									<Usage used={account.usage?.emailsSent ?? 0} limit={limits?.emails} isCustom={hasOverrides} />
								</TableCell>
								<TableCell className="hidden text-right md:table-cell">
									<Usage used={account.activeContacts} limit={limits?.subscribers} isCustom={hasOverrides} />
								</TableCell>
								<TableCell className="hidden text-right lg:table-cell">
									<Health health={account.health} />
								</TableCell>
								<TableCell className="hidden text-right text-muted-foreground sm:table-cell">
									{formatDate(account.createdAt)}
								</TableCell>
								<TableCell className="pr-2 text-right">
									<MenuAccount
										accountId={account._id}
										email={account.ownerEmail}
										blockedBy={blockedBy}
										blockReason={account.pauseReason ?? null}
										hasLimits={hasPlans}
										canSpread={hasPlans}
										isSpreading={isSpreading}
										canGiveFreePlan={hasPlans}
										freePlan={freePlan}
										overrides={account.limitOverrides ?? {}}
										planLimits={plan ? { emailsPerMonth: plan.emailsPerMonth, subscribers: plan.subscribers } : null}
									/>
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
		</div>
	);
}

// "Free · Scale" for a free plan from an admin, with its end. A free plan behind a paid one shows under it.
function PlanName({ account, plan, freePlan }) {
	if (!plan) return <TextEmpty />;
	const until = freePlan?.until ? formatDate(freePlan.until) : null;
	if (isOnFreePlan(account)) {
		return (
			<>
				<span className="block">Free · {plan.name}</span>
				{until && <span className="block text-xs text-muted-foreground">Until {until}</span>}
			</>
		);
	}
	return (
		<>
			<span className="block">
				{plan.name} · {account.interval === "year" ? "yearly" : "monthly"}
			</span>
			{freePlan && (
				<span className="block text-xs text-muted-foreground">
					Free {getPlan(freePlan.plan).name} too{until && `, until ${until}`}
				</span>
			)}
		</>
	);
}

// Bounce and complaint rates from the last account check (lib/account-health.js).
function Health({ health }) {
	if (!health?.sent) return <TextEmpty />;
	return (
		<span className="text-xs">
			<Rate value={health.bounceRate} limit={LIMITS.pause.bounceRate} /> bounces ·{" "}
			<Rate value={health.complaintRate} limit={LIMITS.pause.complaintRate} digits={3} /> complaints
		</span>
	);
}

function Rate({ value = 0, limit, digits = 2 }) {
	return <span className={cn(value > limit && "text-red-600 dark:text-red-400")}>{(value * 100).toFixed(digits)}%</span>;
}

// Without a limit (self-hosted), the count alone.
function Usage({ used, limit, isCustom }) {
	if (limit === undefined) return formatNumber(used);
	return (
		<span className={cn(used > limit && "text-red-600 dark:text-red-400")}>
			{formatNumber(used)}
			<span className="text-muted-foreground">
				{" "}
				/ {formatCompact(limit)}
				{isCustom && "*"}
			</span>
		</span>
	);
}
