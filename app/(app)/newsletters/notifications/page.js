import { redirect } from "next/navigation";
import CardSummaryEmail from "@/components/CardSummaryEmail";
import HeaderPage from "@/components/HeaderPage";
import LayoutNarrow from "@/components/LayoutNarrow";
import { scoped } from "@/lib/account-scope";
import { APP_NAME, getEmailFrom, isCloud } from "@/lib/config";
import { NOTIFICATIONS_SECTION, SETTINGS_PATH } from "@/lib/newsletter-sections";
import { ADD_NEWSLETTER_PATH } from "@/lib/newsletters";
import { getSelectedNewsletter } from "@/lib/selected-newsletter";
import { SUMMARY_HOUR, getSummaryFrequency, isSummaryEligible } from "@/lib/summary";
import Newsletter from "@/models/Newsletter";

export const metadata = { title: NOTIFICATIONS_SECTION.label };

// What MailCheap emails its owner about the open newsletter, a card for each kind. A self-hosted server sends none of
// them: its settings have no such page.
export default async function NotificationsPage() {
	if (!isCloud()) redirect(SETTINGS_PATH);
	const { account, selected } = await getSelectedNewsletter();
	if (!selected) redirect(ADD_NEWSLETTER_PATH);
	const newsletter = await Newsletter.findOne(scoped(account, { _id: selected._id })).select({ name: 1, notifications: 1 }).lean();
	const newsletterId = String(newsletter._id);

	return (
		<LayoutNarrow>
			<HeaderPage title={NOTIFICATIONS_SECTION.label} backHref={SETTINGS_PATH} />
			<div className="flex flex-col gap-4">
				<CardSummaryEmail
					key={newsletterId}
					newsletterId={newsletterId}
					frequency={getSummaryFrequency(newsletter)}
					isEligible={isSummaryEligible(account)}
					hour={SUMMARY_HOUR}
					sender={getSummarySender()}
					stagger={1}
				/>
			</div>
		</LayoutNarrow>
	);
}

// MailCheap as the preview shows the sender, the way the inbox will.
function getSummarySender() {
	const from = getEmailFrom() ?? "";
	return { name: APP_NAME, fromName: APP_NAME, fromEmail: /<([^>]+)>/.exec(from)?.[1] ?? from, imageUrl: "/icon-192.png" };
}
