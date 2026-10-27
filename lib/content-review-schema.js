import mongoose from "mongoose";

// What the automated content check (lib/content-review.js) found in some content, for the content it read (hash), and
// an admin's decision when it held it. Where it's kept, it's never read unless asked for (select: false): its reasons
// are for admins only.
export const contentReviewSchema = new mongoose.Schema(
	{
		hash: { type: String },
		outcome: { type: String, enum: ["allow", "flag", "block", "error"] },
		verdict: { type: String },
		categories: { type: [String], default: undefined },
		reasons: { type: [String], default: undefined },
		confidence: { type: Number },
		scores: { type: Map, of: Number },
		model: { type: String },
		// What its author sees of it before a send, unless it holds the content: words that tend to land email in spam.
		tips: { type: [new mongoose.Schema({ field: String, quote: String, tip: String }, { _id: false })], default: undefined },
		checkedAt: { type: Date },
		// Another of the account's issues with the same content and rules, whose check (or approval) this one reuses.
		reusedFrom: { type: mongoose.Schema.Types.ObjectId },
		decision: { type: String, enum: ["approved", "rejected"] },
		decidedBy: { type: String },
		decidedAt: { type: Date },
		note: { type: String },
	},
	{ _id: false }
);
