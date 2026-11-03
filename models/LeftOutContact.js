import mongoose from "mongoose";
import { accountScoped } from "../lib/account-scope.js";

// An address an import left out (lib/contact-import.js), with the reason, so its account sees who and can bring back
// the ones MailCheap only judged from the address (BRING_BACK_REASONS in lib/import-checks.js): those keep the contact
// the import would have added. Each expires after a week, like the import's chunks.
const leftOutContactSchema = new mongoose.Schema(
	{
		importId: { type: mongoose.Schema.Types.ObjectId, ref: "ContactImport", required: true },
		newsletterId: { type: mongoose.Schema.Types.ObjectId, ref: "Newsletter", required: true },
		email: { type: String, required: true },
		reason: { type: String, required: true },
		// The list shows these first.
		canBringBack: { type: Boolean, required: true },
		contact: { type: mongoose.Schema.Types.Mixed },
		broughtBackAt: { type: Date },
	},
	{ timestamps: { createdAt: true, updatedAt: false } }
);

leftOutContactSchema.plugin(accountScoped);
leftOutContactSchema.index({ accountId: 1, importId: 1, email: 1 }, { unique: true });
leftOutContactSchema.index({ accountId: 1, importId: 1, canBringBack: -1, email: 1 });
leftOutContactSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

export default mongoose.models.LeftOutContact || mongoose.model("LeftOutContact", leftOutContactSchema);
