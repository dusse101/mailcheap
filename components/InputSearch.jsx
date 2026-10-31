"use client";

import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Loader2, Search } from "lucide-react";
import ButtonClear from "@/components/ButtonClear";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// A search field with MailCheap's own cross to clear it, where browsers draw theirs (globals.css hides it). value, or
// defaultValue, is its text, and onChange gets it as it's typed, "" once cleared. Cleared in a form, it submits it, so
// the results follow. isPending turns the magnifier into a spinner. className goes on its box, the rest on the input,
// like its name and label.
export default function InputSearch({ value, defaultValue = "", onChange, isPending = false, className, ...props }) {
	const inputRef = useRef(null);
	const [ownValue, setOwnValue] = useState(defaultValue);
	const text = value ?? ownValue;
	const Icon = isPending ? Loader2 : Search;

	function change(next) {
		setOwnValue(next);
		onChange?.(next);
	}

	// The input has to be empty before its form reads it.
	function clear() {
		flushSync(() => change(""));
		inputRef.current.focus();
		inputRef.current.form?.requestSubmit();
	}

	return (
		<div className={cn("relative min-w-0", className)}>
			<Icon
				aria-hidden="true"
				className={cn("pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground", isPending && "animate-spin")}
			/>
			<Input
				ref={inputRef}
				type="search"
				value={text}
				onChange={(event) => change(event.target.value)}
				className={cn("pl-8", text && "pr-9")}
				{...props}
			/>
			{text && <ButtonClear aria-label="Clear the search" onClick={clear} />}
		</div>
	);
}
