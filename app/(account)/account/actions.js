"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDeletionBlockers, requestDeletion } from "@/lib/account-deletion";
import { notifyActivity } from "@/lib/alerts";
import { checkDeletionCode, requireAccount, sendDeletionCodeEmail } from "@/lib/auth";
import { isCloud } from "@/lib/config";
import { saveProfile } from "@/lib/profile";
import { isRateLimited } from "@/lib/rate-limit";
import { previewSummary, saveSummaryFrequency } from "@/lib/summary-send";
import { TIME_ZONE_COOKIE } from "@/lib/time-zone";
import { normalizeEmail } from "@/lib/validation";

// Each code also dies after 3 wrong tries and 5 minutes (Better Auth's emailOTP).
const CODES_PER_ACCOUNT = { name: "deletion-code", limit: 3, window: "15 m" };
const CHECKS_PER_ACCOUNT = { name: "deletion-check", limit: 10, window: "15 m" };
// A preview reads the account's numbers across its newsletters.
const PREVIEWS_PER_ACCOUNT = { name: "summary-preview", limit: 30, window: "1 h" };
const CODE_PATTERN = /^\d{6}$/;
const BLOCKED_MESSAGE = "Your account can't be deleted yet. This page says what to do first.";

export async function updateProfile(_state, formData) {
	const { user, account } = await requireAccount();
	const result = await saveProfile({ user, account, name: formData.get("name"), image: formData.get("image") });
	if (result.ok) revalidatePath("/", "layout");
	return result;
}

// Saved with the browser's timezone, which the summary goes out in.
export async function updateSummaryFrequency(frequency) {
	const { account } = await requireAccount();
	if (!isCloud()) return { error: "Summary emails are only on MailCheap Cloud" };
	const timeZone = (await cookies()).get(TIME_ZONE_COOKIE)?.value;
	if (!(await saveSummaryFrequency(account._id, frequency, { timeZone }))) return { error: "Pick daily, weekly or off" };
	revalidatePath("/account");
	return { ok: true };
}

export async function previewSummaryEmail() {
	const { account } = await requireAccount();
	if (!isCloud()) return { error: "Summary emails are only on MailCheap Cloud" };
	if (await isRateLimited({ ...PREVIEWS_PER_ACCOUNT, key: String(account._id) })) return { error: "Too many previews. Try again later." };
	try {
		const email = await previewSummary({ account });
		if (!email) return { error: "Add a newsletter first: the summary shows its numbers." };
		return { html: email.html, subject: email.subject, previewText: email.previewText };
	} catch (error) {
		console.error("[summary] Preview failed:", error.message);
		return { error: "Couldn't build the preview. Try again in a minute." };
	}
}

export async function sendDeletionCode() {
	const { user, account } = await requireAccount();
	if (await getDeletionBlockers(account)) return { error: BLOCKED_MESSAGE };
	if (await isRateLimited({ ...CODES_PER_ACCOUNT, key: String(account._id) })) return { error: "Too many codes. Try again in 15 minutes." };
	try {
		await sendDeletionCodeEmail(user.email);
	} catch (error) {
		console.error("[account] Could not send a deletion code:", error.message);
		return { error: "Couldn't send the code. Try again in a minute." };
	}
	return { sent: true };
}

// A session left open somewhere isn't enough: it takes a code sent for this, and the email typed out.
export async function deleteAccount(_state, formData) {
	const { user, account } = await requireAccount();
	const code = String(formData.get("code") ?? "").replace(/\s/g, "");
	if (normalizeEmail(formData.get("email")) !== normalizeEmail(user.email)) return { error: "Type your email address to confirm" };
	if (!CODE_PATTERN.test(code)) return { error: "Enter the 6-digit code" };
	if (await isRateLimited({ ...CHECKS_PER_ACCOUNT, key: String(account._id) })) return { error: "Too many tries. Try again in 15 minutes." };
	if (await getDeletionBlockers(account)) return { error: BLOCKED_MESSAGE };
	if (!(await checkDeletionCode(user.email, code))) return { error: "This code is wrong or expired" };
	try {
		await requestDeletion({ account, user });
	} catch (error) {
		console.error("[account] Deletion failed:", error);
		return { error: "Couldn't delete your account. Try again in a minute." };
	}
	await notifyActivity(["Account deleted", user.email], { accountId: account._id });
	redirect("/signin?deleted=1");
}
