import { LIMITS } from "./config.js";
import { findContentWarnings } from "./content-warnings.js";
import { findBrokenMergeTags, withMergeFallbacks } from "./merge-tags.js";
import { sendsEmail } from "./publish-to.js";
import { UNSUBSCRIBE_PLACEHOLDER, findButtonProblem, hasContent } from "./render-email.js";

// The email's checks, or for a web-only issue (campaign.publishTo, lib/publish-to.js) what its page needs: no email goes
// out, so the sender, footer, size, test email and plan emails don't matter, but the website has to be on.
const WEB_ONLY_SKIPPED = new Set(["unsubscribe", "size", "address", "domain", "test", "plan", "sending"]);

// contactFields: the account's fields, whose tags are filled in like {{first_name}}. contentWarnings: getContentWarnings'
// for the campaign, when they're read apart from typing, as they never stop a send.
export function getPresendChecks({
	campaign,
	newsletter,
	rendered,
	contactFields = [],
	senderProblem = null,
	isSharedSender = false,
	isSendingEnabled,
	planProblem = null,
	contentWarnings = getContentWarnings({ ...campaign, contactFields }),
}) {
	const checks = getEmailChecks({
		campaign,
		newsletter,
		rendered,
		contactFields,
		senderProblem,
		isSharedSender,
		isSendingEnabled,
		planProblem,
		contentWarnings,
	});
	if (sendsEmail(campaign)) return withBlocking(checks);
	return withBlocking([
		...checks.filter(({ id }) => !WEB_ONLY_SKIPPED.has(id)),
		{ id: "website", label: "Website on", isOk: Boolean(newsletter.archiveEnabled), message: "Turn on your website to publish on it" },
	]);
}

function withBlocking(checks) {
	return { checks, blocking: checks.filter(({ isOk, isWarning }) => !isOk && !isWarning) };
}

// What may look broken in an issue, to check before it goes out, each { id, label, message, count, words, field }:
// merge tags that go out as written, then its content's (lib/content-warnings.js). words are what to select to fix it, in
// field (subject, previewText or content). body: the editor's HTML, Markdown drafts included, or for format "html" an
// email designed elsewhere.
export function getContentWarnings({ subject, previewText, body, format, contactFields = [] }) {
	// Each email fills in its unsubscribe link, wherever it is.
	const brokenTags = findBrokenMergeTags([subject, previewText, body], contactFields).filter((tag) => tag !== UNSUBSCRIBE_PLACEHOLDER);
	const [tag] = brokenTags;
	return [
		...(tag
			? [
					{
						id: "merge-tags",
						label: "Merge tags",
						message: `${tag} goes out as written: only {{first_name}} and your contact fields are filled in`,
						count: brokenTags.length,
						words: tag,
						field: subject?.includes(tag) ? "subject" : previewText?.includes(tag) ? "previewText" : "content",
					},
				]
			: []),
		...findContentWarnings(body, { isDesigned: format === "html" }),
	];
}

function getEmailChecks({
	campaign,
	newsletter,
	rendered,
	contactFields,
	senderProblem,
	isSharedSender,
	isSendingEnabled,
	planProblem,
	contentWarnings,
}) {
	const subject = campaign.subject?.trim() ?? "";
	// What inboxes show for a reader without a first name or field values, rather than the tags' own length.
	const subjectLength = withMergeFallbacks(subject, { contactFields }).length;
	// The editor's HTML, Markdown drafts included; an HTML email designed elsewhere has no buttons of ours.
	const buttonProblem = campaign.format === "html" ? null : findButtonProblem(campaign.body);
	const warnings = contentWarnings.map(({ count, ...warning }) => ({
		...warning,
		isOk: false,
		isWarning: true,
		detail: count > 1 ? String(count) : null,
	}));

	const checks = [
		{ id: "subject", label: "Subject", isOk: subject.length > 0, message: "Add a subject" },
		{
			id: "subject-length",
			label: "Subject under 70 characters",
			isOk: subjectLength <= 70,
			isWarning: true,
			detail: subjectLength ? String(subjectLength) : null,
		},
		{
			id: "preview",
			label: "Preview text",
			isOk: Boolean(campaign.previewText?.trim()),
			isWarning: true,
		},
		{ id: "content", label: "Content", isOk: hasContent(campaign.body), message: "Add content" },
		...(buttonProblem ? [{ id: "buttons", label: "Buttons", isOk: false, message: buttonProblem }] : []),
		...warnings,
		{
			id: "unsubscribe",
			label: "Unsubscribe link",
			isOk: rendered.html.includes(UNSUBSCRIBE_PLACEHOLDER),
			message: `Add ${UNSUBSCRIBE_PLACEHOLDER} to the HTML`,
		},
		{
			id: "size",
			label: "Under 100 KB",
			isOk: rendered.bytes <= LIMITS.maxEmailBytes,
			detail: `${Math.ceil(rendered.bytes / 1000)} KB`,
			message: "Gmail clips emails over 100 KB",
		},
		{
			id: "address",
			label: "Postal address",
			isOk: Boolean(newsletter.postalAddress?.trim()),
			message: "Add a postal address to the newsletter",
		},
		{
			id: "domain",
			label: "From address allowed",
			isOk: !senderProblem,
			message: senderProblem,
			detail: isSharedSender ? "Shared address" : null,
		},
		{ id: "test", label: "Test sent", isOk: Boolean(campaign.testSentAt), isWarning: true },
		// isAccount: about the account rather than the email, so the editor shows it above its steps, not in the checklist.
		{ id: "plan", label: "Within plan limits", isOk: !planProblem, message: planProblem, isAccount: true },
		{ id: "sending", label: "Sending on", isOk: isSendingEnabled, message: "Sending is off", isAccount: true },
	];

	return checks;
}
