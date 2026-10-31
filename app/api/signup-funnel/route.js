import { actionError, toActionError } from "@/lib/actions/errors";
import { findNewsletter } from "@/lib/actions/shared";
import { errorResponse, REQUESTS_PER_KEY } from "@/lib/api/rest";
import { authenticateRequest } from "@/lib/api-keys";
import { isRateLimited } from "@/lib/rate-limit";
import { getSignupFunnel, MAX_FUNNEL_DAYS, MAX_PENDING_LISTED } from "@/lib/signup-funnel";
import { resolveTimeZone } from "@/lib/time-zone";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };

function readInteger(value, fallback, max) {
	const number = Number.parseInt(value ?? "", 10);
	return Number.isFinite(number) ? Math.min(max, Math.max(1, number)) : fallback;
}

// Fork: GET /api/signup-funnel?newsletter=<slug>&days=7&timeZone=America/Chicago&limit=100, for tacoandtell.com's
// daily report (lib/signup-funnel.js). A read key or a full access key; signups only keys can't, since it lists the
// addresses still waiting to confirm.
export async function GET(request) {
	const auth = await authenticateRequest(request);
	if (!auth) return errorResponse(actionError("unauthorized", "Send a valid API key: Authorization: Bearer <key>"), NO_STORE);
	if (auth.level !== "read" && auth.level !== "full") {
		return errorResponse(actionError("forbidden", "This key can only add contacts: the signup funnel needs a read or full access key"), NO_STORE);
	}
	if (await isRateLimited({ ...REQUESTS_PER_KEY, key: String(auth.apiKey._id) })) {
		return errorResponse(actionError("rate_limited", "Too many requests with this key, try again in a minute"), { ...NO_STORE, "retry-after": "60" });
	}

	const params = new URL(request.url).searchParams;
	try {
		const newsletter = await findNewsletter(auth.account, params.get("newsletter") ?? "", { slug: 1, accountId: 1 });
		const funnel = await getSignupFunnel({
			newsletter,
			days: readInteger(params.get("days"), 7, MAX_FUNNEL_DAYS),
			timeZone: resolveTimeZone(params.get("timeZone") ?? undefined),
			pendingLimit: readInteger(params.get("limit"), 100, MAX_PENDING_LISTED),
		});
		return Response.json(funnel, { headers: NO_STORE });
	} catch (error) {
		if (toActionError(error).code === "internal_error") console.error("[signup-funnel] Failed:", error);
		return errorResponse(error, NO_STORE);
	}
}
