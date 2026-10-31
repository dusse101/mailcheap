import Image from "next/image";
import LogoGmail from "@/components/LogoGmail";
import { GMAIL_DOMAINS } from "@/lib/email-aliases";
import { faviconUrl } from "@/lib/favicon";
import { cn } from "@/lib/utils";

export default function ImageFavicon({ domain, size = 16, className }) {
	if (!domain) return null;
	// The favicon service answers Gmail's domains with Google's G.
	if (GMAIL_DOMAINS.includes(domain)) return <LogoGmail size={size} className={cn("shrink-0", className)} />;
	return (
		<Image
			src={faviconUrl(domain, size > 16 ? 64 : 32)}
			alt=""
			width={size}
			height={size}
			unoptimized
			loading="lazy"
			className={cn("shrink-0 rounded-[4px]", className)}
		/>
	);
}
