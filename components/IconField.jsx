import { CalendarDays, Hash, Type } from "lucide-react";

const ICONS = { text: Type, number: Hash, date: CalendarDays };

// A contact field's type as its icon: text, a number or a date (lib/contact-fields.js).
export default function IconField({ type, ...props }) {
	const Icon = ICONS[type] ?? Type;
	return <Icon aria-hidden="true" {...props} />;
}
