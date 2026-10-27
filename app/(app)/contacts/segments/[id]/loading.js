import SkeletonContacts from "@/components/SkeletonContacts";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
	return (
		<>
			<header className="mb-8 flex flex-col gap-2">
				<div className="flex items-center justify-between gap-4">
					<div className="flex items-center gap-2">
						<span className="-ml-2 size-9" />
						<Skeleton className="h-7 w-40" />
					</div>
					<Skeleton className="h-9 w-20 rounded-lg" />
				</div>
				<Skeleton className="h-3.5 w-64 sm:ml-9" />
			</header>
			<div aria-hidden="true" className="flex flex-col gap-6">
				<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
					{[0, 1, 2, 3].map((index) => (
						<div key={index} className="flex flex-col gap-2.5 rounded-xl p-4 shadow-border">
							<Skeleton className="h-3 w-20" />
							<Skeleton className="h-7 w-16" />
							<Skeleton className="h-3 w-24" />
						</div>
					))}
				</div>
				<SkeletonContacts />
			</div>
		</>
	);
}
