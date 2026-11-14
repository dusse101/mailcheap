import { queueConfirmationReminders } from "@/lib/confirmation-reminder";
import { withCronSecret } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Every day at about 5:45 in America/Chicago (the schedule in vercel.json): confirmation reminders and nothing else, so a
// daily run doesn't change the cadence of what /api/cron/hourly does. With CONFIRMATION_REMINDERS unset it sends nothing.
export const GET = withCronSecret(async () => {
	const confirmationReminders = await queueConfirmationReminders();
	console.info(`[confirmation-reminders] ${JSON.stringify({ confirmationReminders })}`);
	return { confirmationReminders };
});
