"use client";

import { useLayoutEffect, useRef } from "react";
import CalendarMonth from "@/components/CalendarMonth";
import { addDays, startOfDay } from "@/lib/calendar";
import { cn } from "@/lib/utils";

const SLOT_MINUTES = 15;
// The first time offered leaves a moment to press Schedule (lib/schedule.js wants it a minute ahead at least).
const LEAD_MINUTES = 5;
const MAX_DAYS_AHEAD = 365;

// A month to pick the day in, and that day's times beside it, in the browser's time zone. Past days and times can't
// be picked, nor days over a year ahead.
export default function PickerSendTime({ value, onChange }) {
	const now = new Date();
	const today = startOfDay(now);
	const listRef = useRef(null);
	const selectedDay = startOfDay(value);
	const selectedDayTime = selectedDay.getTime();
	const selectedMinutes = minutesOf(value);
	const times = getTimes(selectedDay, value, now);

	// The day's list starts on its selected time.
	useLayoutEffect(() => {
		const list = listRef.current;
		const selected = list?.querySelector('[aria-checked="true"]');
		if (selected) list.scrollTop = selected.offsetTop - (list.clientHeight - selected.clientHeight) / 2;
	}, [selectedDayTime]);

	return (
		<div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8.5rem] sm:gap-5">
			<CalendarMonth
				selected={selectedDay}
				min={today}
				max={addDays(today, MAX_DAYS_AHEAD - 1)}
				onSelect={(day) => onChange(atDay(day, value, now))}
			/>
			<div className="relative min-h-0">
				<div
					ref={listRef}
					role="radiogroup"
					aria-label="Time"
					className="relative grid max-h-52 grid-cols-3 content-start gap-1 overflow-y-auto overscroll-contain sm:absolute sm:inset-0 sm:max-h-none sm:grid-cols-1"
				>
					{times.map((minutes) => {
						const isSelected = minutes === selectedMinutes;
						return (
							<button
								key={minutes}
								type="button"
								role="radio"
								aria-checked={isSelected}
								onClick={() => onChange(atMinutes(selectedDay, minutes))}
								className={cn(
									"h-9 shrink-0 rounded-lg text-sm tabular-nums outline-none transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50",
									isSelected ? "bg-foreground font-medium text-background" : "hover:bg-muted"
								)}
							>
								{atMinutes(selectedDay, minutes).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
							</button>
						);
					})}
				</div>
			</div>
		</div>
	);
}

// Every quarter hour of the day still ahead, and the selected time when it's off the quarter hours.
function getTimes(day, value, now) {
	const earliest = now.getTime() + LEAD_MINUTES * 60_000;
	const times = [];
	for (let minutes = 0; minutes < 24 * 60; minutes += SLOT_MINUTES) {
		if (atMinutes(day, minutes).getTime() >= earliest) times.push(minutes);
	}
	const selected = minutesOf(value);
	if (!times.includes(selected) && value.getTime() >= earliest) times.push(selected);
	return times.sort((a, b) => a - b);
}

// The same time on another day, or that day's first time still ahead.
function atDay(day, value, now) {
	const sameTime = atMinutes(day, minutesOf(value));
	const earliest = now.getTime() + LEAD_MINUTES * 60_000;
	if (sameTime.getTime() >= earliest) return sameTime;
	const nextSlot = Math.ceil(earliest / (SLOT_MINUTES * 60_000)) * SLOT_MINUTES * 60_000;
	return new Date(nextSlot);
}

function minutesOf(date) {
	return date.getHours() * 60 + date.getMinutes();
}

function atMinutes(date, minutes) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(minutes / 60), minutes % 60);
}
