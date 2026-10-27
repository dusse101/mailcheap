"use client";

import { useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { checkDomainAction } from "@/app/(app)/domains/actions";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

export default function ButtonCheckDomain({ id }) {
	const [isChecking, startChecking] = useTransition();

	function check() {
		startChecking(async () => {
			const result = await checkDomainAction(id);
			if (result?.error) return void toast.error(result.error);
			if (result.problem) toast.error(result.problem);
			else if (result.verified) toast.success("Everything is in place");
			else toast.message("Some records aren't there yet. DNS changes can take up to a few hours.");
		});
	}

	return (
		<Button type="button" variant="outline" size="sm" onClick={check} disabled={isChecking}>
			{isChecking ? <Loader2 className="animate-spin" /> : <RefreshCw data-icon="inline-start" />}
			Check now
		</Button>
	);
}
