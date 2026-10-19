// Optional branding for a server that hosts one newsletter with its own reading site. PUBLIC_PAGES_BRAND names one of
// BRANDS for the pages subscribers land on (confirm, keep, unsubscribe). EMAIL_BRAND names one for Markdown emails.
// They are separate, so a preview can turn the email on first. Unset keeps the stock pages and the stock email.
const BRANDS = {
	tacoandtell: {
		id: "tacoandtell",
		name: "Taco & Tell",
		siteUrl: "https://tacoandtell.com",
		signupUrl: "https://tacoandtell.com/#signup",
		issuesUrl: "https://tacoandtell.com/issues",
		mascotUrl: "/brands/tacoandtell/badge-320.webp",
		sendDay: "Thursday morning",
		// Email clients load these from the app host (public/brands/tacoandtell). The pages keep the webp above.
		email: {
			badgePath: "/brands/tacoandtell/badge-160.png",
			tagline: "Prosper · Celina · Frisco · Little Elm · McKinney",
			colors: {
				navy: "#003e55",
				coral: "#f2546a",
				button: "#d63a55",
				link: "#b42a43",
				cream: "#fbf3e4",
				paper: "#fffbf3",
				tan: "#f7d9a8",
				muted: "#5b6b72",
			},
			fonts: {
				body: "'TT Figtree',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
				heading: "'TT Fraunces',Georgia,'Times New Roman',serif",
				display: "'TT Titan One','Arial Rounded MT Bold','Trebuchet MS',Arial,sans-serif",
				dir: "/brands/tacoandtell/fonts",
				faces: [
					{ family: "TT Figtree", weight: "300 900", file: "figtree-latin.woff2" },
					{ family: "TT Fraunces", weight: "100 900", file: "fraunces-latin.woff2" },
					{ family: "TT Titan One", weight: "400", file: "titan-one-latin.woff2" },
				],
			},
		},
	},
};

export function getPublicBrand(env = process.env) {
	return BRANDS[String(env.PUBLIC_PAGES_BRAND ?? "").trim().toLowerCase()] ?? null;
}

// Direct process.env.EMAIL_BRAND so Next can inline it for the dashboard preview (next.config env). A passed env,
// as in tests, is read as given.
export function getEmailBrand(env = process.env) {
	const configured = env === process.env ? process.env.EMAIL_BRAND : env.EMAIL_BRAND;
	const brand = BRANDS[String(configured ?? "").trim().toLowerCase()];
	return brand?.email ? brand : null;
}

// The brand's own title, without the app name the root layout appends.
export function brandTitle(brand, title) {
	return { absolute: `${title} · ${brand.name}` };
}
