import mongoose from "mongoose";

// One document per alert kind and account: lastSentAt enforces the cooldown between repeated alerts, and
// telegramSentAt Telegram's. Platform alerts (the rate limiter) have no account.
// Since Oct 20, 2026, every time it fires counts, cooldown or not: lastSeenAt, count, and the last occurrences with
// what they said, addresses masked (lib/alerts.js), for the admin page.
const alertSchema = new mongoose.Schema(
	{
		accountId: { type: mongoose.Schema.Types.ObjectId, ref: "Account" },
		key: { type: String, required: true },
		title: { type: String },
		lastSentAt: { type: Date },
		telegramSentAt: { type: Date },
		lastSeenAt: { type: Date },
		count: { type: Number },
		occurrences: {
			type: [{ _id: false, at: Date, detail: String, action: String, emailed: Boolean, telegram: Boolean }],
			default: undefined,
		},
	},
	{ timestamps: true }
);

alertSchema.index({ accountId: 1, key: 1 }, { unique: true });

export default mongoose.models.Alert || mongoose.model("Alert", alertSchema);
