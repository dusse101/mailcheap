// A segment picks some of a newsletter's contacts with a few conditions, kept as written and compiled here into one
// MongoDB filter on contacts. Sending, counts, the contacts list, its export, the API and MCP all use compileSegment,
// so a segment picks the same contacts everywhere. No database code: the dashboard's segment editor reads the fields.

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export const SEGMENT_MATCHES = ["all", "any"];
export const SEGMENT_DELETED = "Its segment was deleted: pick who gets it";
export const MAX_SEGMENT_CONDITIONS = 10;
export const MAX_SEGMENT_NAME = 60;

const VALUES = {
	days: { max: 3650, problem: "a whole number of days, 1 to 3,650" },
	count: { max: 100_000, problem: "a whole number, 1 to 100,000" },
	date: { problem: "a date, YYYY-MM-DD" },
	source: { max: 100, problem: "a source, 100 characters at most" },
	text: { max: 254, problem: "some text, 254 characters at most" },
};

// Each field's ops, in the order the editor offers them. A date field's ops count days back from the moment the segment
// is used, so "in the last 30 days" moves with time. A contact without the date never did it: missing values count as
// "never" and as 0.
export const SEGMENT_FIELDS = {
	opened: {
		label: "Opened",
		path: "lastOpenAt",
		ops: {
			within: { label: "in the last", value: "days", unit: "days" },
			not_within: { label: "not in the last", value: "days", unit: "days" },
			never: { label: "never" },
		},
	},
	clicked: {
		label: "Clicked",
		path: "lastClickAt",
		ops: {
			within: { label: "in the last", value: "days", unit: "days" },
			not_within: { label: "not in the last", value: "days", unit: "days" },
			never: { label: "never" },
		},
	},
	missed_issues: {
		label: "Missed",
		path: "ignoredIssues",
		ops: {
			at_least: { label: "at least", value: "count", unit: "issues in a row" },
			less_than: { label: "fewer than", value: "count", unit: "issues in a row" },
		},
	},
	emails_opened: {
		label: "Emails opened",
		path: "stats.opens",
		ops: {
			at_least: { label: "at least", value: "count" },
			less_than: { label: "fewer than", value: "count" },
		},
	},
	signed_up: {
		label: "Signed up",
		path: "subscribedAt",
		ops: {
			within: { label: "in the last", value: "days", unit: "days" },
			not_within: { label: "more than", value: "days", unit: "days ago" },
			before: { label: "before", value: "date" },
			since: { label: "since", value: "date" },
		},
	},
	source: {
		label: "Source",
		path: "source",
		ops: {
			is: { label: "is", value: "source" },
			is_not: { label: "isn't", value: "source" },
		},
	},
	email: {
		label: "Email",
		path: "email",
		ops: {
			contains: { label: "contains", value: "text" },
			ends_with: { label: "ends with", value: "text" },
		},
	},
};

export const SEGMENT_FIELD_NAMES = Object.keys(SEGMENT_FIELDS);
export const SEGMENT_OPS = [...new Set(Object.values(SEGMENT_FIELDS).flatMap(({ ops }) => Object.keys(ops)))];

// The sources MailCheap sets itself (Contact.source). An API caller's own source, like "podcast", shows as written.
export const CONTACT_SOURCES = {
	website: { label: "Signup form", phrase: "the signup form" },
	import: { label: "Import", phrase: "an import" },
	dashboard: { label: "Added by hand", phrase: "the dashboard" },
	api: { label: "API", phrase: "the API" },
};

// Starting points in the segment editor.
export const SEGMENT_PRESETS = [
	{ name: "Engaged", match: "all", conditions: [{ field: "opened", op: "within", value: 30 }] },
	{ name: "New", match: "all", conditions: [{ field: "signed_up", op: "within", value: 30 }] },
	{ name: "Inactive", match: "all", conditions: [{ field: "missed_issues", op: "at_least", value: 5 }] },
	{
		name: "Never opened",
		match: "all",
		conditions: [
			{ field: "opened", op: "never" },
			{ field: "signed_up", op: "not_within", value: 30 },
		],
	},
];

function readValue(type, value) {
	if (type === "days" || type === "count") {
		const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
		return Number.isInteger(number) && number >= 1 && number <= VALUES[type].max ? number : null;
	}
	if (typeof value !== "string") return null;
	if (type === "date") {
		const text = value.trim();
		const date = DATE_PATTERN.test(text) ? startOfDay(text) : null;
		return date && !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text) ? text : null;
	}
	const text = type === "text" ? value.trim().toLowerCase() : value.trim();
	return text && text.length <= VALUES[type].max ? text : null;
}

