// A contact's country: the ISO 3166-1 code Vercel gives each request for its IP address, read from requests the person's
// own browser makes (a signup form, the confirmation link, a click in an email). The IP address itself is never kept.
// Elsewhere the header is missing, and contacts have no country.
const COUNTRY_HEADER = "x-vercel-ip-country";
const CODE_PATTERN = /^[A-Z]{2}$/;
const regionNames = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });

// null for anything that isn't a country: an unknown code, or "ZZ", which CLDR names Unknown Region.
export function getCountryName(code) {
	if (!CODE_PATTERN.test(code ?? "") || code === "ZZ") return null;
	return regionNames.of(code) ?? null;
}

export function readCountry(headers) {
	const code = String(headers?.get(COUNTRY_HEADER) ?? "").trim().toUpperCase();
	return getCountryName(code) ? code : null;
}

export function flagUrl(code) {
	return `https://flagcdn.com/${code.toLowerCase()}.svg`;
}
