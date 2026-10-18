import { NextResponse } from "next/server";
import { confirmSubscription } from "@/app/confirm/actions";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";

const NO_STORE = { "Cache-Control": "no-store" };
// A person tapping the button, not a mail provider's one-click flood.
const RATE_LIMIT = { name: "confirm", limit: 60, window: "1 m" };

function pageUrl(request, token) {
	const url = new URL("/confirm", request.url);
	if (token) url.searchParams.set("token", token);
	return url;
}

function redirectToPage(request, token) {
	const response = NextResponse.redirect(pageUrl(request, token), 303);
	response.headers.set("Cache-Control", "no-store");
	return response;
}

// Next.js rejects a server-action POST whose Origin is the string "null", and then never finishes the
// response. This route is an ordinary form POST instead. A missing Origin is allowed, as Next allows it
// for non-browser clients; "null" and any other host are not, so another site can't submit the button.
function sameOrigin(request) {
	const origin = request.headers.get("origin");
	if (!origin) return true;
	if (origin === "null") return false;
	let originHost;
	try {
		originHost = new URL(origin).host;
	} catch {
		return false;
	}
	const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0].trim();
	const host = forwarded || request.headers.get("host") || new URL(request.url).host;
	return originHost === host;
}

// Opening the URL never confirms. Mail apps and scanners that only fetch the link stay on the page.
export function GET(request) {
	return redirectToPage(request, new URL(request.url).searchParams.get("token"));
}

export async function POST(request) {
	const urlToken = new URL(request.url).searchParams.get("token");
	const form = await request.formData().catch(() => null);
	const formToken = form?.get("token");
	const token = typeof formToken === "string" && formToken ? formToken : urlToken;
	if (!sameOrigin(request)) {
		return new NextResponse("Forbidden", { status: 403, headers: NO_STORE });
	}
	if (await isRateLimited({ ...RATE_LIMIT, key: getClientIp(request.headers) })) {
		return new NextResponse("Try again in a minute.", { status: 429, headers: NO_STORE });
	}
	try {
		await confirmSubscription(token);
	} catch (error) {
		console.error("[confirm] Failed:", error);
		return new NextResponse("Something went wrong.", { status: 500, headers: NO_STORE });
	}
	return redirectToPage(request, token);
}
