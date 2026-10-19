export const KEEP_URL_PLACEHOLDER = "{{keep_url}}";

// The branded last-chance footer quotes this, so the sentence and the button stay the same words.
export const KEEP_BUTTON_LABEL = "Yes, keep sending it";

// What a cold contact gets instead of an issue (lib/cleanup.js). One question, one button.
export function getLastChanceContent(newsletter) {
	const name = newsletter?.name?.trim() || "this newsletter";
	return {
		format: "markdown",
		subject: `Do you still want ${name}?`,
		previewText: "Click the button, and it keeps coming.",
		markdown: `**Do you still want ${name}?**

You haven't opened it in a while, so I'm checking before I stop sending it.

<a href="${KEEP_URL_PLACEHOLDER}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-size:17px;font-weight:600;padding:14px 28px;border-radius:10px;">${KEEP_BUTTON_LABEL}</a>

If I don't hear from you, this is the last ${name} email you'll get.`,
	};
}
