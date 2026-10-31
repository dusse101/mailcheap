import mongoose from "mongoose";

// What DNS said about a subscriber's domain at the list hygiene's last look (lib/list-hygiene.js), shared by every
// account. none: no mail server, in a row since noneSince; contacts only stop after two such answers a day apart.
const mailDomainSchema = new mongoose.Schema(
	{
		domain: { type: String, required: true, unique: true },
		verdict: { type: String, enum: ["ok", "none"], required: true },
		checkedAt: { type: Date, required: true },
		nextCheckAt: { type: Date, required: true },
		noneSince: { type: Date },
		noneChecks: { type: Number, default: 0 },
	},
	{ timestamps: true }
);

mailDomainSchema.index({ verdict: 1, nextCheckAt: 1 });

export default mongoose.models.MailDomain || mongoose.model("MailDomain", mailDomainSchema);
