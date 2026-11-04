import { createHash, timingSafeEqual } from "node:crypto";
import { actionError, toActionError } from "@/lib/actions/errors";
import { errorResponse } from "@/lib/api/rest";
import { connectDb } from "@/lib/db";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { getSignupFunnel, MAX_FUNNEL_DAYS, MAX_PENDING_LISTED } from "@/lib/signup-funnel";
import { resolveTimeZone } from "@/lib/time-zone";
import Newsletter from "@/models/Newsletter";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };
const REQUESTS_PER_VISITOR = { name: "signup-funnel", limit: 60, window: "1 m" };

function readInteger(value, fallback, max) {
	const number = Number.parseInt(value ?? "", 10);
	return Number.isFinite(number) ? Math.min(max, Math.max(1, number)) : fallback;
}

function digest(value) {
	return createHash("sha256").update(value).digest();
}

// Only MAILCHEAP_FUNNEL_KEY opens it, never an API key: the read archive key sits on the reading site for the public
// archive, and this lists the addresses still waiting to confirm.
function hasFunnelKey(request, secret) {
	const given = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
	return Boolean(given) && timingSafeEqual(digest(given), digest(secret));
}

// Fork: GET /api/signup-funnel?newsletter=<slug>&days=7|all&timeZone=America/Chicago&limit=100, for tacoandtell.com's
// report (lib/signup-funnel.js). days=all answers lifetime totals from the contacts and messages, with no byDay.
export async function GET(request) {
	if (await isRateLimited({ ...REQUESTS_PER_VISITOR, key: getClientIp(request.headers) })) {
		return errorResponse(actionError("rate_limited", "Too many requests, try again in a minute"), { ...NO_STORE, "retry-after": "60" });
	}
	const secret = process.env.MAILCHEAP_FUNNEL_KEY;
	if (!secret) return errorResponse(actionError("unavailable", "The signup funnel is off on this server: MAILCHEAP_FUNNEL_KEY isn't set"), NO_STORE);
	if (!hasFunnelKey(request, secret)) {
		return errorResponse(actionError("unauthorized", "Send the funnel key: Authorization: Bearer <MAILCHEAP_FUNNEL_KEY>"), NO_STORE);
	}

	const params = new URL(request.url).searchParams;
	try {
		const slug = params.get("newsletter")?.trim().toLowerCase();
		if (!slug) throw actionError("validation_failed", "newsletter: send the newsletter's slug");
		// A cold instance has no connection yet: without this, the first query buffers until Mongoose times out (500).
		await connectDb();
		// Slugs are unique across accounts, and the key is the server's own, not an account's.
		const newsletter = await Newsletter.findOne({ slug }).select({ slug: 1, accountId: 1 }).setOptions({ crossAccount: true }).lean();
		if (!newsletter) throw actionError("not_found", "Newsletter not found");
		const funnel = await getSignupFunnel({
			newsletter,
			days: params.get("days") === "all" ? "all" : readInteger(params.get("days"), 7, MAX_FUNNEL_DAYS),
			timeZone: resolveTimeZone(params.get("timeZone") ?? undefined),
			pendingLimit: readInteger(params.get("limit"), 100, MAX_PENDING_LISTED),
		});
		return Response.json(funnel, { headers: NO_STORE });
	} catch (error) {
		if (toActionError(error).code === "internal_error") console.error("[signup-funnel] Failed:", error);
		return errorResponse(error, NO_STORE);
	}
}
