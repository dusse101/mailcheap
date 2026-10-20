import mongoose from "mongoose";

export const ATTENTION_KINDS = ["alert", "account", "campaign"];

// An admin set aside an item of the admin page's "Needs a look" (lib/admin-alerts.js): an alert, a blocked account or
// a paused campaign, as it stood at itemAt. When it happens again (a later itemAt), it comes back. history keeps the
// last dismissals, who and when.
const dismissalSchema = new mongoose.Schema(
	{
		kind: { type: String, enum: ATTENTION_KINDS, required: true },
		targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
		itemAt: { type: Date },
		dismissedAt: { type: Date },
		dismissedBy: { type: String },
		history: {
			type: [{ _id: false, itemAt: Date, dismissedAt: Date, dismissedBy: String }],
			default: undefined,
		},
	},
	{ timestamps: true }
);

dismissalSchema.index({ kind: 1, targetId: 1 }, { unique: true });

export default mongoose.models.AttentionDismissal || mongoose.model("AttentionDismissal", dismissalSchema);
