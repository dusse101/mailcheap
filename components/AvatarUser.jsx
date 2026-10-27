import Image from "next/image";
import AvatarContact from "@/components/AvatarContact";
import { cn } from "@/lib/utils";

// Their photo, or without one the picture their address has (AvatarContact, from gravatarHash in lib/gravatar.js). An
// author on a website has a name and maybe a photo, but no address, so only their initial.
export default function AvatarUser({ name, email, image, gravatarHash, size = 20, className }) {
	// Google's pictures are thumbnails already, and can fail to load when the request sends a referrer.
	if (image) {
		return (
			<Image
				src={image}
				alt=""
				width={size}
				height={size}
				unoptimized
				referrerPolicy="no-referrer"
				className={cn("shrink-0 rounded-full object-cover outline -outline-offset-1 outline-black/10 dark:outline-white/10", className)}
			/>
		);
	}

	if (email && gravatarHash) return <AvatarContact email={email} gravatarHash={gravatarHash} size={size} />;

	return (
		<span
			aria-hidden="true"
			style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
			className={cn("grid shrink-0 place-items-center rounded-full bg-foreground font-semibold text-background", className)}
		>
			{(name?.trim() || email).charAt(0).toUpperCase()}
		</span>
	);
}
