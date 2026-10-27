"use client";

import { ToastBar, Toaster as HotToaster, resolveValue } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

// The toasts lib/toast.js shows, top center under BannerPlan or BannerBlocked: clear of the support chat, the
// get-started panel and a save bar in the bottom right corner. Their colors, radius and border are .toast in
// app/globals.css.
export default function Toaster() {
	return (
		<HotToaster position="top-center" containerStyle={CONTAINER_STYLE} toastOptions={TOAST_OPTIONS}>
			{(item) => (
				<ToastBar toast={item}>
					{({ icon }) => (
						<>
							{icon}
							<div {...item.ariaProps} className="mx-2.5 my-1 flex min-w-0 flex-1 flex-col text-sm whitespace-pre-line wrap-anywhere">
								<span className="font-medium">{resolveValue(item.message, item)}</span>
								{item.description && <span className="text-muted-foreground">{item.description}</span>}
							</div>
							{item.action && (
								<Button
									size="sm"
									onClick={() => {
										toast.dismiss(item.id);
										item.action.onClick();
									}}
								>
									{item.action.label}
									{item.action.shortcut && (
										<kbd className="ml-0.5 font-sans font-normal text-primary-foreground/60 [@media(pointer:coarse)]:hidden">
											{item.action.shortcut}
										</kbd>
									)}
								</Button>
							)}
						</>
					)}
				</ToastBar>
			)}
		</HotToaster>
	);
}

const CONTAINER_STYLE = { top: "calc(var(--plan-bar-height) + 1rem)" };
// A success stays as long as an error, 4 seconds. The check and the cross take the toast's background.
const TOAST_OPTIONS = {
	className: "toast",
	success: { duration: 4000, iconTheme: { primary: "var(--color-emerald-500)", secondary: "var(--popover)" } },
	error: { iconTheme: { primary: "var(--destructive)", secondary: "var(--popover)" } },
	loading: { iconTheme: { primary: "var(--muted-foreground)", secondary: "var(--border)" } },
};
