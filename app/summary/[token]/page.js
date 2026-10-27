import Link from "next/link";
import { Check, Link2Off, Mail } from "lucide-react";
import { saveSummaryChoice } from "@/app/summary/[token]/actions";
import { Button } from "@/components/ui/button";
import { scoped } from "@/lib/account-scope";
import { connectDb } from "@/lib/db";
import { NOTIFICATIONS_PATH } from "@/lib/newsletter-sections";
import { SUMMARY_HOUR, getSummaryFrequency } from "@/lib/summary";
import { verifySummarySettingsToken } from "@/lib/summary-token";
import { cn } from "@/lib/utils";
import Newsletter from "@/models/Newsletter";

// The URL carries the link's token: keep it out of search results and referrer headers.
export const metadata = {
	title: "Summary email",
	robots: { index: false, follow: false },
	referrer: "no-referrer",
};

// From a summary email's footer, without signing in: how often that newsletter's summary comes, or off.
export default async function SummarySettingsPage({ params, searchParams }) {
	const [{ token }, { saved, error }] = await Promise.all([params, searchParams]);
	const reference = verifySummarySettingsToken(token);
	const newsletter = reference ? await findNewsletter(reference) : null;

	if (!newsletter) {
		return (
			<LayoutCard
				icon={Link2Off}
				title="This link doesn't work"
				description="It's too old or incomplete. Sign in to change your summary email in your newsletter's notifications."
			>
				<Button asChild size="lg" className="mt-6 w-full">
					<Link href={NOTIFICATIONS_PATH}>Open your notifications</Link>
				</Button>
			</LayoutCard>
		);
	}

	const frequency = getSummaryFrequency(newsletter);
	return (
		<LayoutCard icon={saved ? Check : Mail} title={saved ? "Saved" : "Summary email"} description={describe(frequency, newsletter.name)}>
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
			<p className="mt-5 text-xs leading-relaxed text-pretty text-muted-foreground">
				You can also change it in the newsletter&apos;s settings, under Notifications.
			</p>
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

async function findNewsletter({ accountId, newsletterId }) {
	await connectDb();
	return Newsletter.findOne(scoped(accountId, { _id: newsletterId })).select({ name: 1, notifications: 1 }).lean();
}

function describe(frequency, name) {
	if (frequency === "daily") return `The summary of ${name} comes every morning at ${SUMMARY_HOUR} AM, your time. Days with no news are skipped.`;
	if (frequency === "weekly") return `The summary of ${name} comes every Monday at ${SUMMARY_HOUR} AM, your time.`;
	return `It's off: MailCheap won't send you summaries of ${name}.`;
}

const OPTIONS = [
	{ value: "daily", label: "Every morning" },
	{ value: "weekly", label: "Every Monday" },
	{ value: "off", label: "Turn off" },
];
