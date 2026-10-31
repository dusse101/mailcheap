import mongoose from "mongoose";
import { accountScoped } from "../lib/account-scope.js";

// A customer's own sending domain. Unique across accounts: a domain belongs to the first account that adds it.
const domainSchema = new mongoose.Schema(
	{
		domain: { type: String, required: true, unique: true, lowercase: true, trim: true },
		mailFromDomain: { type: String, required: true, lowercase: true, trim: true },
		// Its news. subdomain, which carried the website before newsletters had a website domain of their own. Every
		// database has the unique index on it, so new domains still fill it in.
		archiveHost: { type: String, required: true, unique: true, lowercase: true, trim: true },
		// The email provider it was added at (lib/email-provider), and its id there. Domains from before the
		// provider switch are SES's.
		provider: { type: String },
		providerDomainId: { type: String },
		// As the provider last reported them (lib/domains.js checkDomain).
		verified: { type: Boolean, default: false },
		dkimStatus: { type: String, default: "PENDING" },
		mailFromStatus: { type: String, default: "PENDING" },
		records: [{ _id: false, purpose: String, type: { type: String }, name: String, value: String }],
		// The DMARC record found on the domain, or on the closest parent with one (lib/dmarc-rules.js).
		dmarc: { status: { type: String }, host: { type: String } },
		// MailCheap's own last look at the records (lib/domain-dns.js): each one proxied, different or missing. Any of
		// them stops a verified domain from sending, whatever the provider says.
		dns: {
			checkedAt: { type: Date },
			problems: { type: [{ _id: false, purpose: String, type: { type: String }, name: String, state: String }], default: undefined },
		},
		// The last check, which PostShiba's verification budget counts from, and the Domains page's last read, which doesn't.
		checkedAt: { type: Date },
		readAt: { type: Date },
		verifiedAt: { type: Date },
	},
	{ timestamps: true }
);

domainSchema.plugin(accountScoped);
domainSchema.index({ accountId: 1, createdAt: 1 });
// The hourly cron's verified domains due for their daily look (lib/domains.js recheckDomains).
domainSchema.index({ verified: 1, "dns.checkedAt": 1 });

export default mongoose.models.Domain || mongoose.model("Domain", domainSchema);
