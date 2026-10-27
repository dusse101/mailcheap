import { withCronSecret } from "@/lib/cron";
import { refreshDomainLists } from "@/lib/domain-lists";
import { runListHygiene } from "@/lib/list-hygiene";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Every 6 hours: the domain lists, downloaded again once a day, then the list hygiene's run over subscribers' domains
// (lib/list-hygiene.js).
export const GET = withCronSecret(async () => {
	const lists = await refreshDomainLists();
	const hygiene = await runListHygiene();
	console.info(`[list-hygiene] lists ${JSON.stringify(lists)}`);
	return { lists, hygiene };
});
