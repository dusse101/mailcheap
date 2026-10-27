import mongoose from "mongoose";

// The Google account that lets the server read Google Postmaster Tools (lib/postmaster.js): one document, _id
// "postmaster". Google shows the refresh token once; it's stored AES-256-GCM encrypted (lib/credentials.js), left out of
// every read but the check's, and never sent to a browser.
const postmasterConnectionSchema = new mongoose.Schema(
	{
		_id: { type: String },
		refreshToken: { type: String, select: false },
		// The Google account and the admin who connected it, for the admin page.
		email: { type: String, trim: true },
		connectedBy: { type: String, trim: true },
		connectedAt: { type: Date },
		checkedAt: { type: Date },
		// The newest day of Gmail's data acted on (UTC, 2026-10-14), so no day is acted on twice, and what it held.
		lastDay: { type: String },
		lastRun: {
			day: { type: String },
			spamRate: { type: Number },
			flagged: [
				{
					_id: false,
					id: { type: String },
					rate: { type: Number },
					accountId: { type: String },
					action: { type: String },
				},
			],
		},
		// The domain's spam rate for each day of Gmail's data read, oldest first, the last POSTMASTER.keepDays: what Gmail's
		// complaints, which it never reports one by one, can be estimated from.
		days: [{ _id: false, day: { type: String }, spamRate: { type: Number } }],
		// Google refusing the token, the API or the domain. alertedAt: the one alert it got, until it works again or an admin
		// connects again.
		problem: {
			message: { type: String },
			at: { type: Date },
			alertedAt: { type: Date },
		},
	},
	{ timestamps: true }
);

export default mongoose.models.PostmasterConnection || mongoose.model("PostmasterConnection", postmasterConnectionSchema);
