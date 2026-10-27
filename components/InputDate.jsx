"use client";

import { useId, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import ButtonClear from "@/components/ButtonClear";
import CalendarMonth from "@/components/CalendarMonth";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fromDayKey, toDayKey } from "@/lib/calendar";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const SIZES = {
	default: "h-9 gap-2 rounded-lg px-2.5 text-base md:text-sm [&_svg]:size-4",
	sm: "h-7 gap-1.5 rounded-[min(var(--radius-md),10px)] px-2 text-sm [&_svg]:size-3.5",
};

// A date field that opens a calendar. value, defaultValue, min and max are YYYY-MM-DD keys, "" for none, and onChange
// gets the day picked as one, or "" once cleared. name sends it with its form. The rest goes on the field, like the id
// its label points to.
export default function InputDate({
	value,
	defaultValue = "",
	onChange,
	name,
	min,
	max,
	size = "default",
	placeholder = "Pick a date",
	isClearable = true,
	className,
	...props
}) {
	const calendarId = useId();
	const triggerRef = useRef(null);
	const [ownValue, setOwnValue] = useState(defaultValue);
	const [isOpen, setIsOpen] = useState(false);
	const dayKey = value ?? ownValue;
	const day = fromDayKey(dayKey);
	const canClear = isClearable && Boolean(dayKey) && !props.disabled;

	function change(next) {
		setOwnValue(next);
		onChange?.(next);
	}

	function pick(picked) {
		change(toDayKey(picked));
		setIsOpen(false);
	}

	function clear() {
		change("");
		triggerRef.current?.focus();
	}

	return (
		<Popover open={isOpen} onOpenChange={setIsOpen} modal>
			<div className="relative flex min-w-0">
				<PopoverTrigger asChild>
					<button
						ref={triggerRef}
						type="button"
						role="combobox"
						aria-expanded={isOpen}
						aria-controls={isOpen ? calendarId : undefined}
						className={cn(
							"flex w-full min-w-0 items-center border border-input bg-transparent text-left whitespace-nowrap transition-[color,background-color,border-color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[state=open]:border-ring data-[state=open]:ring-3 data-[state=open]:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
							SIZES[size],
							canClear && (size === "sm" ? "pr-7" : "pr-9"),
							className
						)}
						{...props}
					>
						<CalendarDays aria-hidden="true" />
						<span className={cn("truncate tabular-nums", !day && "text-muted-foreground")}>{day ? formatDate(day) : placeholder}</span>
					</button>
				</PopoverTrigger>
				{canClear && <ButtonClear size={size} aria-label="Clear the date" onClick={clear} />}
			</div>
			<PopoverContent id={calendarId} align="start" aria-label="Pick a date" className="w-82 max-w-[calc(100vw-1rem)] p-3">
				<CalendarMonth selected={day} min={fromDayKey(min)} max={fromDayKey(max)} onSelect={pick} autoFocus />
			</PopoverContent>
			{name && <input type="hidden" name={name} value={dayKey} />}
		</Popover>
	);
}
