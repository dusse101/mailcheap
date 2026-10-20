"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { approveContentReview, rejectContentReview } from "@/app/admin/actions";
import BadgeStatus from "@/components/BadgeStatus";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatRelative } from "@/lib/format";
import { toast } from "@/lib/toast";

// What the automated content check found (lib/content-review.js), for admins only, and the decision on a held issue.
export default function CardContentReview({ campaignId, review, isPending, ownerEmail }) {
	const status = getStatus(review, isPending);
	const rows = [
		review.categories?.length > 0 && { label: "Found", value: review.categories.map((name) => name.replaceAll("_", " ")).join(", ") },
		review.reasons?.length > 0 && {
			label: "Why",
			value: (
				<ul className="flex flex-col gap-1">
					{review.reasons.map((reason) => (
						<li key={reason} className="text-pretty">
							{reason}
						</li>
					))}
				</ul>
			),
		},
		review.verdict && {
			label: "Classifier",
			value: `${review.verdict}${review.confidence != null ? ` · ${Math.round(review.confidence * 100)}% sure` : ""}`,
		},
		review.scores && Object.keys(review.scores).length > 0 && {
			label: "Moderation",
			value: Object.entries(review.scores)
				.map(([name, score]) => `${name} ${score.toFixed(2)}`)
				.join(" · "),
		},
		review.decision && {
			label: review.decision === "approved" ? "Approved" : "Rejected",
			value: `${review.decidedBy ?? "An admin"}, ${formatRelative(review.decidedAt)}${review.note ? ` · "${review.note}"` : ""}`,
		},
		{ label: "Checked", value: `${formatRelative(review.checkedAt)}${review.model ? ` · ${review.model}` : ""}` },
	].filter(Boolean);

	return (
		<section style={{ "--stagger": 6 }} className="mt-6 flex flex-col gap-3 animate-enter">
			<div className="flex items-center justify-between gap-3">
				<h2 className="text-sm font-medium text-muted-foreground">Content check</h2>
				<BadgeStatus status={status.tone} label={status.label} />
			</div>
			<dl className="divide-y divide-border rounded-xl bg-card text-sm shadow-border">
				{rows.map(({ label, value }) => (
					<div key={label} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 px-4 py-2.5">
						<dt className="text-muted-foreground">{label}</dt>
						<dd className="min-w-0">{value}</dd>
					</div>
				))}
			</dl>
			{isPending && <ActionsReview campaignId={campaignId} ownerEmail={ownerEmail} />}
		</section>
	);
}

function ActionsReview({ campaignId, ownerEmail }) {
	const router = useRouter();
	const [isRejecting, setIsRejecting] = useState(false);
	const [isPending, startTransition] = useTransition();

	function approve() {
		startTransition(async () => {
			const result = await approveContentReview(campaignId);
			if (result?.error) return toast.error(result.error);
			toast.success("Approved, it's going out");
			router.refresh();
		});
	}

	return (
		<div className="flex flex-wrap items-center gap-2">
			<Button onClick={approve} disabled={isPending}>
				{isPending ? <Loader2 className="animate-spin" /> : <Check data-icon="inline-start" />}
				Approve and send
			</Button>
			<Button variant="outline" onClick={() => setIsRejecting(true)} disabled={isPending}>
				<X data-icon="inline-start" />
				Reject
			</Button>
			<Dialog open={isRejecting} onOpenChange={setIsRejecting}>
				<DialogContent className="sm:max-w-md">
					<FormReject campaignId={campaignId} ownerEmail={ownerEmail} onDone={() => setIsRejecting(false)} />
				</DialogContent>
			</Dialog>
		</div>
	);
}

function FormReject({ campaignId, ownerEmail, onDone }) {
	const router = useRouter();
	const [note, setNote] = useState("");
	const [isBlocking, setIsBlocking] = useState(false);
	const [isPending, startTransition] = useTransition();

	function reject(event) {
		event.preventDefault();
		startTransition(async () => {
			const result = await rejectContentReview(campaignId, { note, block: isBlocking });
			if (result?.error) return toast.error(result.error);
			toast.success(isBlocking ? "Rejected and account blocked" : "Rejected");
			onDone();
			router.refresh();
		});
	}

	return (
		<form onSubmit={reject} className="flex flex-col gap-4">
			<DialogHeader>
				<DialogTitle>Reject this issue?</DialogTitle>
				<DialogDescription>
					It stays paused for good and {ownerEmail ?? "its owner"} gets an email saying it can&apos;t be sent, with your message
					if you write one.
				</DialogDescription>
			</DialogHeader>
			<Textarea
				value={note}
				onChange={(event) => setNote(event.target.value)}
				placeholder="Message to the owner (optional)"
				maxLength={300}
				aria-label="Message to the owner"
			/>
			<Label className="flex items-center gap-3 text-sm font-normal">
				<Switch checked={isBlocking} onCheckedChange={setIsBlocking} />
				Block the account too
			</Label>
			<DialogFooter>
				<DialogClose asChild>
					<Button variant="outline">Cancel</Button>
				</DialogClose>
				<Button type="submit" variant="destructive" disabled={isPending} className="min-w-20">
					{isPending ? <Loader2 className="animate-spin" /> : "Reject"}
				</Button>
			</DialogFooter>
		</form>
	);
}

// The badge's tone by a status it knows (components/BadgeStatus.jsx), with this check's own words.
function getStatus(review, isPending) {
	if (isPending) return { tone: "pending", label: "Waiting for you" };
	if (review.decision === "approved") return { tone: "success", label: "Approved" };
	if (review.decision === "rejected") return { tone: "blocked", label: "Rejected" };
	if (review.outcome === "flag") return { tone: "paused", label: "Flagged" };
	if (review.outcome === "error") return { tone: "none", label: "Didn't run" };
	return { tone: "success", label: "Passed" };
}
