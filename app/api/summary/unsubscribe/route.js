import { NextResponse } from "next/server";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { getSummarySettingsPath } from "@/lib/summary-links";
import { saveSummaryFrequency } from "@/lib/summary-send";
import { verifySummarySettingsToken } from "@/lib/summary-token";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
// Gmail and Yahoo send one-click requests from shared mail servers, so keep this generous.
const RATE_LIMIT = { name: "summary-unsubscribe", limit: 60, window: "1 m" };

// The summary email's List-Unsubscribe link (RFC 8058): a mail app's Unsubscribe button posts here, and the summary
// turns off without a page.
export async function POST(request) {
	const reference = verifySummarySettingsToken(new URL(request.url).searchParams.get("token"));
	if (!reference) return new NextResponse("This link doesn't work.", { status: 400, headers: NO_STORE });
	if (await isRateLimited({ ...RATE_LIMIT, key: getClientIp(request.headers) })) {
		return new NextResponse("Too many requests.", { status: 429, headers: NO_STORE });
	}
	await saveSummaryFrequency(reference.accountId, "off");
	console.info(`[summary] Turned off by one-click unsubscribe for account ${reference.accountId}`);
	return new NextResponse("Summary emails are off.", { status: 200, headers: NO_STORE });
}

// Opened in a browser instead: the page where it can be changed, with a button, so link scanners change nothing.
export async function GET(request) {
	const token = new URL(request.url).searchParams.get("token");
	return NextResponse.redirect(new URL(getSummarySettingsPath(encodeURIComponent(token ?? "")), request.url), { headers: NO_STORE });
}
