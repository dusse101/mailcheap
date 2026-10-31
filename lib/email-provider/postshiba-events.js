import crypto from "node:crypto";
import { isObjectIdString, isPlainObject, normalizeAddress } from "../validation.js";

// PostShiba signs each delivery with X-Capsule-Signature: "sha256=" + hex HMAC-SHA256 of "{timestamp}.{body}",
// keyed with the endpoint's secret. Each retry is signed again, so an old timestamp is a replay.
export const MAX_SIGNATURE_AGE_SECONDS = 300;

export function verifyPostshibaSignature({ body, timestamp, signature, secret, now = Date.now() }) {
	if (!secret || typeof timestamp !== "string" || !/^\d{1,12}$/.test(timestamp)) return false;
	if (typeof signature !== "string" || !signature.startsWith("sha256=")) return false;
	if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > MAX_SIGNATURE_AGE_SECONDS) return false;
	const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest();
	const given = Buffer.from(signature.slice("sha256=".length), "hex");
	return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

const EVENT_TYPES = {
	processed: "sent",
	delivered: "delivered",
	deferred: "deferred",
	bounce: "bounce",
	dropped: "dropped",
	spamreport: "complaint",
	unsubscribe: "unsubscribe",
};

// Drops of addresses PostShiba already suppresses for the tenant, in SendGrid's words or PostShiba's.
const SUPPRESSED_DROP = /suppress|bounced address|unsubscribed address|spam reporting address/i;
// PostShiba's class for a mailbox or host that doesn't exist, or a mailbox that moved. Its other classes (a full or
// disabled mailbox, the sender's reputation, the content, volume, the network) aren't the address's fault for good.
const INVALID_ADDRESS = "invalid address";

function readText(value) {
	return typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null;
}

// PostShiba writes a message's id as 32 hex characters, except on late bounces and spam reports, which come without the
// unique args: there it's the same id as a hyphenated UUID. One form for both, so those still find their email.
function readMessageId(value) {
	const text = readText(value);
	return text && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(text) ? text.replace(/-/g, "").toLowerCase() : text;
}

function readId(...values) {
	const value = values.find((item) => typeof item === "string");
	return isObjectIdString(value) ? value.toLowerCase() : null;
}

function toDate(seconds) {
	const date = Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
	return date && Number.isFinite(date.getTime()) ? date : null;
}

// type "bounce" is a bad address; "blocked" is a refusal of this message. A message that expired, or that a flush of its
// domain's queue dropped, isn't the address's fault.
function getBounceType(event) {
	return event.type === "bounce" && !/expired|flushed by sender/i.test(event.reason ?? "") ? "hard" : "soft";
}

// A 4.x.x status is temporary, whatever the class says.
function isUndeliverable(event) {
	return readText(event.bounce_classification)?.toLowerCase() === INVALID_ADDRESS && !readText(event.status)?.startsWith("4.");
}

// Pure: one event of PostShiba's SendGrid-format array in the shape every provider's events take
// (lib/email-event-rules.js). The account and message come from the unique args every send carries.
export function normalizePostshibaEvent(event) {
	if (!isPlainObject(event) || !Object.hasOwn(EVENT_TYPES, event.event)) return null;
	const args = isPlainObject(event.unique_args) ? event.unique_args : {};
	const email = normalizeAddress(event.email);
	const reason = [readText(event.bounce_classification), readText(event.reason) ?? readText(event.response)].filter(Boolean).join(", ");
	const normalized = {
		type: EVENT_TYPES[event.event],
		recordAs: event.event,
		accountId: readId(args.account_id, event.account_id),
		messageId: readId(args.message_id, event.message_id),
		providerMessageId: readMessageId(event.sg_message_id),
		providerEventId: readText(event.sg_event_id),
		tenant: readText(event.tenant_id),
		email,
		emails: email ? [email] : [],
		occurredAt: toDate(event.timestamp) ?? new Date(),
		data: event,
	};
	if (event.event === "bounce") {
		const bounce = getBounceType(event);
		Object.assign(normalized, {
			bounce,
			undeliverable: bounce === "hard" && isUndeliverable(event),
			reason: reason || null,
			detail: `${readText(event.type) ?? "bounce"}/${readText(event.status) ?? readText(event.bounce_classification) ?? "unknown"}`,
		});
	}
	// PostShiba keeps the server's enhanced code apart from its words.
	if (event.event === "deferred") normalized.reason = [readText(event.status), reason].filter(Boolean).join(" ") || null;
	if (event.event === "spamreport") normalized.detail = readText(event.attribution) ? `spamreport (${event.attribution})` : "spamreport";
	if (event.event === "dropped") {
		normalized.error = `Dropped by PostShiba: ${reason || "no reason given"}`;
		normalized.suppressed = SUPPRESSED_DROP.test(reason);
	}
	return normalized;
}
