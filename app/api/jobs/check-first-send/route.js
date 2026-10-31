import { NextResponse } from "next/server";
import { withQStashSignature } from "@/lib/qstash-route";
import { checkFirstSend } from "@/lib/sending";

export const dynamic = "force-dynamic";
// No maxDuration: the last step releases most of a large list at once, so how long it may run is the host's to set, and
// one set here would override it. Vercel's default is 300 seconds.

// Handled outcomes answer 200 so QStash doesn't retry them; a thrown error (database down) is retried.
async function handleCheck(request) {
	const body = await request.json().catch(() => null);
	const job = { accountId: body?.accountId, campaignId: body?.campaignId };
	const result = await checkFirstSend(job);
	console.info(`[first-send] ${JSON.stringify({ ...job, ...result })}`);
	return NextResponse.json(result);
}

export const POST = withQStashSignature(handleCheck);
