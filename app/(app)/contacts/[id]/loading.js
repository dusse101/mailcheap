import { GLOBE_FRAME } from "@/components/CardLocation";
import { Skeleton } from "@/components/ui/skeleton";

const TIMELINE_WIDTHS = [72, 58, 64, 46, 68, 52];
// The tabs' names: Activity, About, Fields and tags.
const TAB_WIDTHS = [18, 14, 28];

export default function Loading() {
	return (
		<div aria-hidden="true">
			<div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
				<div className="flex items-center gap-2">
					<span className="-ml-2 size-9 shrink-0" />
					<Skeleton className="size-14 shrink-0 rounded-full" />
					<div className="ml-2 flex flex-col gap-2">
						<Skeleton className="h-6 w-40" />
						<Skeleton className="h-3.5 w-52" />
					</div>
				</div>
				<div className="flex flex-wrap gap-2">
					<Skeleton className="h-9 w-24 rounded-lg" />
					<Skeleton className="h-9 w-22 rounded-lg sm:w-28" />
					<Skeleton className="h-9 w-20 rounded-lg sm:w-26" />
					<span className="size-9 shrink-0 max-sm:hidden" />
				</div>
			</div>
			<div className="flex flex-col gap-6">
				<div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
					<div className="relative isolate flex min-h-52 items-end overflow-hidden rounded-xl bg-card p-4 shadow-border">
						<div className="relative z-10 flex flex-col gap-2.5">
							<Skeleton className="h-4 w-6" />
							<Skeleton className="h-6 w-36" />
							<Skeleton className="h-2.5 w-28" />
						</div>
						<div className={GLOBE_FRAME}>
							<Skeleton className="absolute inset-[4%] rounded-full" />
						</div>
					</div>
					<div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-2">
						{Array.from({ length: 4 }, (_, index) => (
							<div key={index} className="flex flex-col gap-2.5 rounded-xl bg-card p-4 shadow-border">
								<Skeleton className="h-3 w-20" />
								<Skeleton className="h-6 w-14" />
								<Skeleton className="h-2.5 w-16" />
							</div>
						))}
					</div>
				</div>
				<div className="flex flex-col gap-4">
					<div className="flex h-11 items-center gap-6 border-b border-border/60">
						{TAB_WIDTHS.map((width, index) => (
							<Skeleton key={index} className="h-3.5" style={{ width: `${width * 4}px` }} />
						))}
					</div>
					<div className="flex flex-col gap-5 rounded-xl bg-card p-4 shadow-border">
						{TIMELINE_WIDTHS.map((width, index) => (
							<div key={index} className="flex items-center gap-3">
								<Skeleton className="size-7 shrink-0 rounded-full" />
								<Skeleton className="h-3.5" style={{ width: `${width}%` }} />
								<Skeleton className="ml-auto h-3 w-10" />
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
