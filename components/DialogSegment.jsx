"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { countSegment, deleteSegment, saveSegment } from "@/app/(app)/contacts/actions";
import LinkHelp from "@/components/LinkHelp";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNumber } from "@/lib/format";
import {
	CONTACT_SOURCES,
	MAX_SEGMENT_CONDITIONS,
	MAX_SEGMENT_NAME,
	SEGMENT_FIELDS,
	SEGMENT_PRESETS,
	checkSegmentRules,
} from "@/lib/segments";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const COUNT_DELAY_MS = 350;
const OTHER_SOURCE = "__other";

// The segment editor: a name, conditions met all or any, and how many active contacts they pick now. Saved, it shows
// the segment's contacts; the send step passes onSaved to pick it for the campaign instead. segment: { id, name, match,
// conditions, contacts } to edit one.
export default function DialogSegment({ newsletterId, segment = null, trigger, open, onOpenChange, onSaved }) {
	const [isOpenHere, setIsOpenHere] = useState(false);
	const isOpen = open ?? isOpenHere;
	const setIsOpen = onOpenChange ?? setIsOpenHere;

	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			{trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
			<DialogContent className="gap-5 sm:max-w-xl">
				<FormSegment
					newsletterId={newsletterId}
					segment={segment}
					onSaved={(id) => {
						setIsOpen(false);
						onSaved?.(id);
					}}
					isPicking={Boolean(onSaved)}
					onDeleted={() => setIsOpen(false)}
				/>
			</DialogContent>
		</Dialog>
	);
}

function FormSegment({ newsletterId, segment, onSaved, isPicking, onDeleted }) {
	const router = useRouter();
	const [name, setName] = useState(segment?.name ?? "");
	const [draft, setDraft] = useState(() => ({
		match: segment?.match ?? "all",
		conditions: (segment?.conditions ?? []).map(withKey),
	}));
	const [count, setCount] = useState(segment?.contacts ?? null);
	const [isCounting, startCounting] = useTransition();
	const [isSaving, startSaving] = useTransition();
	const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
	const countTimer = useRef(null);
	const countRequest = useRef(0);
	const { rules } = checkSegmentRules(draft);
	const canSave = Boolean(rules && name.trim()) && !isSaving;

	useEffect(() => () => clearTimeout(countTimer.current), []);

	// Counted a moment after the last change, and only the latest answer shows.
	function update(next) {
		setDraft(next);
		clearTimeout(countTimer.current);
		const checked = checkSegmentRules(next).rules;
		if (!checked) return;
		countTimer.current = setTimeout(() => {
			const request = ++countRequest.current;
			startCounting(async () => {
				const result = await countSegment({ newsletterId, ...checked });
				if (request === countRequest.current) setCount(result?.error ? null : result.contacts);
			});
		}, COUNT_DELAY_MS);
	}

	function applyPreset(preset) {
		setName((current) => (current.trim() && !SEGMENT_PRESETS.some((item) => item.name === current) ? current : preset.name));
		update({ match: preset.match, conditions: preset.conditions.map(withKey) });
	}

	function changeCondition(key, change) {
		update({ ...draft, conditions: draft.conditions.map((condition) => (condition.key === key ? change(condition) : condition)) });
	}

	function save(event) {
		event.preventDefault();
		if (!canSave) return;
		startSaving(async () => {
			const result = await saveSegment(segment?.id ?? null, { newsletterId, name: name.trim(), ...rules });
			if (result?.error) return void toast.error(result.error);
			toast.success(segment ? "Segment saved" : "Segment created");
			onSaved(result.id);
			if (!isPicking) router.push(`/contacts?segment=${result.id}`, { scroll: false });
		});
	}

	function remove() {
		if (!isConfirmingDelete) return setIsConfirmingDelete(true);
		startSaving(async () => {
			const result = await deleteSegment(segment.id);
			if (result?.error) return void toast.error(result.error);
			toast.success("Segment deleted");
			onDeleted();
			router.push("/contacts", { scroll: false });
		});
	}

	return (
		<form onSubmit={save} className="flex flex-col gap-5">
			<DialogHeader>
				<DialogTitle>{segment ? "Edit segment" : "New segment"}</DialogTitle>
				<DialogDescription>
					Contacts who meet these conditions, kept up to date. <LinkHelp article="contacts" section="segments" />
				</DialogDescription>
			</DialogHeader>

			<input
				value={name}
				onChange={(event) => setName(event.target.value)}
				maxLength={MAX_SEGMENT_NAME}
				placeholder="Name"
				aria-label="Name"
				className="h-10 rounded-lg bg-muted/60 px-3 text-base font-medium outline-none transition-shadow duration-150 placeholder:font-normal placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
			/>

			{!segment && draft.conditions.length === 0 && (
				<div className="flex flex-wrap items-center gap-2">
					{SEGMENT_PRESETS.map((preset) => (
						<button
							key={preset.name}
							type="button"
							onClick={() => applyPreset(preset)}
							className="h-8 rounded-full px-3 text-sm shadow-border outline-none transition-[background-color,scale] duration-150 ease-out hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.96]"
						>
							{preset.name}
						</button>
					))}
				</div>
			)}

			<div className="flex flex-col gap-2">
				{draft.conditions.length > 1 && <ToggleMatch value={draft.match} onChange={(match) => update({ ...draft, match })} />}
				{draft.conditions.length > 0 && (
					<ul className="flex flex-col gap-2">
						{draft.conditions.map((condition) => (
							<RowCondition
								key={condition.key}
								condition={condition}
								onChange={(change) => changeCondition(condition.key, change)}
								onRemove={() => update({ ...draft, conditions: draft.conditions.filter(({ key }) => key !== condition.key) })}
							/>
						))}
					</ul>
				)}
				<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => update({ ...draft, conditions: [...draft.conditions, withKey(NEW_CONDITION)] })}
						disabled={draft.conditions.length >= MAX_SEGMENT_CONDITIONS}
						className="text-muted-foreground"
					>
						<Plus data-icon="inline-start" />
						Add condition
					</Button>
					{rules && <TextMatchCount count={count} isCounting={isCounting} />}
				</div>
			</div>

			<DialogFooter className="sm:justify-between">
				{segment ? (
					<Button
						type="button"
						variant="ghost"
						onClick={remove}
						onBlur={() => setIsConfirmingDelete(false)}
						disabled={isSaving}
						className="text-destructive hover:bg-destructive/10 hover:text-destructive"
					>
						{isConfirmingDelete ? "Delete it?" : "Delete"}
					</Button>
				) : (
					<span />
				)}
				<div className="flex flex-col-reverse gap-2 sm:flex-row">
					<DialogClose asChild>
						<Button type="button" variant="outline">
							Cancel
						</Button>
					</DialogClose>
					<Button type="submit" disabled={!canSave} className="min-w-20">
						{isSaving ? <Loader2 className="animate-spin" /> : "Save"}
					</Button>
				</div>
			</DialogFooter>
		</form>
	);
}

