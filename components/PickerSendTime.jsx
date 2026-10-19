"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SLOT_MINUTES = 15;
// The first time offered leaves a moment to press Schedule (lib/schedule.js wants it a minute ahead at least).
const LEAD_MINUTES = 5;
const MAX_DAYS_AHEAD = 365;
const WEEKS_SHOWN = 6;
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

// A month to pick the day in, and that day's times beside it, in the browser's time zone. Past days and times can't
// be picked, nor days over a year ahead.
export default function PickerSendTime({ value, onChange }) {
	const now = new Date();
	const today = startOfDay(now);
	const thisMonth = startOfMonth(today);
	const lastDay = addDays(today, MAX_DAYS_AHEAD - 1);
	const [month, setMonth] = useState(() => startOfMonth(value));
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

	function selectDay(day) {
		onChange(atDay(day, value, now));
	}

	function selectToday() {
		setMonth(thisMonth);
		selectDay(today);
	}

	return (
		<div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8.5rem] sm:gap-5">
			<div className="flex flex-col gap-2">
				<div className="flex items-center justify-between gap-2">
					<p aria-live="polite" className="pl-1 text-sm font-medium">
						{month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
					</p>
					<div className="flex items-center gap-0.5">
						<Button variant="ghost" size="sm" onClick={selectToday} className="text-muted-foreground">
							Today
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Previous month"
							onClick={() => setMonth(addMonths(month, -1))}
							disabled={month <= thisMonth}
						>
							<ChevronLeft />
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Next month"
							onClick={() => setMonth(addMonths(month, 1))}
							disabled={addMonths(month, 1) > lastDay}
						>
							<ChevronRight />
						</Button>
					</div>
				</div>
				<div role="radiogroup" aria-label="Day" className="grid grid-cols-7 gap-y-0.5">
					{WEEKDAYS.map((weekday) => (
						<span key={weekday} aria-hidden="true" className="grid h-8 place-items-center text-xs text-muted-foreground">
							{weekday}
						</span>
					))}
					{getDays(month).map((day) =>
						day.getMonth() === month.getMonth() ? (
							<ButtonDay
								key={day.getTime()}
								day={day}
								isToday={day.getTime() === today.getTime()}
								isSelected={day.getTime() === selectedDayTime}
								isDisabled={day < today || day > lastDay}
								onSelect={() => selectDay(day)}
							/>
						) : (
							<span key={day.getTime()} aria-hidden="true" />
						)
					)}
				</div>
			</div>
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

function ButtonDay({ day, isToday, isSelected, isDisabled, onSelect }) {
	return (
		<button
			type="button"
			role="radio"
			aria-checked={isSelected}
			aria-current={isToday ? "date" : undefined}
			aria-label={`${isToday ? "Today, " : ""}${day.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}`}
			disabled={isDisabled}
			onClick={onSelect}
			className={cn(
				"mx-auto grid size-9 place-items-center rounded-full text-sm tabular-nums outline-none transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:text-muted-foreground/40",
				isSelected ? "bg-foreground font-medium text-background" : "hover:bg-muted",
				isToday && !isSelected && "font-semibold shadow-border"
			)}
		>
			{day.getDate()}
		</button>
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

// Six weeks from the Sunday the month starts in, so the grid keeps its height from a month to the next.
function getDays(month) {
	const start = addDays(month, -month.getDay());
	return Array.from({ length: WEEKS_SHOWN * 7 }, (_, index) => addDays(start, index));
}

function startOfDay(date) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date) {
	return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addDays(date, count) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
}

function addMonths(date, count) {
	return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function minutesOf(date) {
	return date.getHours() * 60 + date.getMinutes();
}

function atMinutes(date, minutes) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(minutes / 60), minutes % 60);
}
