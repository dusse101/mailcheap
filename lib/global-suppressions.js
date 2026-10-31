import "server-only";
import crypto from "node:crypto";
import { getSuppressionHashKey } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { getDeliveryEmail } from "@/lib/email-aliases";
import { moveContacts, withStatusChange } from "@/lib/status-changes";
import { normalizeEmail } from "@/lib/validation";
import Contact from "@/models/Contact";
import GlobalSuppression from "@/models/GlobalSuppression";

// What imports, signups and sends say about a listed address, whichever account's email found it.
export const UNDELIVERABLE_MESSAGE = "This address can't receive email";
const BOUNCE_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

// Keyed, since a plain hash of an email is easy to reverse with a list of emails.
function getHashKey() {
	return Buffer.from(crypto.hkdfSync("sha256", getSuppressionHashKey(), "", "mailcheap-global-suppression-v1", 32));
}

function hashEmail(key, email) {
	const address = getDeliveryEmail(email) ?? String(email ?? "").trim().toLowerCase();
	return crypto.createHmac("sha256", key).update(address).digest("base64url");
}

// MongoDB's TTL monitor deletes an expired entry within a minute or so, not at once.
function isCurrent(now = new Date()) {
	return { expiresAt: { $not: { $lte: now } } };
}

// From one provider event (lib/email-events.js): addresses it says don't exist, or a spam trap's. A bounce leaves 180
// days after it and never shortens a trap's stay, which has no end.
export async function suppressGlobally({ emails, reason, detail, at = new Date() }) {
	if (emails.length === 0) return;
	await connectDb();
	const key = getHashKey();
	const expiresAt = new Date(at.getTime() + BOUNCE_DAYS * DAY_MS);
	await GlobalSuppression.bulkWrite(
		emails.map((email) => ({
			updateOne: {
				filter: { emailHash: hashEmail(key, email) },
				update: reason === "trap" ? { $set: { reason, detail }, $unset: { expiresAt: 1 } } : { $setOnInsert: { reason, detail, expiresAt } },
				upsert: true,
			},
		}))
	);
}

// The ones of these addresses on the list, in one indexed read however many there are.
export async function findGloballySuppressed(emails) {
	const unique = [...new Set(emails)];
	if (unique.length === 0) return new Set();
	await connectDb();
	const key = getHashKey();
	const hashes = unique.map((email) => hashEmail(key, email));
	const listed = new Set(await GlobalSuppression.distinct("emailHash", { emailHash: { $in: [...new Set(hashes)] }, ...isCurrent() }));
	return new Set(unique.filter((_, index) => listed.has(hashes[index])));
}

// A send skipped it: the contact shows as bounced, marked so its account sees why it got nothing.
export function markUndeliverable(accountId, contactId) {
	const at = new Date();
	return Contact.updateOne(
		{ accountId, _id: contactId, status: "active" },
		withStatusChange({ $set: { undeliverableAt: at } }, { from: "active", to: "bounced", at, via: "undeliverable" })
	);
}

export async function getGlobalSuppression(email) {
	await connectDb();
	return GlobalSuppression.findOne({ emailHash: hashEmail(getHashKey(), email), ...isCurrent() })
		.select({ _id: 0, reason: 1, detail: 1, createdAt: 1, expiresAt: 1 })
		.lean();
}

export async function countGlobalSuppressions() {
	await connectDb();
	const [bounces, traps] = await Promise.all([
		GlobalSuppression.countDocuments({ reason: "bounce", ...isCurrent() }),
		GlobalSuppression.countDocuments({ reason: "trap" }),
	]);
	return { bounces, traps };
}

// An admin taking a wrong entry off. The contacts it stopped with this address, in every account, are active again;
// those the list hygiene stopped for their domain stay stopped. Null when it wasn't on the list.
export async function removeGlobalSuppression(email) {
	await connectDb();
	const { deletedCount } = await GlobalSuppression.deleteOne({ emailHash: hashEmail(getHashKey(), email) });
	if (deletedCount === 0) return null;
	const emails = [...new Set([normalizeEmail(email), getDeliveryEmail(email)].filter(Boolean))];
	const restored = await moveContacts(
		{ email: { $in: emails }, undeliverableAt: { $exists: true }, undeliverableReason: { $exists: false } },
		{ from: ["bounced"], to: "active", via: "admin", update: { $unset: { undeliverableAt: 1 } }, options: { crossAccount: true } }
	);
	return { restored };
}
