import Image from "next/image";
import ImageDomainLogo from "@/components/ImageDomainLogo";
import { rootDomain } from "@/lib/root-domain";

// Gmail's logo says nothing about the person, so those contacts keep their initial.
const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

// Bottom to top: the initial, the logo of the email's domain, the Gravatar photo. Gravatar returns a
// transparent image when the address has no photo (d=blank), so the layer below shows through.
export default function AvatarContact({ email, gravatarHash, size = 24 }) {
	const domain = rootDomain(email);
	const hue = Math.round((Number.parseInt(gravatarHash.slice(0, 4), 16) / 0xffff) * 360);

	return (
		<span
			aria-hidden="true"
			style={{
				width: size,
				height: size,
				fontSize: Math.round(size * 0.42),
				backgroundImage: `linear-gradient(135deg, oklch(0.78 0.11 ${hue}), oklch(0.62 0.14 ${hue + 40}))`,
			}}
			className="relative grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-white uppercase outline -outline-offset-1 outline-black/5 dark:outline-white/10"
		>
			{email.charAt(0)}
			{domain && !GMAIL_DOMAINS.has(domain) && <ImageDomainLogo domain={domain} size={Math.round(size * 0.58)} />}
			<Image
				src={`https://gravatar.com/avatar/${gravatarHash}?s=${size * 2}&d=blank`}
				alt=""
				width={size}
				height={size}
				unoptimized
				loading="lazy"
				className="absolute inset-0 size-full object-cover"
			/>
		</span>
	);
}
