import Link from "next/link";
import { Check, Link2Off, Mail } from "lucide-react";
import { saveSummaryChoice } from "@/app/summary/[token]/actions";
import { Button } from "@/components/ui/button";
import { connectDb } from "@/lib/db";
import { SUMMARY_HOUR, getSummaryFrequency } from "@/lib/summary";
import { verifySummarySettingsToken } from "@/lib/summary-token";
import { cn } from "@/lib/utils";
import Account from "@/models/Account";

// The URL carries the link's token: keep it out of search results and referrer headers.
export const metadata = {
	title: "Summary email",
	robots: { index: false, follow: false },
	referrer: "no-referrer",
};

// From the summary email's footer, without signing in: how often it comes, or off.
export default async function SummarySettingsPage({ params, searchParams }) {
	const [{ token }, { saved, error }] = await Promise.all([params, searchParams]);
	const reference = verifySummarySettingsToken(token);
	const account = reference ? await findAccount(reference.accountId) : null;

	if (!account) {
		return (
			<LayoutCard icon={Link2Off} title="This link doesn't work" description="It's too old or incomplete. Sign in to change your summary email on your Account page.">
				<Button asChild size="lg" className="mt-6 w-full">
					<Link href="/account">Open your account</Link>
				</Button>
			</LayoutCard>
		);
	}

	const frequency = getSummaryFrequency(account);
	return (
		<LayoutCard icon={saved ? Check : Mail} title={saved ? "Saved" : "Summary email"} description={describe(frequency)}>
			<form action={saveSummaryChoice} className="mt-6 flex flex-col gap-2">
				<input type="hidden" name="token" value={token} />
				{OPTIONS.map((option) => {
					const isCurrent = option.value === frequency;
					return (
						<Button
							key={option.value}
							type="submit"
							name="frequency"
							value={option.value}
							variant={isCurrent ? "default" : "outline"}
							size="lg"
							aria-pressed={isCurrent}
							className={cn("w-full justify-between", !isCurrent && "font-normal")}
						>
							{option.label}
							{isCurrent && <Check data-icon="inline-end" />}
						</Button>
					);
				})}
			</form>
			{error && <p className="mt-3 text-sm text-destructive">Too many changes. Try again in a few minutes.</p>}
			<p className="mt-5 text-xs leading-relaxed text-pretty text-muted-foreground">You can also change it on your Account page.</p>
		</LayoutCard>
	);
}

function LayoutCard({ icon: Icon, title, description, children }) {
	return (
		<main className="flex min-h-dvh items-center justify-center bg-background px-4 py-16">
			<div className="w-full max-w-sm rounded-xl bg-card p-6 text-center shadow-border sm:p-8">
				<div className="mx-auto flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
					<Icon className="size-5" aria-hidden="true" />
				</div>
				<h1 className="mt-4 text-lg font-semibold text-balance">{title}</h1>
				<p className="mt-1.5 text-sm leading-relaxed text-pretty text-muted-foreground">{description}</p>
				{children}
			</div>
		</main>
	);
}

async function findAccount(accountId) {
	await connectDb();
	return Account.findById(accountId).select({ summary: 1 }).lean();
}

function describe(frequency) {
	if (frequency === "daily") return `Your numbers come every morning at ${SUMMARY_HOUR} AM, your time. Days with no news are skipped.`;
	if (frequency === "weekly") return `Your numbers come every Monday at ${SUMMARY_HOUR} AM, your time.`;
	return "It's off: MailCheap won't send you summaries.";
}

const OPTIONS = [
	{ value: "daily", label: "Every morning" },
	{ value: "weekly", label: "Every Monday" },
	{ value: "off", label: "Turn off" },
];
