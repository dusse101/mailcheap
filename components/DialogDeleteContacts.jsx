"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { deleteListedContacts } from "@/app/(app)/contacts/actions";
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
import { formatCount, formatNumber } from "@/lib/format";
import { toast } from "@/lib/toast";

// Every contact a list shows with its filters (filters: the list's, with segmentId on a segment's page), after a yes.
// They go a batch at a time, and the button counts them.
export default function DialogDeleteContacts({ newsletterId, filters, count, isOpen, onOpenChange, onCloseAutoFocus }) {
	const [isDeleting, startDeleting] = useTransition();
	const [deleted, setDeleted] = useState(0);
	// The list refreshes after each batch: the dialog keeps the count it asked about.
	const [askedCount, setAskedCount] = useState(count);
	const shownCount = isDeleting ? askedCount : count;

	function remove() {
		setDeleted(0);
		setAskedCount(count);
		startDeleting(async () => {
			let done = 0;
			for (;;) {
				const result = await deleteListedContacts({ newsletterId, ...filters });
				if (result?.error) {
					toast.error(result.error);
					break;
				}
				done += result.deleted;
				setDeleted(done);
				if (result.remaining === 0 || result.deleted === 0) break;
			}
			if (done > 0) toast.success(`${formatCount(done, "contact")} deleted`);
			onOpenChange(false);
		});
	}

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !isDeleting && onOpenChange(open)}>
			<DialogContent className="sm:max-w-md" onCloseAutoFocus={onCloseAutoFocus}>
				<DialogHeader>
					<DialogTitle>Delete {formatCount(shownCount, "contact")}?</DialogTitle>
					<DialogDescription>
						Every contact this list shows leaves your contacts, with their history. It can&apos;t be undone. Those who
						unsubscribed, bounced or complained stay blocked, so adding them again won&apos;t email them.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogClose asChild>
						<Button variant="outline" disabled={isDeleting}>
							Cancel
						</Button>
					</DialogClose>
					<Button variant="destructive" onClick={remove} disabled={isDeleting} className="min-w-20 tabular-nums">
						{isDeleting ? (
							<>
								<Loader2 className="animate-spin" />
								{deleted > 0 && formatNumber(deleted)}
							</>
						) : (
							`Delete ${formatCount(shownCount, "contact")}`
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
