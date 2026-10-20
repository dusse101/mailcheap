"use client";

import { useRef, useState, useTransition } from "react";
import { Eye } from "lucide-react";
import { previewSummaryEmail, updateSummaryFrequency } from "@/app/(account)/account/actions";
import CardSettings, { RowSettings } from "@/components/CardSettings";
import DialogPreviewEmail from "@/components/DialogPreviewEmail";
import { Segmented } from "@/components/FieldsTheme";
import LinkHelp from "@/components/LinkHelp";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

// The account's summary email (lib/summary.js): how often it comes, and a preview of it with the account's own numbers in
// the editor's preview. isEligible: the account pays for a plan, without which none goes out.
export default function CardSummaryEmail({ frequency: savedFrequency, isEligible, hour, sender, stagger }) {
	const [frequency, setFrequency] = useState(savedFrequency);
	const [preview, setPreview] = useState(null);
	const [isOpen, setIsOpen] = useState(false);
	const [isLoading, startLoading] = useTransition();
	const buttonRef = useRef(null);

	async function choose(value) {
		if (value === frequency) return;
		const previous = frequency;
		setFrequency(value);
		const result = await updateSummaryFrequency(value);
		if (result?.error) {
			setFrequency(previous);
			toast.error(result.error);
			return;
		}
		toast.success(value === "off" ? "Summary emails turned off" : `You'll get it ${value === "daily" ? "every morning" : "every Monday"}`);
	}

	function openPreview() {
		startLoading(async () => {
			const result = await previewSummaryEmail();
			if (result?.error) {
				toast.error(result.error);
				return;
			}
			setPreview(result);
			setIsOpen(true);
		});
	}

	return (
		<CardSettings
			title="Summary email"
			stagger={stagger}
			action={
				<Button ref={buttonRef} variant="outline" size="sm" onClick={openPreview} disabled={isLoading}>
					<Eye data-icon="inline-start" />
					Preview
				</Button>
			}
		>
			<RowSettings
				label="How often"
				hint={
					<>
						{describe(frequency, hour)}
						{!isEligible && frequency !== "off" && " It starts once you pick a plan."}{" "}
						<LinkHelp article="account" section="summary-email" />
					</>
				}
			>
				<div className="max-w-72">
					<Segmented label="How often" size="sm" value={frequency} onChange={choose} options={OPTIONS} />
				</div>
			</RowSettings>
			{preview && (
				<DialogPreviewEmail
					isOpen={isOpen}
					onOpenChange={setIsOpen}
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						buttonRef.current?.focus();
					}}
					html={preview.html}
					subject={preview.subject}
					previewText={preview.previewText}
					sender={sender}
				/>
			)}
		</CardSettings>
	);
}

function describe(frequency, hour) {
	if (frequency === "daily") return `Every morning at ${hour} AM, your time, with yesterday's numbers. Days with no news are skipped.`;
	if (frequency === "weekly") return `Every Monday at ${hour} AM, your time: last week's subscribers and your latest issue.`;
	return "MailCheap won't send you summaries.";
}

const OPTIONS = [
	{ value: "daily", label: "Daily", content: "Daily" },
	{ value: "weekly", label: "Weekly", content: "Weekly" },
	{ value: "off", label: "Off", content: "Off" },
];