// The rules as stored, or what's wrong with them, for people (the editor) and agents (the API) alike.
export function checkSegmentRules({ match = "all", conditions } = {}) {
	if (!SEGMENT_MATCHES.includes(match)) return { problem: "match must be all or any" };
	if (!Array.isArray(conditions) || conditions.length === 0) return { problem: "Add a condition" };
	if (conditions.length > MAX_SEGMENT_CONDITIONS) return { problem: `${MAX_SEGMENT_CONDITIONS} conditions at most` };
	const checked = [];
	for (const [index, condition] of conditions.entries()) {
		const where = conditions.length > 1 ? `Condition ${index + 1}: ` : "";
		const field = SEGMENT_FIELDS[condition?.field];
		if (!field) return { problem: `${where}field must be one of ${SEGMENT_FIELD_NAMES.join(", ")}` };
		const op = field.ops[condition.op];
		if (!op) return { problem: `${where}${condition.field} takes ${Object.keys(field.ops).join(", ")}` };
		if (!op.value) {
			checked.push({ field: condition.field, op: condition.op });
			continue;
		}
		const value = readValue(op.value, condition.value);
		if (value === null) return { problem: `${where}${condition.field} ${condition.op} needs ${VALUES[op.value].problem}` };
		checked.push({ field: condition.field, op: condition.op, value });
	}
	return { rules: { match, conditions: checked } };
}

// One filter on contacts for checked rules, the dates counted back from now. It goes inside $and next to the account,
// newsletter and status, so it can't widen a query. Mongoose casts its values, so it's for Contact queries only.
export function compileSegment({ match, conditions }, { now = new Date() } = {}) {
	const filters = conditions.map((condition) => compileCondition(condition, now));
	if (filters.length === 1) return filters[0];
	return { [match === "any" ? "$or" : "$and"]: filters };
}

function compileCondition({ field, op, value }, now) {
	const { path } = SEGMENT_FIELDS[field];
	switch (op) {
		case "within":
			return { [path]: { $gte: daysBefore(now, value) } };
		// Not opened lately includes never opened; a signup date is always there.
		case "not_within":
			return field === "signed_up" ? { [path]: { $lt: daysBefore(now, value) } } : { [path]: { $not: { $gte: daysBefore(now, value) } } };
		case "never":
			return { [path]: null };
		case "at_least":
			return { [path]: { $gte: value } };
		case "less_than":
			return { [path]: { $not: { $gte: value } } };
		case "before":
			return { [path]: { $lt: startOfDay(value) } };
		case "since":
			return { [path]: { $gte: startOfDay(value) } };
		case "is":
			return { [path]: value };
		case "is_not":
			return { [path]: { $ne: value } };
		case "contains":
			return { [path]: { $regex: escapeRegex(value) } };
		case "ends_with":
			return { [path]: { $regex: `${escapeRegex(value)}$` } };
		default:
			throw new Error(`Unknown segment op ${op}`);
	}
}

const DESCRIPTIONS = {
	opened: {
		within: (value) => `Opened in the last ${plural(value, "day")}`,
		not_within: (value) => `Not opened in the last ${plural(value, "day")}`,
		never: () => "Never opened",
	},
	clicked: {
		within: (value) => `Clicked in the last ${plural(value, "day")}`,
		not_within: (value) => `Not clicked in the last ${plural(value, "day")}`,
		never: () => "Never clicked",
	},
	missed_issues: {
		at_least: (value) => `Missed at least ${plural(value, "issue")} in a row`,
		less_than: (value) => `Missed fewer than ${plural(value, "issue")} in a row`,
	},
	emails_opened: {
		at_least: (value) => `Opened at least ${plural(value, "email")}`,
		less_than: (value) => `Opened fewer than ${plural(value, "email")}`,
	},
	signed_up: {
		within: (value) => `Signed up in the last ${plural(value, "day")}`,
		not_within: (value) => `Signed up more than ${plural(value, "day")} ago`,
		before: (value) => `Signed up before ${formatDay(value)}`,
		since: (value) => `Signed up since ${formatDay(value)}`,
	},
	source: {
		is: (value) => `Came from ${describeSource(value)}`,
		is_not: (value) => `Didn't come from ${describeSource(value)}`,
	},
	email: {
		contains: (value) => `Email contains "${value}"`,
		ends_with: (value) => `Email ends with "${value}"`,
	},
};

// For checked conditions: "Opened in the last 30 days".
export function describeCondition({ field, op, value }) {
	return DESCRIPTIONS[field]?.[op]?.(value) ?? "";
}

// The rules in one sentence: "Opened in the last 30 days and signed up since Oct 1, 2026".
export function describeSegment({ match, conditions }) {
	const parts = conditions.map(describeCondition);
	if (parts.length === 0) return "";
	const joined = parts.map((part, index) => (index === 0 ? part : part.charAt(0).toLowerCase() + part.slice(1)));
	if (joined.length === 1) return joined[0];
	return `${joined.slice(0, -1).join(", ")} ${match === "any" ? "or" : "and"} ${joined.at(-1)}`;
}

function plural(count, noun) {
	return `${count.toLocaleString("en-US")} ${count === 1 ? noun : `${noun}s`}`;
}

function describeSource(value) {
	return CONTACT_SOURCES[value]?.phrase ?? `"${value}"`;
}

function daysBefore(now, days) {
	return new Date(now.getTime() - days * DAY_MS);
}

function startOfDay(date) {
	return new Date(`${date}T00:00:00.000Z`);
}

function formatDay(date) {
	return DATE_FORMAT.format(startOfDay(date));
}

function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
