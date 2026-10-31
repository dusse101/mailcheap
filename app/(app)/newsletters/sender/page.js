import LayoutSettingsSection from "@/components/LayoutSettingsSection";
import { getSettingsPage } from "@/lib/settings-page";

export const metadata = { title: "Sender" };

// ?domain=<id>, from a helper or the Domains page, picks that domain of the account in the from field, ready to save.
export default async function SenderPage({ searchParams }) {
	const [page, { domain }] = await Promise.all([getSettingsPage({ section: "sender" }), searchParams]);
	const preselectDomain = page.domains.find(({ _id }) => String(_id) === String(domain ?? ""))?.domain ?? null;
	return <LayoutSettingsSection section="sender" page={page} preselectDomain={preselectDomain} />;
}
