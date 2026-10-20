import "server-only";
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import AttentionDismissal, { ATTENTION_KINDS } from "@/models/AttentionDismissal";

const HISTORY_KEPT = 20;

const toKey = (kind, id) => `${kind}:${id}`;

// The dismissals of these items ({ kind, id }), by "kind:id".
export async function findDismissals(items) {
	await connectDb();
	const byKind = Object.fromEntries(ATTENTION_KINDS.map((kind) => [kind, []]));
	for (const { kind, id } of items) if (byKind[kind] && mongoose.isValidObjectId(id)) byKind[kind].push(new mongoose.Types.ObjectId(String(id)));
	const filters = Object.entries(byKind)
		.filter(([, ids]) => ids.length > 0)
		.map(([kind, ids]) => ({ kind, targetId: { $in: ids } }));
	if (filters.length === 0) return new Map();
	const dismissals = await AttentionDismissal.find({ $or: filters }).lean();
	return new Map(dismissals.map((dismissal) => [toKey(dismissal.kind, dismissal.targetId), dismissal]));
}

export function getDismissal(dismissals, kind, id) {
	return dismissals.get(toKey(kind, id)) ?? null;
}

// Set aside until it happens again: an item whose time is past the one it had when dismissed is back.
export function isDismissed(dismissal, at) {
	if (!dismissal) return false;
	const dismissedFor = dismissal.itemAt ?? dismissal.dismissedAt;
	return !at || !dismissedFor || new Date(at).getTime() <= new Date(dismissedFor).getTime();
}

// itemAt: the item's time as the admin saw it. A second dismissal replaces the first; history keeps both.
export async function saveDismissal({ kind, targetId, itemAt, by, now = new Date() }) {
	await connectDb();
	const entry = { itemAt: itemAt ?? null, dismissedAt: now, dismissedBy: by };
	await AttentionDismissal.updateOne(
		{ kind, targetId },
		{ $set: entry, $push: { history: { $each: [entry], $slice: -HISTORY_KEPT } } },
		{ upsert: true }
	);
}
