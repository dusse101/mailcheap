import CardInboxCheck from "@/components/CardInboxCheck";
import { isInboxCheckOpen } from "@/lib/inbox-check";
import { getSelectedNewsletter } from "@/lib/selected-newsletter";

// The open newsletter's inbox check on every dashboard page, once its get-started panel is gone (lib/inbox-check.js).
// Keyed by newsletter, like that panel: switching from one whose card was just closed still opens the next one's.
export default async function PanelInboxCheck({ account }) {
	const { selected } = await getSelectedNewsletter();
	if (!isInboxCheckOpen(account, selected)) return null;
	const newsletterId = String(selected._id);
	return <CardInboxCheck key={newsletterId} newsletterId={newsletterId} />;
}
