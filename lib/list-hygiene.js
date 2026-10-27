import "server-only";
import { connectDb } from "@/lib/db";
import { getDomainLists } from "@/lib/domain-lists";
import { classifyDomain, isAllowlistedDomain } from "@/lib/domain-reputation";
import { checkMailDomain } from "@/lib/mail-domains";
import { withStatusChange } from "@/lib/status-changes";
import Contact from "@/models/Contact";
import MailDomain from "@/models/MailDomain";

const DAY_MS = 24 * 60 * 60 * 1000;
// Contacts who get emails, or may again.
const STOPPABLE_STATUSES = ["active", "pending", "dormant"];
// A spam domain only stops contacts who never opened or clicked, here or on the platform they were imported from:
// someone who reads is a person, whatever the list says about their domain. A domain without mail stops everyone.
const STOPPABLE = {
	"no-mail-server": { status: { $in: STOPPABLE_STATUSES } },
	"spam-domain": {
		status: { $in: STOPPABLE_STATUSES },
		lastOpenAt: { $exists: false },
		lastClickAt: { $exists: false },
		"imported.openRate": { $not: { $gt: 0 } },
	},
};
// One run's share, every 6 hours: whatever is left waits for the next run. The lookups stop well before the function's
// 300 seconds: a group of slow domains can take 15 more, and the scans of contacts around them take their own time.
export const HYGIENE_LIMITS = { domainsPerRun: 4_000, contactsPerRun: 500, concurrency: 40, budgetMs: 170_000 };
// Real dead domains are rare. A run where this many answers say "no mail server" is DNS trouble on MailCheap's side:
// it keeps every record and contact as they were.
const SUSPICIOUS_NONE_SHARE = 0.2;
const SUSPICIOUS_MIN_CHECKED = 50;
const RECHECK_OK_MS = 30 * DAY_MS;
const RECHECK_NONE_MS = 7 * DAY_MS;
// A domain's contacts only stop after a second "no mail server" at least this long after the first, so a DNS outage
// or a domain being moved never costs anyone their subscription. Asked again after as long, so the next daily run
// does it whatever its timing.
const CONFIRM_AFTER_MS = 20 * 60 * 60 * 1000;
const DOMAIN_EXPRESSION = { $toLower: { $arrayElemAt: [{ $split: ["$email", "@"] }, 1] } };

// Every domain with contacts who get emails or may again, with how many, in every account.
function listContactDomains() {
	return Contact.aggregate([
		{ $match: { status: { $in: STOPPABLE_STATUSES } } },
		{ $group: { _id: DOMAIN_EXPRESSION, contacts: { $sum: 1 } } },
	]).option({ crossAccount: true, allowDiskUse: true });
}

function findContactsOn(domains, match, limit) {
	if (domains.length === 0 || limit <= 0) return [];
	return Contact.aggregate([
		{ $match: match },
		{ $addFields: { domain: DOMAIN_EXPRESSION } },
		{ $match: { domain: { $in: domains } } },
		{ $limit: limit },
		{ $project: { _id: 1, accountId: 1, status: 1, undeliverableFrom: 1 } },
	]).option({ crossAccount: true });
}

// Stopped as bounced with the reason, the status it had kept for a return, and a line in its history. Only from the
// status it was read with, so a run that overlaps another changes nothing twice.
async function stopContacts(domains, reason, limit, at) {
	const contacts = await findContactsOn(domains, STOPPABLE[reason], limit);
	if (contacts.length === 0) return 0;
	const { modifiedCount } = await Contact.bulkWrite(
		contacts.map((contact) => ({
			updateOne: {
				filter: { accountId: contact.accountId, _id: contact._id, status: contact.status },
				update: withStatusChange(
					{ $set: { undeliverableAt: at, undeliverableReason: reason, undeliverableFrom: contact.status } },
					{ from: contact.status, to: "bounced", at, via: "hygiene", reason }
				),
			},
		})),
		{ ordered: false }
	);
	return modifiedCount;
}

