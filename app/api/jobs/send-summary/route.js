import { NextResponse } from "next/server";
import { withQStashSignature } from "@/lib/qstash-route";
import { sendSummary } from "@/lib/summary-send";
import { isObjectIdString } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// One newsletter's summary email (lib/summary-send.js). Handled outcomes answer 200 so QStash doesn't retry them; a
// thrown error (Resend or the database down) is retried, and the summary goes out once.
async function handleSummary(request) {
	const body = await request.json().catch(() => null);
	const newsletterId = String(body?.newsletterId ?? "");
	if (!isObjectIdString(newsletterId)) return NextResponse.json({ skipped: "invalid" });
	const result = await sendSummary({ newsletterId, key: body?.key });
	console.info(`[summary] ${JSON.stringify({ newsletterId, key: body?.key, ...result })}`);
	return NextResponse.json(result);
}

export const POST = withQStashSignature(handleSummary);
