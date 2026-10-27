"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { dismissAlertTypeAction, dismissAttentionAction, loadAttention } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber, formatRelative, formatSendTime } from "@/lib/format";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const KIND_LABELS = { alert: "Alert", account: "Blocked account", campaign: "Paused campaign" };

// An item of "Needs a look" in full (lib/admin-alerts.js): what happened and what MailCheap did, who was told, the
// account, newsletter and campaign it's about, and what happened around it. Loaded when it opens.
export default function DialogAttention({ item, open, onOpenChange, onDismissed }) {
	const [state, setState] = useState({ status: "loading" });
	const [isWorking, startWorking] = useTransition();

	useEffect(() => {
		let isCurrent = true;
		loadAttention(item.kind, item.id).then(
			(result) => isCurrent && setState(result?.details ? { status: "ready", details: result.details } : { status: "missing" }),
			() => isCurrent && setState({ status: "failed" })
		);
		return () => {
			isCurrent = false;
		};
	}, [item.kind, item.id]);

	function dismiss() {
		startWorking(async () => {
			const result = await dismissAttentionAction(item.kind, item.id).catch(() => ({ error: "Couldn't dismiss it" }));
			if (result?.error) return toast.error(result.error);
			onDismissed();
			onOpenChange(false);
		});
	}

	function dismissAllLikeThis() {
		startWorking(async () => {
			const result = await dismissAlertTypeAction(item.id).catch(() => ({ error: "Couldn't dismiss them" }));
			if (result?.error) return toast.error(result.error);
			toast.success(`Dismissed ${formatNumber(result.count)} alerts`);
			onDismissed();
			onOpenChange(false);
		});
	}

	const details = state.details;
	const dismissal = details?.dismissal?.isActive ? details.dismissal : null;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="gap-5 sm:max-w-lg">
				<DialogHeader className="pr-8">
					<DialogTitle className="leading-snug">{details?.title ?? item.title}</DialogTitle>
					<DialogDescription>{describeWhen(details ?? item)}</DialogDescription>
				</DialogHeader>

				{state.status === "loading" && <SkeletonDetails />}
				{state.status === "missing" && <p className="text-sm text-muted-foreground">It&apos;s gone: nothing to show anymore.</p>}
				{state.status === "failed" && <p className="text-sm text-muted-foreground">Couldn&apos;t load it. Close and try again.</p>}
				{details && <Details details={details} onNavigate={() => onOpenChange(false)} />}

				<DialogFooter className="items-center">
					{dismissal ? (
						<p className="mr-auto text-xs text-muted-foreground">
							Dismissed by {dismissal.by ?? "an admin"}, {formatRelative(dismissal.at)}
						</p>
					) : (
						<>
							{details?.sameType && (
								<Button variant="outline" onClick={dismissAllLikeThis} disabled={isWorking}>
									Dismiss all like this ({formatNumber(details.sameType.count + 1)})
								</Button>
							)}
							<Button onClick={dismiss} disabled={isWorking || state.status !== "ready"}>
								Dismiss
							</Button>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function describeWhen({ kind, at, count }) {
	return [KIND_LABELS[kind], at && formatRelative(at), count > 1 && `${formatNumber(count)} times in all`].filter(Boolean).join(" · ");
}

function Details({ details, onNavigate }) {
	const { what, action, done, hasDetails, told, account, newsletter, campaign, trail } = details;
	return (
		<div className="flex flex-col gap-5 text-sm">
			<Section title="What happened">
				<p className="text-pretty">{what ?? "No details were kept for it."}</p>
				{!hasDetails && <p className="text-xs text-muted-foreground">Alerts keep their details since Oct 20, 2026, so this is the general explanation.</p>}
			</Section>

			{(done || action) && (
				<div className={cn("grid gap-5", done && action && "sm:grid-cols-2")}>
					{done && (
						<Section title="What MailCheap did">
							<p className="text-pretty">{done}</p>
						</Section>
					)}
					{action && (
						<Section title="What to do">
							<p className="text-pretty">{action}</p>
						</Section>
					)}
				</div>
			)}

			{(account || newsletter || campaign) && (
				<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-lg bg-muted/40 px-3.5 py-3">
					{account && (
						<>
							<dt className="text-muted-foreground">Account</dt>
							<dd className="min-w-0">
								<Link
									href={account.href}
									onClick={onNavigate}
									className="block truncate font-medium underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground"
								>
									{account.ownerEmail ?? account.id}
								</Link>
								<span className="text-xs text-muted-foreground">{[account.plan, account.state].filter(Boolean).join(" · ")}</span>
							</dd>
						</>
					)}
					{newsletter && (
						<>
							<dt className="text-muted-foreground">Newsletter</dt>
							<dd className="min-w-0 truncate">
								<Link
									href={newsletter.href}
									onClick={onNavigate}
									className="font-medium underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground"
								>
									{newsletter.name}
								</Link>{" "}
								<span className="text-muted-foreground">/{newsletter.slug}</span>
							</dd>
						</>
					)}
					{campaign && (
						<>
							<dt className="text-muted-foreground">Campaign</dt>
							<dd className="min-w-0">
								<Link
									href={campaign.href}
									onClick={onNavigate}
									className="block truncate font-medium underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground"
								>
									{campaign.subject}
								</Link>
								<span className="text-xs text-muted-foreground tabular-nums">{describeCampaign(campaign)}</span>
							</dd>
						</>
					)}
				</dl>
			)}

			{told.length > 0 && (
				<Section title="Who was told">
					<ul className="flex flex-col gap-1">
						{told.map(({ label, at }) => (
							<li key={label} className="flex items-baseline justify-between gap-3">
								<span>{label}</span>
								<span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatRelative(at)}</span>
							</li>
						))}
					</ul>
				</Section>
			)}

			{trail.length > 0 && (
				<Section title="Trail">
					<ol className="ml-1 flex flex-col gap-3 border-l border-border pl-4">
						{trail.map(({ at, text, note, isItem }, index) => (
							<li key={`${at}-${index}`} className="relative">
								<span
									aria-hidden="true"
									className={cn(
										"absolute top-1.5 -left-[21px] size-2 rounded-full ring-4 ring-popover",
										isItem ? "bg-foreground" : "bg-muted-foreground/40"
									)}
								/>
								<p className={cn("text-pretty", !isItem && "text-muted-foreground")}>{text}</p>
								<p className="text-xs text-muted-foreground tabular-nums">
									{formatSendTime(at)}
									{note && ` · ${note}`}
								</p>
							</li>
						))}
					</ol>
				</Section>
			)}
		</div>
	);
}

function Section({ title, children }) {
	return (
		<section className="flex flex-col gap-1.5">
			<h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
			{children}
		</section>
	);
}

function describeCampaign({ status, recipients, delivered, bounced, complained }) {
	const counts = [
		recipients !== null && `${formatNumber(recipients)} recipients`,
		delivered !== null && `${formatNumber(delivered)} delivered`,
		bounced > 0 && `${formatNumber(bounced)} bounced`,
		complained > 0 && `${formatNumber(complained)} complaints`,
	];
	return [status, ...counts].filter(Boolean).join(" · ");
}

function SkeletonDetails() {
	return (
		<div className="flex flex-col gap-4" aria-hidden="true">
			<div className="flex flex-col gap-2">
				<Skeleton className="h-3 w-24" />
				<Skeleton className="h-4 w-full" />
				<Skeleton className="h-4 w-4/5" />
			</div>
			<Skeleton className="h-16 w-full rounded-lg" />
			<div className="flex flex-col gap-2">
				<Skeleton className="h-3 w-16" />
				<Skeleton className="h-4 w-3/4" />
				<Skeleton className="h-4 w-2/3" />
			</div>
		</div>
	);
}
