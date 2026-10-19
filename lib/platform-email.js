import "server-only";
import { APP_NAME, getEmailFrom, getEmailReplyTo, isCloud, isEmailAllowed, isProductionDeployment } from "@/lib/config";
import { getEmailProvider, isEmailProviderConfigured } from "@/lib/email-provider";
import { escapeHtml } from "@/lib/render-email";

const RESEND_URL = "https://api.resend.com/emails";

async function sendWithResend({ from, to, subject, text, html }) {
	const replyTo = getEmailReplyTo();
	const response = await fetch(RESEND_URL, {
		method: "POST",
		headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
		body: JSON.stringify({ from, to: [to], subject, text, ...(html && { html }), ...(replyTo && { reply_to: replyTo }) }),
		signal: AbortSignal.timeout(10_000),
	});
	if (!response.ok) throw new Error(`Resend answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

// MailCheap's own emails (sign-in codes, alerts) go through Resend, apart from customers' emails, so a problem at
// the email provider never blocks a login. MailCheap Cloud never sends them any other way; a self-hosted server
// without RESEND_API_KEY sends them through its email provider.
export async function sendPlatformEmail({ to, subject, text, html }) {
	const from = getEmailFrom();
	if (!from) throw new Error("EMAIL_FROM is not set: MailCheap's own emails need a from address on a domain Resend or the email provider verified");
	if (process.env.RESEND_API_KEY) return sendWithResend({ from, to, subject, text, html });
	if (isCloud()) throw new Error("RESEND_API_KEY is not set: MailCheap Cloud sends its own emails through Resend only");
	await getEmailProvider().sendPlatformEmail({ from, to, subject, text, html });
}

// Without a way out, alerts are only logged.
export function canSendPlatformEmail() {
	if (!getEmailFrom()) return false;
	return Boolean(process.env.RESEND_API_KEY) || (!isCloud() && isEmailProviderConfigured());
}

// The same allowlist sign-in uses. MailCheap Cloud otherwise allows every address, and a preview must not
// print a code for one the list doesn't name.
function isAllowlisted(email) {
	return isEmailAllowed(email, { ...process.env, MAILCHEAP_CLOUD: "" });
}

// Without a Resend key in development, the code shows in the server console instead. A Vercel preview can
// do the same, and only then: PREVIEW_SIGNIN_CODE_LOG=true, no email provider, and an allowlisted address.
// Production never does, including when NODE_ENV is development on a production deployment.
function logsCodeToConsole(email) {
	if (isProductionDeployment()) return false;
	if (!process.env.RESEND_API_KEY && process.env.NODE_ENV === "development") return true;
	if (process.env.VERCEL_ENV !== "preview" || process.env.PREVIEW_SIGNIN_CODE_LOG !== "true") return false;
	if (process.env.RESEND_API_KEY || isEmailProviderConfigured()) return false;
	return isAllowlisted(email);
}

async function sendCode({ email, code, label, subject, purpose, ifNotAsked }) {
	if (logsCodeToConsole(email)) {
		console.info(`[${label}] Code for ${email}: ${code}`);
		return;
	}
	const safeCode = escapeHtml(code);
	await sendPlatformEmail({
		to: email,
		subject,
		text: `${purpose} is ${code}. It expires in 5 minutes.\n\n${ifNotAsked}`,
		html: `<div style="max-width:420px;margin:0 auto;padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#18181b"><p style="margin:0 0 12px;font-size:15px">${purpose}:</p><p style="margin:0 0 24px;font-size:32px;font-weight:600;letter-spacing:6px">${safeCode}</p><p style="margin:0;font-size:13px;line-height:1.5;color:#71717a">It expires in 5 minutes. ${ifNotAsked}</p></div>`,
	});
}

export function sendSigninCode({ email, code }) {
	return sendCode({
		email,
		code,
		label: "signin",
		subject: `${code} is your ${APP_NAME} code`,
		purpose: "Your sign-in code",
		ifNotAsked: "If you didn't ask for it, you can ignore this email.",
	});
}

// A subject of its own: the owner sees what a code is for, and that someone asked for it.
export function sendDeletionCode({ email, code }) {
	return sendCode({
		email,
		code,
		label: "account",
		subject: `${code} is your code to delete your ${APP_NAME} account`,
		purpose: `Your code to delete your ${APP_NAME} account`,
		ifNotAsked: "If you didn't ask for it, don't share it: your account stays as it is.",
	});
}
