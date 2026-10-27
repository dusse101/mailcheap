import Image from "next/image";
import { flagUrl } from "@/lib/countries";
import { cn } from "@/lib/utils";

// A country's flag by its two-letter code (lib/countries.js), at 4:3 whatever its own shape.
export default function ImageFlag({ country, width = 18, className }) {
	if (!country) return null;
	const height = Math.round((width * 3) / 4);
	return (
		<Image
			src={flagUrl(country)}
			alt=""
			width={width}
			height={height}
			unoptimized
			loading="lazy"
			style={{ width, height }}
			className={cn("shrink-0 rounded-[3px] object-cover outline -outline-offset-1 outline-black/10 dark:outline-white/15", className)}
		/>
	);
}
