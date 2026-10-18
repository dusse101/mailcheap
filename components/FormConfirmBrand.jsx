"use client";

import PageBrand, { BrandActions, BrandLink } from "@/components/PageBrand";

// The branded confirm page. Only the button's POST confirms, and it posts to /api/confirm: a server
// action's response never finishes when the browser submits the form on its own.
export default function FormConfirmBrand({ brand, token, fromEmail, outcome = "form" }) {
	if (outcome === "done") {
		return (
			<PageBrand brand={brand} eyebrow="You're on the list" title="You're in! 🌮" focusTitle>
				<p>
					Your first issue lands {brand.sendDay} from <strong>{fromEmail}</strong>. If it shows up in Promotions,
					drag it to Primary so you don&apos;t miss a week.
				</p>
				<BrandActions>
					<BrandLink href={brand.issuesUrl} primary>
						Read past issues
					</BrandLink>
					<BrandLink href={brand.siteUrl}>Back to {brand.name}</BrandLink>
				</BrandActions>
			</PageBrand>
		);
	}

	return (
		<PageBrand brand={brand} eyebrow="One more tap" title="Confirm your subscription">
			<p>
				Tap the button and you&apos;re on the list. {brand.name} lands in your inbox every {brand.sendDay} with
				what&apos;s opening, closing and changing around you.
			</p>
			<BrandActions>
				<form method="post" action="/api/confirm">
					<input type="hidden" name="token" value={token} />
					<button type="submit" className="tt-button tt-primary">
						Yes, subscribe me
					</button>
				</form>
			</BrandActions>
			<p className="tt-fine tt-after">
				Didn&apos;t sign up? Close this page and you won&apos;t hear from us.
			</p>
		</PageBrand>
	);
}
