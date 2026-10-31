import "server-only";
import { createHmac } from "node:crypto";

// Shared subdomains' DNS records, and customers' website domains on the app's Vercel project, go through MailCheap's
// DNS helper (dns-broker/), a Vercel project of its own that holds the Vercel token: the app only signs its requests,
// with DNS_BROKER_SECRET. Without DNS_BROKER_URL and DNS_BROKER_SECRET (a self-hosted server, local development) DNS
// automation is off and nothing is published.
function getBroker() {
	const { DNS_BROKER_URL: url, DNS_BROKER_SECRET: secret } = process.env;
	return url && secret ? { url, secret } : null;
}

// helperProblem: the helper itself, not one slug's records or one host. "cap": its daily cap. "down": a secret or Vercel
// token that's wrong or revoked, Vercel failing, a wrong address or no answer. Either way, every new shared address waits.
function getHelperProblem(status) {
	if (status === 429) return "cap";
	return [400, 403, 405, 409, 413].includes(status) ? null : "down";
}

async function callBroker(payload) {
	const broker = getBroker();
	if (!broker) return { skipped: true };
	const body = JSON.stringify(payload);
	const timestamp = String(Math.floor(Date.now() / 1000));
	const signature = createHmac("sha256", broker.secret).update(`${timestamp}.${body}`).digest("hex");
	let response;
	try {
		response = await fetch(broker.url, {
			method: "POST",
			headers: { "content-type": "application/json", "x-mailcheap-timestamp": timestamp, "x-mailcheap-signature": `sha256=${signature}` },
			body,
			signal: AbortSignal.timeout(30_000),
		});
	} catch (error) {
		throw Object.assign(new Error(`The DNS helper didn't answer: ${error.message}`), { helperProblem: "down" });
	}
	const data = await response.json().catch(() => null);
	if (!response.ok) {
		const target = payload.host ?? `${payload.slug}'s records`;
		const message = `The DNS helper refused to ${payload.action} ${target}: ${data?.message ?? data?.error ?? response.status}`;
		throw Object.assign(new Error(message), { status: response.status, helperProblem: getHelperProblem(response.status) });
	}
	return data;
}

// All of a slug's records or none: the helper tags them for the slug and answers their ids in the same order.
export async function publishSharedRecords(slug, records) {
	const result = await callBroker({ action: "create", slug, records: records.map(({ type, name, value }) => ({ type, name, value })) });
	return result.skipped ? result : { ids: result.ids };
}

export async function removeSharedRecords(slug, ids = []) {
	if (ids.length === 0) return { deleted: [] };
	return callBroker({ action: "delete", slug, ids });
}

// A website domain on the app's project: { verified, verification }, where verification lists the TXT records Vercel
// asks for when the domain is verified for another Vercel team. A refusal for a host on another project has status 409.
export async function attachWebsiteHost(host) {
	const result = await callBroker({ action: "attach", host });
	return result.skipped ? result : { verified: Boolean(result.verified), verification: result.verification ?? [] };
}

export async function detachWebsiteHost(host) {
	return callBroker({ action: "detach", host });
}
