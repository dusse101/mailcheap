import { cn } from "@/lib/utils";

// The one-card pages subscribers land on from an email link (confirm, keep sending).
// focusTitle: for what replaces the pressed button, so keyboard and screen reader users aren't left on nothing.
export default function CardNotice({ icon: Icon, tone, spin, title, focusTitle, children }) {
	const titleClass = "mt-4 text-lg font-theme-heading text-balance";
	return (
		<div className="w-full max-w-sm rounded-xl bg-card p-6 text-center shadow-border animate-enter sm:p-8">
			<div
				className={cn(
					"mx-auto flex size-10 items-center justify-center rounded-full",
					tone === "success"
						? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
						: "bg-muted text-muted-foreground"
				)}
			>
				<Icon className={spin ? "size-5 animate-spin" : "size-5 animate-icon-in"} aria-hidden="true" />
			</div>
			{focusTitle ? (
				<h1 tabIndex={-1} ref={focusOnMount} className={titleClass}>
					{title}
				</h1>
			) : (
				<h1 className={titleClass}>{title}</h1>
			)}
			<div className="mt-1.5 text-sm leading-relaxed text-pretty text-muted-foreground">{children}</div>
		</div>
	);
}

function focusOnMount(element) {
	element?.focus();
}
