import mongoose from "mongoose";
import { accountScoped } from "../lib/account-scope.js";

// A domain an account sends campaigns from, and how Gmail's readers are held back on it (lib/sender-warmup.js): Gmail
// judges each domain by its own history, whichever of the account's newsletters sends from it. When its days started,
// or none yet when its next send starts them, the Gmail emails of its first day, how many days (0: none, Gmail already
// knows it), and when Gmail last asked it to slow down (lib/send-backoff.js), which started them over.
const senderDomainSchema = new mongoose.Schema(
	{
		domain: { type: String, required: true, lowercase: true, trim: true },
		startedAt: { type: Date },
		firstDay: { type: Number, required: true },
		days: { type: Number, min: 0 },
		backoffAt: { type: Date },
	},
	{ timestamps: true }
);

senderDomainSchema.plugin(accountScoped);
senderDomainSchema.index({ accountId: 1, domain: 1 }, { unique: true });

export default mongoose.models.SenderDomain || mongoose.model("SenderDomain", senderDomainSchema);
