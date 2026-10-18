"use client";

import { useActionState } from "react";
import { confirmSubscription } from "@/app/confirm/actions";
import PageBrand, { BrandActions, BrandLink, PageBrandConfirmInvalid } from "@/components/PageBrand";

// The branded confirm page. Only the button's POST confirms: opening the link (or a link scanner opening it) never does.
export default function FormConfirmBrand({ brand, token, fromEmail }) {
	const [state, action, isPending] = useActionState(confirmSubscription.bind(null, token), null);

	if (state?.ok) {
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

	if (state?.error) return <PageBrandConfirmInvalid brand={brand} focusTitle />;

	return (
		<PageBrand brand={brand} eyebrow="One more tap" title="Confirm your subscription">
			<p>
				Tap the button and you&apos;re on the list. {brand.name} lands in your inbox every {brand.sendDay} with
				what&apos;s opening, closing and changing around you.
			</p>
			<BrandActions>
				<form action={action}>
					<button type="submit" className="tt-button tt-primary" disabled={isPending}>
						{isPending ? "Subscribing…" : "Yes, subscribe me"}
					</button>
				</form>
			</BrandActions>
			<p className="tt-fine tt-after">
				Didn&apos;t sign up? Close this page and you won&apos;t hear from us.
			</p>
		</PageBrand>
	);
}