// Until the first count, a placeholder the size of the number; then the last count, dimmed while the next one comes. A
// failed count shows nothing.
function TextMatchCount({ count, isCounting }) {
	if (count === null && !isCounting) return null;
	return (
		<p
			aria-live="polite"
			className={cn(
				"text-sm text-muted-foreground tabular-nums transition-opacity duration-150 animate-enter",
				isCounting && count !== null && "opacity-50"
			)}
		>
			{count === null ? (
				<>
					<span
						aria-hidden="true"
						className="inline-block h-3 w-7 animate-pulse rounded-sm bg-foreground/10 align-[-0.05em] motion-reduce:animate-none"
					/>
					<span className="sr-only">Counting</span> contacts match
				</>
			) : count === 0 ? (
				"No contacts match"
			) : (
				<>
					<span className="font-medium text-foreground">{formatNumber(count)}</span>
					{count === 1 ? " contact matches" : " contacts match"}
				</>
			)}
		</p>
	);
}

// With one condition, all and any pick the same contacts, so it only shows from two.
function ToggleMatch({ value, onChange }) {
	return (
		<div role="radiogroup" aria-label="Match" className="flex gap-1 self-start rounded-lg bg-muted p-0.5 animate-enter">
			{MATCHES.map(({ id, label }) => (
				<button
					key={id}
					type="button"
					role="radio"
					aria-checked={value === id}
					onClick={() => onChange(id)}
					className={cn(
						"h-7 rounded-md px-2.5 text-sm outline-none transition-[background-color,color,box-shadow] duration-150 focus-visible:ring-3 focus-visible:ring-ring/50",
						value === id ? "bg-background font-medium text-foreground shadow-border" : "text-muted-foreground hover:text-foreground"
					)}
				>
					{label}
				</button>
			))}
		</div>
	);
}

