import { hasActiveSubscription } from "@/lib/account-state";
import { isCloud } from "@/lib/config";
import { isGetStartedOpen } from "@/lib/get-started";

// The inbox check: an email from MailCheap's own address that its owner replies to, so their mail app files the next
// ones, like a campaign that needs them or their summary, in their inbox instead of spam. A card at the dashboard's
// bottom right offers it (components/CardInboxCheck.jsx). It always goes to the account's owner, never to an address
// someone typed.
export const INBOX_CHECK_LIMIT = { limit: 3, window: "1 d" };

// For an account with a plan, the one MailCheap's emails that matter go to, once the open newsletter's get-started
// panel, which holds the same corner first, is gone for good, until its owner closes this one for that newsletter. On
// MailCheap Cloud only: a self-hosted server sends MailCheap's emails from its operator's own domain.
export function isInboxCheckOpen(account, newsletter, env = process.env) {
	if (!isCloud(env) || !newsletter || newsletter.dismissedNudges?.inboxCheck) return false;
	return hasActiveSubscription(account) && !isGetStartedOpen(account, newsletter);
}

const SUBJECT = "Reply so MailCheap's emails reach your inbox";
const LINES = [
	"Reply to this email with anything, like “got it”.",
	"It tells your mail app you want MailCheap's emails, so the ones that matter reach your inbox instead of spam: a campaign that needs you, a problem with your domain, your summary.",
	"MailCheap only emails you about your account, never marketing.",
];
const SPAM_LINE = "Found this in spam? Mark it as not spam too.";

// Nothing in it comes from a customer, so it has nothing to escape.
export function renderInboxCheckEmail() {
	const [first, ...rest] = LINES;
	return {
		subject: SUBJECT,
		text: [...LINES, SPAM_LINE].join("\n\n"),
		html: `<div style="max-width:460px;margin:0 auto;padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#18181b"><p style="margin:0 0 16px;font-size:16px;line-height:1.5;font-weight:600">${first}</p>${rest.map((line) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6">${line}</p>`).join("")}<p style="margin:0;font-size:13px;line-height:1.5;color:#71717a">${SPAM_LINE}</p></div>`,
	};
}
