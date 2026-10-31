// What MailCheap Cloud's marketing site adds to the pages every server shares, on MailCheap Cloud only.
// next.config.mjs and tests/setup/hooks.mjs resolve this module to lib/marketing/site-extensions.js when that file
// exists. This default, the open source's, adds nothing. What they put on the page is in components/SiteExtensions.jsx.
export const siteExtensions = {
	// proxy.js renders landingPath at / for signed-out visitors and lets publicPages, and the paths isPublicPath
	// accepts, open without a session; a self-hosted server answers 404 for them. The sitemap lists publicPages.
	landingPath: null,
	publicPages: [],
	isPublicPath: () => false,
	headerLinks: [],
	headerAction: null,
	// { tagline, columns, company } in place of the footer's own.
	footer: null,
	twitterCreator: null,
	// A step only the server sees (a new account, a newsletter set up), for the analytics on the browser's next page.
	sendGoalOnNextPage: async () => {},
	// What the analytics needs on a Checkout session to attribute the payment.
	readCheckoutAttribution: async () => ({}),
	// A new account (lib/auth.js), given its user, for what the cloud records about where it came from. Never throws.
	onSignup: async () => {},
	// Each Stripe event the billing webhook verified, after billing handled it: what it returns joins the webhook's answer.
	// A throw makes Stripe deliver the event again, so it has to be safe to run twice.
	onStripeEvent: async () => ({}),
	// Links the admin pages' header adds, as { href, label }.
	adminLinks: [],
	// Where customers reach support: a dashboard page that opens SupportChat (components/SiteExtensions.jsx) once it's
	// loaded, after sign-in for a visitor. "Chat with us" links lead there, and emails and API errors give its address.
	// Null: no support chat, and an admin unblocks accounts.
	supportChatPath: null,
	// The postal address newsletters print until they set their own (lib/postal-address.js). Null: none, and a
	// newsletter sends once it has one.
	defaultPostalAddress: null,
	// Guides to exporting a list from another platform, linked under the import dialog's drop zone, as { brand, name,
	// href }: brand is the platform's icon in components/IconBrand.jsx.
	importGuides: [],
};
