import { CONFIRM_URL_PLACEHOLDER } from "./confirmation-content.js";

// The one reminder. Not the newsletter's own confirmation email: that can carry a description, and this must not
// sell anything before the person confirms. The button is the same markup the brand repaints.
export function getConfirmationReminderContent(newsletter) {
	const name = newsletter?.name?.trim() || "the newsletter";
	return {
		format: "markdown",
		subject: `Reminder: confirm your subscription to ${name}`,
		previewText: `You asked to get ${name}. One click confirms it. This is the only reminder.`,
		markdown: `**Please confirm your subscription.**

You asked to get ${name}, and this address is still waiting. You won't receive ${name} until you confirm.

<a href="${CONFIRM_URL_PLACEHOLDER}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px;">Confirm my subscription</a>

Didn't ask for this? Ignore this email. You won't be added, and this is the only reminder.`,
	};
}
