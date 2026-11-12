"use client";

import { startTransition, useActionState, useEffect } from "react";
import { confirmSubscription } from "@/app/confirm/actions";
import PageBrand, { BrandActions, BrandLink, PageBrandConfirmClosed } from "@/components/PageBrand";

// The branded confirm page. Like the stock one, it confirms once the page's script runs. confirmed: the address
// already confirmed, so there's nothing to run. A failed request shows a way to try again, never an error page.
export default function FormConfirmBrand({ brand, token, fromEmail, confirmed = false }) {
	const [state, confirm, isPending] = useActionState(() => confirmSafely(token), null);

	useEffect(() => {
		if (!confirmed) startTransition(confirm);
	}, [confirm, confirmed]);

	if (confirmed || state?.ok) {
		return (
			<PageBrand brand={brand} eyebrow="You're on the list" title="You're in! 🌮" focusTitle={!confirmed}>
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

	if (state?.error === "invalid") return <PageBrandConfirmClosed brand={brand} focusTitle />;

	if (state?.error) {
		return (
			<PageBrand brand={brand} eyebrow="Hmm" title="That didn't go through" focusTitle>
				<p>Something went wrong on our end. Give it another try in a moment.</p>
				<BrandActions>
					<button type="button" className="tt-button tt-primary" disabled={isPending} onClick={() => startTransition(confirm)}>
						{isPending ? "Confirming…" : "Try again"}
					</button>
				</BrandActions>
			</PageBrand>
		);
	}

	return (
		<PageBrand brand={brand} eyebrow="One sec" title="Confirming your subscription">
			<BrandActions>
				<button type="button" className="tt-button tt-primary" disabled={isPending} onClick={() => startTransition(confirm)}>
					{isPending ? "Confirming…" : "Confirm my subscription"}
				</button>
			</BrandActions>
		</PageBrand>
	);
}

async function confirmSafely(token) {
	try {
		return await confirmSubscription(token);
	} catch {
		return { error: "failed" };
	}
}
