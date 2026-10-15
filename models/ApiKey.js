import mongoose from "mongoose";
import { accountScoped } from "../lib/account-scope.js";

export const API_KEY_LEVELS = ["full", "signups", "read"];

const apiKeySchema = new mongoose.Schema(
	{
		name: { type: String, required: true, trim: true },
		prefix: { type: String, required: true },
		// The key itself is the lookup: unique across accounts, and it decides the account.
		hash: { type: String, required: true, unique: true },
		// full: every customer action. signups: only adding contacts, for keys in website code. read: only reading
		// the issues on a newsletter's public archive, for a site that shows them. Keys made before levels existed
		// have none and count as signups (lib/api-key-tokens.js getKeyLevel).
		level: { type: String, enum: API_KEY_LEVELS },
		lastUsedAt: { type: Date },
		revokedAt: { type: Date },
	},
	{ timestamps: true }
);

apiKeySchema.plugin(accountScoped);
apiKeySchema.index({ accountId: 1, createdAt: -1 });

export default mongoose.models.ApiKey || mongoose.model("ApiKey", apiKeySchema);
