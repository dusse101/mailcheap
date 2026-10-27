import "server-only";
import { SENDER_WARMUP } from "@/lib/config";
import DomainRegistration from "@/models/DomainRegistration";

const RDAP_URL = "https://rdap.org/domain/";
// The whole lookup, its parent domains included: a send or a page doesn't wait longer on a slow registry.
const BUDGET_MS = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Asked again: a week after no registry had a date, a day after none answered.
const RECHECK_UNKNOWN_MS = 7 * DAY_MS;
const RECHECK_FAILED_MS = DAY_MS;
const HOSTNAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const MAX_LOOKUPS = 4;

// When a domain was registered, from its registry's RDAP record through rdap.org: a subdomain has none, so its parent
// domains are asked in turn. null when no registry says. Kept for every account (models/DomainRegistration.js): a
// registration date doesn't change.
export async function getDomainRegisteredAt(domain, now = new Date()) {
	const name = String(domain ?? "").toLowerCase();
	if (!HOSTNAME.test(name)) return null;
	const kept = await DomainRegistration.findOne({ domain: name }).lean();
	if (kept && (kept.registeredAt || kept.recheckAt > now)) return kept.registeredAt ?? null;
	const { registeredAt, isAnswered } = await lookUp(name);
	await DomainRegistration.updateOne(
		{ domain: name },
		{
			$set: { registeredAt, checkedAt: now, recheckAt: new Date(now.getTime() + (isAnswered ? RECHECK_UNKNOWN_MS : RECHECK_FAILED_MS)) },
		},
		{ upsert: true }
	);
	return registeredAt;
}

async function lookUp(name) {
	const labels = name.split(".");
	const deadline = Date.now() + BUDGET_MS;
	let isAnswered = true;
	for (let index = 0; index <= Math.min(labels.length - 2, MAX_LOOKUPS - 1); index++) {
		const leftMs = deadline - Date.now();
		if (leftMs <= 0) return { registeredAt: null, isAnswered: false };
		try {
			const response = await fetch(`${RDAP_URL}${encodeURIComponent(labels.slice(index).join("."))}`, {
				headers: { Accept: "application/rdap+json, application/json" },
				signal: AbortSignal.timeout(leftMs),
			});
			if (response.status === 404) continue;
			if (!response.ok) {
				isAnswered = false;
				continue;
			}
			return { registeredAt: readRegistration(await response.json()), isAnswered: true };
		} catch {
			isAnswered = false;
		}
	}
	return { registeredAt: null, isAnswered };
}

function readRegistration(record) {
	const event = (Array.isArray(record?.events) ? record.events : []).find((item) => item?.eventAction === "registration");
	const date = typeof event?.eventDate === "string" ? new Date(event.eventDate) : null;
	return date && Number.isFinite(date.getTime()) ? date : null;
}

// Registered in the last SENDER_WARMUP.newDomainDays, or with no registry to say when: only a domain proven older skips
// a new domain's first day, so a lookup that fails or a registry that doesn't share dates can't be used to skip it.
export async function isNewDomain(domain, now = new Date()) {
	const registeredAt = await getDomainRegisteredAt(domain, now);
	return !registeredAt || now.getTime() - registeredAt.getTime() < SENDER_WARMUP.newDomainDays * DAY_MS;
}
