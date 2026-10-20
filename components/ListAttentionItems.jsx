"use client";

import { useState } from "react";
import { Ban, Bell, CircleCheck, CirclePause, X } from "lucide-react";
import { dismissAttentionAction } from "@/app/admin/actions";
import DialogAttention from "@/components/DialogAttention";
import { formatRelative } from "@/lib/format";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const ICONS = {
	blocked: { icon: Ban, tone: "text-red-500" },
	paused: { icon: CirclePause, tone: "text-amber-500" },
	alert: { icon: Bell, tone: "text-muted-foreground" },
};

const keyOf = ({ kind, id }) => `${kind}:${id}`;

// "Needs a look" on the admin page (components/ListAttention.jsx): each item opens its details, and the cross sets it
// aside. The dismissed ones stay a click away.
export default function ListAttentionItems({ items, dismissed, now }) {
	const [hidden, setHidden] = useState(() => new Set());
	const [opened, setOpened] = useState({ item: null, isOpen: false });
	const [isShowingDismissed, setIsShowingDismissed] = useState(false);
	const shown = items.filter((item) => !hidden.has(keyOf(item)));

	function open(item) {
		setOpened({ item, isOpen: true });
	}

	function setHiddenKey(key, isHidden) {
		setHidden((current) => {
			const next = new Set(current);
			if (isHidden) next.add(key);
			else next.delete(key);
			return next;
		});
	}

	async function dismiss(item) {
		setHiddenKey(keyOf(item), true);
		const result = await dismissAttentionAction(item.kind, item.id).catch(() => ({ error: "Couldn't dismiss it" }));
		if (!result?.error) return;
		setHiddenKey(keyOf(item), false);
		toast.error(result.error);
	}

	return (
		<div className="flex flex-col gap-2">
			{shown.length > 0 ? (
				<ul className="max-h-[26rem] overflow-y-auto rounded-xl bg-card py-1.5 shadow-border">
					{shown.map((item) => (
						<li key={keyOf(item)} className="group relative">
							<ButtonItem item={item} now={now} onClick={() => open(item)} />
							<button
								type="button"
								onClick={() => dismiss(item)}
								aria-label={`Dismiss ${item.title}`}
								title="Dismiss"
								className="absolute top-2 right-2 grid size-7 place-items-center rounded-md text-muted-foreground opacity-0 outline-none transition-[opacity,background-color,color] duration-150 group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:opacity-100"
							>
								<X className="size-3.5" aria-hidden="true" />
							</button>
						</li>
					))}
				</ul>
			) : (
				<p className="flex items-center justify-center gap-2 rounded-xl bg-card px-4 py-8 text-sm text-muted-foreground shadow-border">
					<CircleCheck className="size-4 text-emerald-500" aria-hidden="true" />
					Nothing needs a look
				</p>
			)}

			{dismissed.length > 0 && (
				<button
					type="button"
					onClick={() => setIsShowingDismissed((current) => !current)}
					aria-expanded={isShowingDismissed}
					className="self-start rounded-md px-1 text-xs text-muted-foreground underline decoration-muted-foreground/30 underline-offset-4 outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
				>
					{isShowingDismissed ? "Hide dismissed" : `Show dismissed (${dismissed.length})`}
				</button>
			)}
			{isShowingDismissed && dismissed.length > 0 && (
				<ul className="max-h-[20rem] overflow-y-auto rounded-xl bg-card py-1.5 opacity-80 shadow-border">
					{dismissed.map((item) => (
						<li key={keyOf(item)}>
							<ButtonItem
								item={{ ...item, detail: `Dismissed by ${item.dismissedBy ?? "an admin"}, ${formatRelative(item.dismissedAt, now)}` }}
								now={now}
								onClick={() => open(item)}
								isMuted
							/>
						</li>
					))}
				</ul>
			)}

			{opened.item && (
				<DialogAttention
					key={keyOf(opened.item)}
					item={opened.item}
					open={opened.isOpen}
					onOpenChange={(isOpen) => setOpened((current) => ({ ...current, isOpen }))}
					onDismissed={() => setHiddenKey(keyOf(opened.item), true)}
				/>
			)}
		</div>
	);
}

function ButtonItem({ item, now, onClick, isMuted = false }) {
	const { icon: Icon, tone } = ICONS[item.icon] ?? ICONS.alert;
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex w-full items-start gap-3 py-2.5 pr-11 pl-4 text-left outline-none transition-colors duration-150 hover:bg-muted/50 focus-visible:bg-muted/60"
		>
			<Icon className={cn("mt-0.5 size-4 shrink-0", isMuted ? "text-muted-foreground" : tone)} aria-hidden="true" />
			<span className="min-w-0 flex-1">
				<span className={cn("block truncate text-sm font-medium", isMuted && "text-muted-foreground")}>{item.title}</span>
				{item.detail && <span className="line-clamp-2 text-xs text-pretty text-muted-foreground">{item.detail}</span>}
			</span>
			{item.at && <span className="shrink-0 pt-px text-xs text-muted-foreground tabular-nums">{formatRelative(item.at, now)}</span>}
		</button>
	);
}
