import "@/assets/brands/tacoandtell/brand.css";

// A branded one-card page for the email-link pages, when PUBLIC_PAGES_BRAND is set (lib/public-brand.js).
export default function PageBrand({ brand, eyebrow, title, children }) {
	return (
		<div className="tt-page" data-brand={brand.id}>
			<div className="tt-checker" aria-hidden="true" />
			<main className="tt-main">
				<div className="tt-card">
					{/* eslint-disable-next-line @next/next/no-img-element -- a fixed-size mascot from public/, like the reading site's */}
					<img src={brand.mascotUrl} width="180" height="180" alt="" />
					{eyebrow && <p className="tt-eyebrow">{eyebrow}</p>}
					<h1>{title}</h1>
					{children}
				</div>
			</main>
			<footer className="tt-footer">
				<a href={brand.siteUrl}>{brand.name}</a>
			</footer>
		</div>
	);
}

export function BrandActions({ children }) {
	return <div className="tt-actions">{children}</div>;
}

export function BrandLink({ href, primary, children }) {
	return (
		<a href={href} className={primary ? "tt-button tt-primary" : "tt-button"}>
			{children}
		</a>
	);
}

// The confirmation link didn't work: expired, tampered with, or its newsletter is gone.
export function PageBrandConfirmInvalid({ brand }) {
	return (
		<PageBrand brand={brand} eyebrow="Hmm" title="This link has gone stale">
			<p>Confirmation links only work for 30 days. Sign up again and use the newest email we send you.</p>
			<BrandActions>
				<BrandLink href={brand.signupUrl} primary>
					Sign up again
				</BrandLink>
				<BrandLink href={brand.issuesUrl}>Read past issues</BrandLink>
			</BrandActions>
		</PageBrand>
	);
}