// Contacts stopped for this reason, back to the status they had now that their domain is fine again.
async function restoreContacts(domains, reason, at) {
	const contacts = await findContactsOn(domains, { status: "bounced", undeliverableReason: reason }, Number.MAX_SAFE_INTEGER);
	if (contacts.length === 0) return 0;
	const { modifiedCount } = await Contact.bulkWrite(
		contacts.map((contact) => {
			const to = STOPPABLE_STATUSES.includes(contact.undeliverableFrom) ? contact.undeliverableFrom : "active";
			return {
				updateOne: {
					filter: { accountId: contact.accountId, _id: contact._id, status: "bounced", undeliverableReason: reason },
					update: withStatusChange(
						{ $unset: { undeliverableAt: 1, undeliverableReason: 1, undeliverableFrom: 1 } },
						{ from: "bounced", to, at, via: "hygiene", reason }
					),
				},
			};
		}),
		{ ordered: false }
	);
	return modifiedCount;
}

// The domains of contacts stopped for being on a spam domain that the list no longer has.
async function findDelistedSpamDomains(lists) {
	const stopped = await Contact.aggregate([
		{ $match: { status: "bounced", undeliverableReason: "spam-domain" } },
		{ $group: { _id: DOMAIN_EXPRESSION } },
	]).option({ crossAccount: true });
	return stopped.map(({ _id }) => _id).filter((domain) => classifyDomain(domain, lists) !== "spam");
}

// What a DNS answer does to the domain's record. Unknown keeps what was known and asks again soon.
export function nextMailDomain(previous, verdict, now) {
	if (verdict === "ok") return { verdict: "ok", checkedAt: now, nextCheckAt: new Date(+now + RECHECK_OK_MS), noneChecks: 0, noneSince: null };
	if (verdict === "none") {
		const isRepeat = previous?.verdict === "none";
		const noneChecks = (isRepeat ? previous.noneChecks : 0) + 1;
		const noneSince = isRepeat ? previous.noneSince : now;
		const nextCheckAt = new Date(+now + (noneChecks >= 2 ? RECHECK_NONE_MS : CONFIRM_AFTER_MS));
		return { verdict: "none", checkedAt: now, nextCheckAt, noneChecks, noneSince };
	}
	return previous ? { ...previous, nextCheckAt: new Date(+now + CONFIRM_AFTER_MS) } : null;
}

export function isConfirmedWithoutMail(record, now) {
	return record?.verdict === "none" && record.noneChecks >= 2 && now - record.noneSince >= CONFIRM_AFTER_MS;
}

async function checkDomains(domains, checkDomain, { concurrency, budgetMs }, started) {
	const verdicts = new Map();
	for (let index = 0; index < domains.length; index += concurrency) {
		if (Date.now() - started > budgetMs) break;
		const group = domains.slice(index, index + concurrency);
		const answers = await Promise.all(group.map((domain) => checkDomain(domain).catch(() => "unknown")));
		group.forEach((domain, position) => verdicts.set(domain, answers[position]));
	}
	return verdicts;
}

