import { announceTelegram } from "@/lib/alerts";
import { queueConfirmationReminders } from "@/lib/confirmation-reminder";
import { withCronSecret } from "@/lib/cron";
import { recheckDomains } from "@/lib/domains";
import { checkPostshibaStatus } from "@/lib/postshiba-status";
import { queueDueSummaries } from "@/lib/summary-send";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Every hour: PostShiba's word on whether MailCheap can send, Telegram's first message once it's set up, the summary
// emails due this hour in their owners' timezones, the daily look at verified sending domains' DNS records, and
// confirmation reminders for newsletters that turned them on (lib/confirmation-reminder.js). Unset, that part sends nothing.
export const GET = withCronSecret(async () => {
	const [postshiba, telegram, summaries, domains, confirmationReminders] = await Promise.all([
		checkPostshibaStatus(),
		announceTelegram(),
		queueDueSummaries(),
		recheckDomains(),
		queueConfirmationReminders(),
	]);
	console.info(`[hourly] ${JSON.stringify({ postshiba, telegram, summaries, domains, confirmationReminders })}`);
	return { postshiba, telegram, summaries, domains, confirmationReminders };
});
