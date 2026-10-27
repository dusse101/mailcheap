import mongoose from "mongoose";

// When a sending domain was registered, as its registry's RDAP record says (lib/domain-age.js), shared by every account:
// none when no registry said, asked again from recheckAt.
const domainRegistrationSchema = new mongoose.Schema(
	{
		domain: { type: String, required: true, unique: true },
		registeredAt: { type: Date },
		checkedAt: { type: Date, required: true },
		recheckAt: { type: Date, required: true },
	},
	{ timestamps: true }
);

export default mongoose.models.DomainRegistration || mongoose.model("DomainRegistration", domainRegistrationSchema);
