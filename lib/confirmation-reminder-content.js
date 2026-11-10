import { CONFIRM_URL_PLACEHOLDER } from "./confirmation-content.js";
import { getEmailBrand } from "./public-brand.js";

// The one reminder. Not the newsletter's own confirmation email: that can carry a description, and this must not
// sell anything before the person confirms. The button is the same markup the brand repaints. It doesn't say who
// signed up or how many clicks it takes: the footer leaves the first open, and the confirm page has its own button.
export function getConfirmationReminderContent(newsletter) {
	const branded = getEmailBrand()?.email?.confirmationReminder;
	if (branded) return { format: "markdown", ...branded };
	const name = newsletter?.name?.trim() || "the newsletter";
	return {
		format: "markdown",
		subject: `Reminder: confirm your subscription to ${name}`,
		previewText: "You're not on the list until you confirm. This is the only reminder.",
		markdown: `**Please confirm your subscription.**

This address signed up for ${name} and is still waiting. You won't receive ${name} until you confirm.

<a href="${CONFIRM_URL_PLACEHOLDER}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px;">Confirm my subscription</a>

Didn't sign up? Ignore this email. You stay off the list, and this is the only reminder.`,
	};
}
