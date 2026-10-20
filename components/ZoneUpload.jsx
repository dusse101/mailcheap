"use client";

import { cn } from "@/lib/utils";

// Click to pick a file, or drop one: on the zone, or on whatever has the drop props (lib/use-file-drop.js), like the
// whole dialog it sits in. children replace the prompt, for a file on its way.
export default function ZoneUpload({
	icon: Icon,
	title,
	hint,
	dropTitle = "Drop to upload",
	accept,
	isDragging,
	isBusy,
	onFile,
	className,
	children,
}) {
	return (
		<label
			className={cn(
				"group relative flex cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-dashed border-foreground/15 bg-muted/40 px-4 text-center transition-[background-color,border-color,box-shadow] duration-150 hover:border-foreground/30 hover:bg-muted/70 has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
				isDragging && "border-solid border-foreground/40 bg-muted ring-4 ring-foreground/5",
				isBusy && "pointer-events-none",
				className
			)}
		>
			{children || (
				<>
					<span
						className={cn(
							"grid size-10 place-items-center rounded-full bg-background shadow-border transition-transform duration-200 ease-out group-hover:-translate-y-0.5 motion-reduce:transition-none",
							isDragging && "-translate-y-1 scale-110"
						)}
					>
						<Icon className="size-4.5" />
					</span>
					<span className="max-w-full truncate text-sm font-medium">{isDragging ? dropTitle : title}</span>
					{hint && <span className="text-xs text-pretty text-muted-foreground">{hint}</span>}
				</>
			)}
			<input
				type="file"
				accept={accept.join(",")}
				disabled={isBusy}
				className="sr-only"
				onChange={(event) => {
					const [file] = event.target.files;
					event.target.value = "";
					if (file) onFile(file);
				}}
			/>
		</label>
	);
}
