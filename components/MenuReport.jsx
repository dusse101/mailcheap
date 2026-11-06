"use client";

import { useRef, useState, useTransition } from "react";
import { Copy, ExternalLink, Eye, GlobeOff, Loader2, MoreHorizontal, Pin, PinOff } from "lucide-react";
import { duplicateCampaign, toggleArchivePin } from "@/app/(app)/campaigns/actions";
import DialogPreviewEmail from "@/components/DialogPreviewEmail";
import DialogUnpublishCampaign from "@/components/DialogUnpublishCampaign";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToastError } from "@/lib/use-toast-error";

// A sent campaign's other actions: its page on the newsletter's website and its place there, the email as it went out,
// and a copy to edit. pageUrl: only for an issue on the website. preview: the email for DialogPreviewEmail, only for an
// issue that went out by email.
export default function MenuReport({ id, subject, pageUrl, isPinned, isWebOnly, preview }) {
	const [isPending, startTransition] = useTransition();
	const [isUnpublishOpen, setIsUnpublishOpen] = useState(false);
	const [isPreviewOpen, setIsPreviewOpen] = useState(false);
	const moreRef = useRef(null);
	const isOpeningDialogRef = useRef(false);
	const toastError = useToastError();

	function run(action) {
		startTransition(async () => {
			const result = await action(id);
			if (result?.error) toastError(result);
		});
	}

	// The preview keeps the focus the menu would give back to its button as it closes, and hands it to that button once
	// it closes, as the item that opened it is gone.
	function openPreview() {
		isOpeningDialogRef.current = true;
		setIsPreviewOpen(true);
	}

	function keepDialogFocus(event) {
		if (!isOpeningDialogRef.current) return;
		isOpeningDialogRef.current = false;
		event.preventDefault();
	}

	function returnFocus(event) {
		event.preventDefault();
		moreRef.current?.focus();
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button ref={moreRef} variant="outline" size="icon" aria-label="More actions" disabled={isPending} className="aria-expanded:bg-muted">
						{isPending ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" onCloseAutoFocus={keepDialogFocus} className="min-w-52">
					{pageUrl && (
						<>
							<DropdownMenuItem asChild>
								<a href={pageUrl} target="_blank" rel="noreferrer">
									<ExternalLink />
									View page
								</a>
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => run(toggleArchivePin)}>
								{isPinned ? <PinOff /> : <Pin />}
								{isPinned ? "Unpin" : "Pin to top"}
							</DropdownMenuItem>
							<DropdownMenuSeparator />
						</>
					)}
					{preview && (
						<DropdownMenuItem onSelect={openPreview}>
							<Eye />
							Preview
						</DropdownMenuItem>
					)}
					<DropdownMenuItem onSelect={() => run(duplicateCampaign)}>
						<Copy />
						Duplicate
					</DropdownMenuItem>
					{pageUrl && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem variant="destructive" onSelect={() => setIsUnpublishOpen(true)}>
								<GlobeOff />
								Remove from website
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
			{preview && (
				<DialogPreviewEmail isOpen={isPreviewOpen} onOpenChange={setIsPreviewOpen} onCloseAutoFocus={returnFocus} {...preview} />
			)}
			{pageUrl && (
				<DialogUnpublishCampaign
					id={id}
					subject={subject}
					isWebOnly={isWebOnly}
					isOpen={isUnpublishOpen}
					onOpenChange={setIsUnpublishOpen}
					redirectTo="/campaigns"
				/>
			)}
		</>
	);
}
