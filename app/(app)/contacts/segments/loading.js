import HeaderPage from "@/components/HeaderPage";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
	return (
		<>
			<HeaderPage title="Segments" parent={{ label: "Contacts", href: "/contacts" }}>
				<Skeleton className="h-9 w-32 rounded-lg" />
			</HeaderPage>
			<ul aria-hidden="true" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
				{[0, 1, 2].map((index) => (
					<li key={index} className="flex flex-col gap-4 rounded-xl p-4 shadow-border">
						<span className="flex flex-col gap-2">
							<Skeleton className="h-4 w-28" />
							<Skeleton className="h-3.5 w-48" />
						</span>
						<span className="flex flex-col gap-2.5">
							<span className="flex items-end justify-between">
								<span className="flex flex-col gap-1.5">
									<Skeleton className="h-7 w-16" />
									<Skeleton className="h-3 w-20" />
								</span>
								<Skeleton className="h-3 w-24" />
							</span>
							<Skeleton className="h-1 w-full rounded-full" />
						</span>
					</li>
				))}
			</ul>
		</>
	);
}
