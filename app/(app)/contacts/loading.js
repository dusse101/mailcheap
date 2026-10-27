import HeaderPage from "@/components/HeaderPage";
import SkeletonContacts from "@/components/SkeletonContacts";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
	return (
		<>
			<HeaderPage title="Contacts">
				<Skeleton className="h-9 w-24 rounded-lg" />
			</HeaderPage>
			<SkeletonContacts />
		</>
	);
}
