import "server-only";
import mongoose from "mongoose";
import { isEmailAllowed } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { getAliasPattern } from "@/lib/email-aliases";
import { getSpreadEnd } from "@/lib/send-spread";
import Account from "@/models/Account";
import Contact from "@/models/Contact";
import Newsletter from "@/models/Newsletter";

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const MAX_SEARCH_MATCHES = 200;

// Better Auth's collections. Its "account" model (sign-in methods) is renamed so it can't be mistaken for
// the Account model (a customer: plan, billing, usage).
export const AUTH_MODELS = {
	user: "users",
	session: "sessions",
	account: "auth_accounts",
	verification: "verifications",
};

function toObjectId(id) {
	return new mongoose.Types.ObjectId(String(id));
}

// Each user owns one account, created at their first sign-in (lib/auth.js). True when this call created it.
export async function createAccount(ownerId) {
	await connectDb();
	const id = toObjectId(ownerId);
	const { upsertedCount } = await Account.updateOne({ ownerId: id }, { $setOnInsert: { ownerId: id } }, { upsert: true });
	return upsertedCount > 0;
}

// The user's account, created here if their first sign-in didn't.
export async function ensureAccount(ownerId) {
	await createAccount(ownerId);
	return Account.findOne({ ownerId: toObjectId(ownerId) }).lean();
}

export async function findUser(userId) {
	await connectDb();
	return mongoose.connection.db
		.collection(AUTH_MODELS.user)
		.findOne({ _id: toObjectId(userId) }, { projection: { email: 1, emailVerified: 1 } });
}

// Another user whose address reaches the same inbox as this one (lib/email-aliases.js).
export async function findAliasUser(email) {
	const pattern = getAliasPattern(email);
	if (!pattern) return null;
	await connectDb();
	const own = String(email).toLowerCase();
	return mongoose.connection.db.collection(AUTH_MODELS.user).findOne({ email: { $regex: pattern, $ne: own } }, { projection: { email: 1 } });
}

export async function findUserByEmail(email) {
	await connectDb();
	return mongoose.connection.db.collection(AUTH_MODELS.user).findOne({ email }, { projection: { _id: 1 } });
}

// On a self-hosted server's allowlist (lib/config.js), with an email the user proved they own.
export function isUserAllowed(user) {
	return Boolean(user?.emailVerified) && isEmailAllowed(user.email);
}

// Signed in with Google before: the account page says they can sign in either way.
export async function hasGoogleSignIn(userId) {
	await connectDb();
	const google = await mongoose.connection.db
		.collection(AUTH_MODELS.account)
		.findOne({ userId: toObjectId(userId), providerId: "google" }, { projection: { _id: 1 } });
	return Boolean(google);
}

export async function findOwnerEmail(accountId) {
	await connectDb();
	const account = await Account.findById(accountId).select({ ownerId: 1 }).lean();
	if (!account) return null;
	const user = await mongoose.connection.db
		.collection(AUTH_MODELS.user)
		.findOne({ _id: account.ownerId }, { projection: { email: 1 } });
	return user?.email ?? null;
}

// An account's id, or part of its owner's email or of one of its newsletters' names, in any case. Newest matches first,
// so a broad search past MAX_SEARCH_MATCHES still finds the newest accounts.
async function findAccountIdsMatching(search) {
	if (OBJECT_ID_PATTERN.test(search)) return [search];
	const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
	const [owners, newsletters] = await Promise.all([
		mongoose.connection.db
			.collection(AUTH_MODELS.user)
			.find({ email: pattern }, { projection: { _id: 1 } })
			.sort({ _id: -1 })
			.limit(MAX_SEARCH_MATCHES)
			.toArray(),
		Newsletter.find({ name: pattern }).select({ accountId: 1 }).sort({ _id: -1 }).limit(MAX_SEARCH_MATCHES).setOptions({ crossAccount: true }).lean(),
	]);
	const byOwner = await Account.distinct("_id", { ownerId: { $in: owners.map(({ _id }) => _id) } });
	return [...new Set([...byOwner, ...newsletters.map((newsletter) => newsletter.accountId)].map(String))];
}

// Newest first, with the owner's email and active contacts, for the admin list. accountId: that account alone, however
// old it is; search: the accounts it matches (findAccountIdsMatching).
export async function listAccountsForAdmin({ limit = 50, accountId, search } = {}) {
	await connectDb();
	const text = String(search ?? "").trim();
	const ids = accountId ? [accountId] : text ? await findAccountIdsMatching(text) : null;
	if (ids?.length === 0) return [];
	return Account.aggregate([
		...(ids ? [{ $match: { _id: { $in: ids.map(toObjectId) } } }] : []),
		{ $sort: { createdAt: -1 } },
		{ $limit: limit },
		{
			$lookup: {
				from: AUTH_MODELS.user,
				localField: "ownerId",
				foreignField: "_id",
				pipeline: [{ $project: { email: 1 } }],
				as: "owner",
			},
		},
		{
			$lookup: {
				from: Contact.collection.collectionName,
				localField: "_id",
				foreignField: "accountId",
				pipeline: [{ $match: { status: "active" } }, { $count: "count" }],
				as: "active",
			},
		},
		{
			$set: {
				ownerEmail: { $first: "$owner.email" },
				activeContacts: { $ifNull: [{ $first: "$active.count" }, 0] },
			},
		},
		// Aggregations ignore the schema's select: false.
		{ $unset: ["owner", "active", "postshiba.bulkCredential.password"] },
	]);
}

// On: the 30-day warm-up starts again. Off: it ends now, and only a send over 5 times what the account proved is paced
// (lib/send-spread.js).
export async function setSendSpread(accountId, isOn) {
	await connectDb();
	const { matchedCount } = await Account.updateOne({ _id: accountId }, { $set: { spreadUntil: isOn ? getSpreadEnd() : new Date() } });
	return matchedCount > 0;
}

// Empty values go back to the plan's numbers.
export async function setLimitOverrides(accountId, { emailsPerMonth, subscribers }) {
	await connectDb();
	const set = {};
	const unset = {};
	for (const [key, value] of Object.entries({ emailsPerMonth, subscribers })) {
		if (value === undefined) unset[`limitOverrides.${key}`] = 1;
		else set[`limitOverrides.${key}`] = value;
	}
	const { matchedCount } = await Account.updateOne(
		{ _id: accountId },
		{ ...(Object.keys(set).length > 0 && { $set: set }), ...(Object.keys(unset).length > 0 && { $unset: unset }) }
	);
	return matchedCount > 0;
}
