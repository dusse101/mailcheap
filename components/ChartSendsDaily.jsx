import { Suspense } from "react";
import ChartFrame from "@/components/ChartFrame";
import ChartHover from "@/components/ChartHover";
import { niceScale, toRatio } from "@/lib/charts";
import { formatNumber } from "@/lib/format";
import { formatDateKey } from "@/lib/time-zone";

// Emails sent each UTC day, oldest first, today's so far last.
export default function ChartSendsDaily({ days }) {
	const scale = niceScale([0, ...days.map(({ sent }) => sent)], 3);
	const xOf = (index) => (index + 0.5) / days.length;
	const total = days.reduce((sum, { sent }) => sum + sent, 0);

	const points = days.map(({ day, sent }, index) => ({
		x: xOf(index),
		title: formatDateKey(day),
		rows: [{ label: "Sent", value: formatNumber(sent), swatch: "bar" }],
	}));
	const xLabels = [0, Math.floor((days.length - 1) / 2), days.length - 1].map((index) => ({ x: xOf(index), label: formatDateKey(days[index].day) }));

	return (
		<ChartFrame scale={scale} xLabels={xLabels} className="h-32 sm:h-40">
			<div
				role="img"
				aria-label={`${formatNumber(total)} emails sent over the last ${days.length} days`}
				className="absolute inset-0 flex items-end gap-[2px] sm:gap-1"
			>
				{days.map(({ day, sent }) => (
					<div key={day} className="relative h-full flex-1">
						{sent > 0 && (
							<span
								className="absolute inset-x-0 bottom-0 min-h-0.5 rounded-t-[3px] bg-foreground"
								style={{ height: `${toRatio(sent, scale) * 100}%` }}
							/>
						)}
					</div>
				))}
			</div>
			{total === 0 && (
				<p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted-foreground">No emails sent in 30 days</p>
			)}
			<Suspense fallback={null}>
				<ChartHover points={points} band={1 / days.length} />
			</Suspense>
		</ChartFrame>
	);
}
