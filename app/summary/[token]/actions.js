"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { SUMMARY_FREQUENCIES } from "@/lib/summary";
import { saveSummaryFrequency } from "@/lib/summary-send";
import { verifySummarySettingsToken } from "@/lib/summary-token";
import { getSummarySettingsPath } from "@/lib/summary-links";

const RATE_LIMIT = { name: "summary-settings", limit: 20, window: "10 m" };

// The token is the permission: it names the account and expires (lib/summary-token.js).
export async function saveSummaryChoice(formData) {
	const token = String(formData.get("token") ?? "");
	const frequency = String(formData.get("frequency") ?? "");
	const reference = verifySummarySettingsToken(token);
	if (!reference) redirect(getSummarySettingsPath(encodeURIComponent(token)));
	const path = getSummarySettingsPath(token);
	if (!SUMMARY_FREQUENCIES.includes(frequency)) redirect(path);
	if (await isRateLimited({ ...RATE_LIMIT, key: getClientIp(await headers()) })) redirect(`${path}?error=busy`);
	await saveSummaryFrequency(reference.accountId, frequency);
	redirect(`${path}?saved=${frequency}`);
}
