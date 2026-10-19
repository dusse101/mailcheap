"use client";

import PageBrand, { BrandActions, BrandLink } from "@/components/PageBrand";

// The branded keep page. Only the button's POST keeps, and it posts to /api/keep: a server
// action's response never finishes when the browser submits the form on its own.
export default function FormKeepBrand({ brand, token, fromEmail, outcome = "form" }) {
	if (outcome === "done") {
		return (
			<PageBrand brand={brand} eyebrow="You're staying" title="You'll keep getting it 🌮" focusTitle>
				<p>
					Thanks for letting us know. The next issue lands {brand.sendDay}
					{fromEmail ? (
						<>
							{" "}
							from <strong>{fromEmail}</strong>
						</>
					) : null}
					.
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
		<PageBrand brand={brand} eyebrow="Still want it?" title={`Keep getting ${brand.name}?`}>
			<p>
				Tap the button and you&apos;ll stay on the list. {brand.name} lands in your inbox every {brand.sendDay}.
			</p>
			<BrandActions>
				<form method="post" action="/api/keep">
					<input type="hidden" name="token" value={token} />
					<button type="submit" className="tt-button tt-primary">
						Yes, keep sending it
					</button>
				</form>
			</BrandActions>
		</PageBrand>
	);
}
