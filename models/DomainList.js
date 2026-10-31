import mongoose from "mongoose";

// A downloaded domain list in use (lib/domain-lists.js), one document per list: the last download that passed its
// checks, so a failed or broken one never empties it.
const domainListSchema = new mongoose.Schema(
	{
		_id: { type: String },
		domains: { type: [String], default: [] },
		count: { type: Number, default: 0 },
		sourceUrl: { type: String },
		fetchedAt: { type: Date },
	},
	{ timestamps: true }
);

export default mongoose.models.DomainList || mongoose.model("DomainList", domainListSchema);
