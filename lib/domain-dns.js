import "server-only";
import { ACCESS_FIELDS, getAccountSendProblem } from "@/lib/account-state";
import { sendAlert } from "@/lib/alerts";
import { readRecords } from "@/lib/dns-check";
import {
	DNS_FRESH_MINUTES,
	DNS_RECHECK_HOURS,
	getDnsProblemMessage,
	getRecordLookups,
	getRecordState,
	isDnsStale,
	mergeDnsProblems,
} from "@/lib/domain-dns-rules";
import { getEmailDomain, withActiveProvider } from "@/lib/sender-rules";
import Account from "@/models/Account";
import Domain from "@/models/Domain";

async function readRecordState(record) {
	const lookups = Object.entries(getRecordLookups(record));
	const answers = await Promise.all(lookups.map(([, [host, type]]) => readRecords(host, type)));
	return getRecordState(record, Object.fromEntries(lookups.map(([key], index) => [key, answers[index]])));
}

// Looks up the domain's sending records and saves what's wrong with them; a record whose lookup failed keeps its last
// state, so a resolver down neither stops nor frees a domain. A verified domain they stop from sending tells its owner.
export async function checkDomainDns(domain) {
	const records = domain.records ?? [];
	const states = await Promise.all(records.map(readRecordState));
	const dns = { checkedAt: new Date(), problems: mergeDnsProblems(records, states, domain.dns?.problems) };
	await Domain.updateOne({ accountId: domain.accountId, _id: domain._id }, { $set: { dns } });
	const checked = { ...domain, dns };
	if (withActiveProvider(domain).verified && !withActiveProvider(checked).verified) await alertStopped(checked);
	return checked;
}

// An account that can't send anyway, blocked or without a plan, isn't told.
async function alertStopped(domain) {
	const account = await Account.findById(domain.accountId).select({ ...ACCESS_FIELDS, status: 1 }).lean();
	if (!account || getAccountSendProblem(account)) return;
	await sendAlert({
		accountId: domain.accountId,
		key: `domain-dns-${domain._id}`,
		title: `Sending from ${domain.domain} stopped`,
		detail: getDnsProblemMessage(domain.domain, withActiveProvider(domain).dnsProblems),
		action: "Then click Check now on the Domains page. Until then nothing goes out from it, and a campaign sending from it pauses.",
		path: "/domains",
		cooldownMinutes: DNS_RECHECK_HOURS * 60,
		domain: domain.domain,
	});
}

// Before a test or a send from a domain of the account's own.
export async function checkSenderDns(account, newsletter) {
	const domain = await Domain.findOne({ accountId: account._id, domain: getEmailDomain(newsletter?.fromEmail) }).lean();
	if (domain?.verified && isDnsStale(domain, DNS_FRESH_MINUTES)) await checkDomainDns(domain);
}