function RowCondition({ condition, onChange, onRemove }) {
	const field = SEGMENT_FIELDS[condition.field];
	const op = field.ops[condition.op];
	const isInvalid = Boolean(op.value) && Boolean(checkSegmentRules({ conditions: [condition] }).problem);

	return (
		<li className="flex items-start gap-1.5 rounded-xl bg-muted/50 p-1.5 animate-enter">
			<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
				<Select value={condition.field} onValueChange={(value) => onChange(() => withKey(startCondition(value), condition.key))}>
					<SelectTrigger size="sm" aria-label="Condition" className="bg-background font-medium">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{Object.entries(SEGMENT_FIELDS).map(([value, { label }]) => (
							<SelectItem key={value} value={value}>
								{label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Select value={condition.op} onValueChange={(value) => onChange((current) => changeOp(current, value))}>
					<SelectTrigger size="sm" aria-label="Comparison" className="bg-background">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{Object.entries(field.ops).map(([value, { label }]) => (
							<SelectItem key={value} value={value}>
								{label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{op.value && (
					<InputValue
						type={op.value}
						op={condition.op}
						value={condition.value}
						unit={op.unit}
						isInvalid={isInvalid}
						onChange={(value) => onChange((current) => ({ ...current, value }))}
					/>
				)}
			</div>
			<Button type="button" variant="ghost" size="icon-sm" aria-label="Remove the condition" onClick={onRemove} className="shrink-0 text-muted-foreground">
				<X />
			</Button>
		</li>
	);
}

function InputValue({ type, op, value, unit, isInvalid, onChange }) {
	const inputId = useId();
	const inputClass = cn(
		"h-7 rounded-md bg-background px-2 text-sm shadow-border outline-none transition-shadow duration-150 focus-visible:ring-3 focus-visible:ring-ring/50",
		isInvalid && "ring-2 ring-destructive/40"
	);

	if (type === "source") {
		const isOther = !CONTACT_SOURCES[value];
		return (
			<>
				<Select value={isOther ? OTHER_SOURCE : value} onValueChange={(next) => onChange(next === OTHER_SOURCE ? "" : next)}>
					<SelectTrigger size="sm" aria-label="Source" className="bg-background">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{Object.entries(CONTACT_SOURCES).map(([source, { label }]) => (
							<SelectItem key={source} value={source}>
								{label}
							</SelectItem>
						))}
						<SelectItem value={OTHER_SOURCE}>Other</SelectItem>
					</SelectContent>
				</Select>
				{isOther && (
					<input
						value={value}
						onChange={(event) => onChange(event.target.value)}
						placeholder="podcast"
						aria-label="Source name"
						autoFocus
						className={cn(inputClass, "w-32")}
					/>
				)}
			</>
		);
	}

	return (
		<label htmlFor={inputId} className="flex items-center gap-1.5 text-sm text-muted-foreground">
			<input
				id={inputId}
				type={type === "date" ? "date" : type === "text" ? "text" : "number"}
				min={type === "date" || type === "text" ? undefined : 1}
				inputMode={type === "days" || type === "count" ? "numeric" : undefined}
				value={value ?? ""}
				onChange={(event) => onChange(event.target.value)}
				placeholder={type === "text" ? (op === "ends_with" ? "@company.com" : "text") : undefined}
				aria-invalid={isInvalid || undefined}
				aria-label={unit ? undefined : "Value"}
				className={cn(inputClass, "text-foreground tabular-nums", type === "date" ? "w-36" : type === "text" ? "w-40" : "w-16")}
			/>
			{unit}
		</label>
	);
}

// A field's first op, with the value its kind of input starts at.
function startCondition(field) {
	const [op, { value }] = Object.entries(SEGMENT_FIELDS[field].ops)[0];
	return { field, op, ...(value && { value: startValue(value) }) };
}

// The value stays when the new op takes the same kind.
function changeOp(condition, op) {
	const ops = SEGMENT_FIELDS[condition.field].ops;
	const kind = ops[op].value;
	if (!kind) return { key: condition.key, field: condition.field, op };
	return { ...condition, op, value: ops[condition.op].value === kind ? condition.value : startValue(kind) };
}

function startValue(kind) {
	if (kind === "date") return new Date().toISOString().slice(0, 10);
	return START_VALUES[kind];
}

function withKey(condition, key = crypto.randomUUID()) {
	return { ...condition, key };
}

const START_VALUES = { days: 30, count: 3, source: "website", text: "" };
const NEW_CONDITION = { field: "opened", op: "within", value: 30 };
const MATCHES = [
	{ id: "all", label: "Meets all" },
	{ id: "any", label: "Meets any" },
];
