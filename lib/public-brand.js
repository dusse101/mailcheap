// Optional branding for the pages subscribers land on from an email (confirm, unsubscribe), for a server that hosts
// one newsletter with its own reading site. PUBLIC_PAGES_BRAND names one of BRANDS; unset keeps the stock pages.
const BRANDS = {
	tacoandtell: {
		id: "tacoandtell",
		name: "Taco & Tell",
		siteUrl: "https://tacoandtell.com",
		signupUrl: "https://tacoandtell.com/#signup",
		issuesUrl: "https://tacoandtell.com/issues",
		mascotUrl: "/brands/tacoandtell/badge-320.webp",
		sendDay: "Thursday morning",
	},
};

export function getPublicBrand(env = process.env) {
	return BRANDS[String(env.PUBLIC_PAGES_BRAND ?? "").trim().toLowerCase()] ?? null;
}

// The brand's own title, without the app name the root layout appends.
export function brandTitle(brand, title) {
	return { absolute: `${title} · ${brand.name}` };
}
