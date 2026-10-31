"use client";

import { useState, useTransition } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { setContactStatus } from "@/app/(app)/contacts/actions";
import { DotStatus, statusLabel } from "@/components/BadgeStatus";
import { DialogConsentContact, getChangeItem } from "@/components/MenuContact";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getStatusChanges, getStatusLock, needsConsent } from "@/lib/contact-status";
import { toast } from "@/lib/toast";

// A contact's status on its page, next to its other actions: a button opening the changes lib/contact-status.js allows,
// or why it can't change. label: what it says instead of the status, like the list hygiene's reason.
export default function MenuContactStatus({ id, email, status, label, undeliverableReason }) {
	const [isConsentOpen, setIsConsentOpen] = useState(false);
	const [isPending, startTransition] = useTransition();
	const lock = getStatusLock(status, undeliverableReason);
	const changes = getStatusChanges(status);

	function change(nextStatus) {
		if (needsConsent(status, nextStatus)) return void setIsConsentOpen(true);
		startTransition(async () => {
			const result = await setContactStatus(id, nextStatus);
			if (result?.error) toast.error(result.error);
		});
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="outline" disabled={isPending} className="aria-expanded:bg-muted">
						<span className="sr-only">Status: </span>
						<DotStatus status={status} className="size-2" />
						{label || statusLabel(status)}
						{isPending ? (
							<Loader2 className="animate-spin text-muted-foreground" />
						) : (
							<ChevronDown className="text-muted-foreground" />
						)}
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="min-w-48">
					<DropdownMenuLabel className="max-w-60 text-xs font-normal text-muted-foreground">
						{lock ? `${lock}.` : "Change their status"}
					</DropdownMenuLabel>
					{changes.length > 0 && <DropdownMenuSeparator />}
					{changes.map((nextStatus) => {
						const { label: itemLabel, icon: Icon } = getChangeItem(status, nextStatus);
						return (
							<DropdownMenuItem
								key={nextStatus}
								variant={nextStatus === "unsubscribed" ? "destructive" : "default"}
								onSelect={() => change(nextStatus)}
							>
								<Icon />
								{itemLabel}
							</DropdownMenuItem>
						);
					})}
				</DropdownMenuContent>
			</DropdownMenu>
			<DialogConsentContact id={id} email={email} status={status} isOpen={isConsentOpen} onOpenChange={setIsConsentOpen} />
		</>
	);
}
