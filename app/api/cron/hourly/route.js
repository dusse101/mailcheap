import { announceTelegram } from "@/lib/alerts";
import { withCronSecret } from "@/lib/cron";
import { checkPostshibaStatus } from "@/lib/postshiba-status";
import { queueDueSummaries } from "@/lib/summary-send";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Every hour: PostShiba's word on whether MailCheap can send, Telegram's first message once it's set up, and the
// summary emails due this hour in their owners' timezones.
export const GET = withCronSecret(async () => {
	const [postshiba, telegram, summaries] = await Promise.all([checkPostshibaStatus(), announceTelegram(), queueDueSummaries()]);
	console.info(`[hourly] ${JSON.stringify({ postshiba, telegram, summaries })}`);
	return { postshiba, telegram, summaries };
});
