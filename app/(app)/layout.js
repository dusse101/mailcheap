import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import LayoutDashboard from "@/components/LayoutDashboard";
import { isAdmin, requireAccount } from "@/lib/auth";
import { needsOnboarding } from "@/lib/onboarding";
import { rememberTimeZone } from "@/lib/summary-send";
import { TIME_ZONE_COOKIE } from "@/lib/time-zone";

// Opens without a plan: what costs something (sending, imports, domains, API keys) shows the paywall.
// Billing lives in (account), outside this check.
export default async function AppLayout({ children }) {
	const { user, account } = await requireAccount();
	if (await needsOnboarding(account)) redirect("/welcome");
	const timeZone = (await cookies()).get(TIME_ZONE_COOKIE)?.value;
	after(() => rememberTimeZone(account, timeZone).catch((error) => console.error("[summary] Could not save the timezone:", error.message)));

	return (
		<LayoutDashboard user={user} account={account} isAdmin={isAdmin(user)}>
			{children}
		</LayoutDashboard>
	);
}
