import { DISPOSABLE_DOMAINS } from "./disposable-domains.js";
import { mailboxProvider } from "./providers.js";

// Domains real people sign up with. No downloaded list can mark them, whatever it says: StopForumSpam's lists include
// privacy relays and ISP mailboxes, because spammers use them too.
const PROVIDER_ALLOWLIST = new Set([
	// Mailbox providers
	"126.com",
	"139.com",
	"163.com",
	"aim.com",
	"aliyun.com",
	"aol.com",
	"bk.ru",
	"daum.net",
	"fastmail.com",
	"fastmail.fm",
	"foxmail.com",
	"free.fr",
	"gmx.at",
	"gmx.ch",
	"gmx.co.uk",
	"gmx.com",
	"gmx.de",
	"gmx.fr",
	"gmx.net",
	"gmx.us",
	"hanmail.net",
	"hey.com",
	"hotmail.de",
	"hotmail.es",
	"hotmail.it",
	"hushmail.com",
	"inbox.ru",
	"interia.pl",
	"keemail.me",
	"laposte.net",
	"libero.it",
	"list.ru",
	"live.co.uk",
	"mail.com",
	"mail.ru",
	"mail.ua",
	"mailbox.org",
	"nate.com",
	"naver.com",
	"o2.pl",
	"onet.pl",
	"op.pl",
	"orange.fr",
	"outlook.de",
	"outlook.es",
	"posteo.de",
	"posteo.net",
	"qq.com",
	"rambler.ru",
	"rediffmail.com",
	"seznam.cz",
	"sfr.fr",
	"sina.cn",
	"sina.com",
	"sohu.com",
	"tuta.com",
	"tuta.io",
	"tutamail.com",
	"tutanota.com",
	"tutanota.de",
	"ukr.net",
	"virgilio.it",
	"wanadoo.fr",
	"web.de",
	"wp.pl",
	"ya.ru",
	"yahoo.ca",
	"yahoo.co.jp",
	"yahoo.com.br",
	"yahoo.de",
	"yahoo.es",
	"yahoo.it",
	"yandex.com",
	"yandex.ru",
	"yandex.ua",
	"yeah.net",
	"zoho.com",
	"zohomail.com",
	// mail.com's other domains
	"accountant.com",
	"asia.com",
	"cheerful.com",
	"consultant.com",
	"dr.com",
	"email.com",
	"engineer.com",
	"europe.com",
	"iname.com",
	"myself.com",
	"post.com",
	"techie.com",
	"usa.com",
	"writeme.com",
	// Privacy relays: forwarding addresses people keep, not throwaway inboxes
	"33mail.com",
	"8alias.com",
	"8shield.net",
	"addy.io",
	"addymail.com",
	"aleeas.com",
	"anonaddy.com",
	"anonaddy.me",
	"dralias.com",
	"duck.com",
	"manyme.com",
	"mozmail.com",
	"passfwd.com",
	"passinbox.com",
	"passmail.com",
	"passmail.net",
	"privaterelay.appleid.com",
	"silomails.com",
	"simplelogin.co",
	"simplelogin.com",
	"simplelogin.fr",
	"slmail.me",
	"slmails.com",
	// Internet providers and carriers
	"ameritech.net",
	"arcor.de",
	"alice.it",
	"att.net",
	"bell.net",
	"bellsouth.net",
	"bigpond.com",
	"bluewin.ch",
	"btinternet.com",
	"centurylink.net",
	"charter.net",
	"comcast.net",
	"cox.net",
	"earthlink.net",
	"embarqmail.com",
	"freenet.de",
	"frontier.com",
	"frontiernet.net",
	"home.nl",
	"iinet.net.au",
	"juno.com",
	"kpnmail.nl",
	"mindspring.com",
	"netzero.net",
	"optimum.net",
	"optonline.net",
	"optusnet.com.au",
	"pacbell.net",
	"planet.nl",
	"prodigy.net",
	"q.com",
	"roadrunner.com",
	"rogers.com",
	"rr.com",
	"sbcglobal.net",
	"shaw.ca",
	"skynet.be",
	"spectrum.net",
	"swbell.net",
	"sympatico.ca",
	"t-online.de",
	"telenet.be",
	"tiscali.it",
	"tmomail.net",
	"verizon.net",
	"videotron.ca",
	"windstream.net",
	"xfinity.com",
	"xs4all.nl",
	"xtra.co.nz",
	"ziggo.nl",
]);

const DOMAIN_PATTERN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

// StopForumSpam's terms allow non-commercial use only: its spam domains stay off until it waives that for this install.
export function isSpamListEnabled() {
	return process.env.STOPFORUMSPAM_COMMERCIAL_OK === "1";
}

export function isAllowlistedDomain(domain) {
	return PROVIDER_ALLOWLIST.has(domain) || mailboxProvider(`x@${domain}`) !== "other";
}

// A downloaded list, one domain per line: lowercase, comments and blank lines skipped, providers never kept.
export function parseDomainList(text) {
	const domains = new Set();
	let invalid = 0;
	for (const raw of String(text).split("\n")) {
		const line = raw.trim().toLowerCase();
		if (!line || line.startsWith("#")) continue;
		if (!DOMAIN_PATTERN.test(line)) invalid += 1;
		else if (!isAllowlistedDomain(line)) domains.add(line);
	}
	return { domains: [...domains].sort(), invalid };
}

// Why a download shouldn't replace the list in use, or null: too small, mostly junk, or far shorter than the last
// one, which is how a broken or poisoned file looks.
export function getDomainListProblem({ domains, invalid }, { minCount, previousCount = 0 }) {
	if (domains.length < minCount) return `only ${domains.length} domains, expected at least ${minCount}`;
	if (invalid > domains.length * 0.05) return `${invalid} lines aren't domains`;
	if (previousCount > 0 && domains.length < previousCount * 0.7) return `${domains.length} domains, down from ${previousCount}`;
	return null;
}

// Throwaway inboxes match with their subdomains; spam domains match by exact name, as their list says to.
export function classifyDomain(domain, lists = {}) {
	const name = String(domain ?? "").trim().toLowerCase();
	if (!name || isAllowlistedDomain(name)) return null;
	if (lists.spam?.has(name)) return "spam";
	const labels = name.split(".");
	const isDisposable = labels.some((_, index) => {
		const suffix = labels.slice(index).join(".");
		return DISPOSABLE_DOMAINS.has(suffix) || lists.disposable?.has(suffix);
	});
	return isDisposable ? "disposable" : null;
}