// Each run (app/api/cron/list-hygiene, every 6 hours): contacts on spam domains stop (when that list is on), each domain with
// contacts is asked whether it takes email at most once a month, and contacts on a domain confirmed without mail stop,
// until a later check finds it working again. dryRun: looks things up and reports what would change, writing nothing.
// Logs and returns counts only.
export async function runListHygiene({ dryRun = false, now = new Date(), checkDomain = checkMailDomain, lists, limits = HYGIENE_LIMITS } = {}) {
	const started = Date.now();
	const report = {
		dryRun,
		domains: 0,
		checked: 0,
		ok: 0,
		none: 0,
		unknown: 0,
		stopped: { noMailServer: 0, spamDomain: 0 },
		restored: { noMailServer: 0, spamDomain: 0 },
		capped: false,
		suspicious: false,
	};
	let budget = limits.contactsPerRun;
	const countOn = (domains) => domains.reduce((sum, domain) => sum + (contactsByDomain.get(domain) ?? 0), 0);

	await connectDb();
	const domainLists = lists ?? (await getDomainLists());
	const contactDomains = (await listContactDomains()).filter(({ _id }) => _id && !isAllowlistedDomain(_id));
	const contactsByDomain = new Map(contactDomains.map(({ _id, contacts }) => [_id, contacts]));
	report.domains = contactDomains.length;

	const spamDomains = contactDomains.map(({ _id }) => _id).filter((domain) => classifyDomain(domain, domainLists) === "spam");
	if (dryRun) report.stopped.spamDomain = (await findContactsOn(spamDomains, STOPPABLE["spam-domain"], budget)).length;
	else report.stopped.spamDomain = await stopContacts(spamDomains, "spam-domain", budget, now);
	budget -= report.stopped.spamDomain;
	// Only against a list that loaded: an empty one would bring everyone back.
	if (!dryRun && domainLists.spam?.size > 0) {
		report.restored.spamDomain = await restoreContacts(await findDelistedSpamDomains(domainLists), "spam-domain", now);
	}

	const isSpam = new Set(spamDomains);
	// Busiest domains first, so the first runs over a large base cover most of its contacts.
	const names = [...contactsByDomain.keys()]
		.filter((domain) => !isSpam.has(domain))
		.sort((a, b) => contactsByDomain.get(b) - contactsByDomain.get(a));
	const records = new Map((await MailDomain.find({}).lean()).map((record) => [record.domain, record]));
	// Domains whose contacts all stopped are asked again too, so they can come back.
	const isListed = new Set(names);
	const rechecks = [...records.values()].filter(({ domain, verdict, nextCheckAt }) => verdict === "none" && nextCheckAt <= now && !isListed.has(domain));
	const due = [...names.filter((domain) => !records.get(domain) || records.get(domain).nextCheckAt <= now), ...rechecks.map(({ domain }) => domain)];
	const verdicts = await checkDomains(due.slice(0, limits.domainsPerRun), checkDomain, limits, started);
	const answers = [...verdicts.values()];
	const isSuspicious = answers.length >= SUSPICIOUS_MIN_CHECKED && answers.filter((verdict) => verdict === "none").length / answers.length > SUSPICIOUS_NONE_SHARE;
	if (isSuspicious) {
		report.checked = answers.length;
		report.suspicious = true;
		console.warn(`[list-hygiene] ${JSON.stringify(report)}: too many domains without mail at once, nothing changed`);
		return report;
	}

	const writes = [];
	const cameBack = [];
	for (const [domain, verdict] of verdicts) {
		report.checked++;
		report[verdict]++;
		const previous = records.get(domain);
		const next = nextMailDomain(previous, verdict, now);
		if (!next) continue;
		if (verdict === "ok" && previous?.verdict === "none") cameBack.push(domain);
		records.set(domain, { ...next, domain });
		const { verdict: nextVerdict, checkedAt, nextCheckAt, noneChecks, noneSince } = next;
		writes.push({
			updateOne: {
				filter: { domain },
				update: { $set: { verdict: nextVerdict, checkedAt, nextCheckAt, noneChecks, noneSince } },
				upsert: true,
			},
		});
	}

	const confirmed = names.filter((domain) => isConfirmedWithoutMail(records.get(domain), now));
	if (dryRun) {
		// A first answer can't stop anyone yet: these are the contacts a second one, a day later, would stop.
		report.stopped.noMailServer = Math.min(budget, countOn(names.filter((domain) => records.get(domain)?.verdict === "none")));
	} else {
		if (writes.length > 0) await MailDomain.bulkWrite(writes, { ordered: false });
		report.stopped.noMailServer = await stopContacts(confirmed, "no-mail-server", budget, now);
		report.restored.noMailServer = await restoreContacts(cameBack, "no-mail-server", now);
	}
	budget -= report.stopped.noMailServer;
	report.capped = budget <= 0 || verdicts.size < due.length;
	console.info(`[list-hygiene] ${JSON.stringify(report)}`);
	return report;
}
