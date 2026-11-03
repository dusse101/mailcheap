import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The sendAlert calls in lib and app, read from their source: tests/alerts.test.mjs checks the admins' kinds, and
// tests/notifications.test.mjs the accounts' tones.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

async function listSources(dir) {
	return (await readdir(join(ROOT, dir), { recursive: true })).filter((name) => /\.(m?js|jsx)$/.test(name)).map((name) => join(dir, name));
}

// The object of each sendAlert({ ... }) and sendAlertIfRepeated(name, { ... }) call, its braces counted. Not the
// parameters of sendAlert's own definition.
function findObjects(source) {
	const objects = [];
	for (const match of source.matchAll(/(?<!function )sendAlert(?:IfRepeated)?\([^{)]*\{/g)) {
		const start = match.index + match[0].length - 1;
		let depth = 0;
		let end = start;
		for (; end < source.length; end++) {
			if (source[end] === "{") depth++;
			if (source[end] === "}" && --depth === 0) break;
		}
		objects.push(source.slice(start, end + 1));
	}
	return objects;
}

// Every call's object, with the file it's in.
export async function findAlertCalls() {
	const calls = [];
	for (const file of [...(await listSources("lib")), ...(await listSources("app"))]) {
		for (const object of findObjects(await readFile(join(ROOT, file), "utf8"))) calls.push({ file, object });
	}
	return calls;
}

// Admin alerts name no account: accountId is missing or null.
export function isAdminAlert(object) {
	const property = /(?:^\{\s*|\n\s*)accountId\b\s*(?::\s*([^,\n]+))?,/.exec(object);
	return !property || property[1]?.trim() === "null";
}

// The kinds a key can start with: its own start, and the strings it picks one from.
export function kindsOf(object) {
	const expression = /(?:^\{\s*|[\n,]\s*)key:\s*([^,\n]+)/.exec(object)?.[1] ?? "";
	const start = /^[`"]([a-z0-9-]*)/.exec(expression)?.[1];
	return [start, ...[...expression.matchAll(/"([a-z0-9-]+)"/g)].map(([, kind]) => kind)].filter(Boolean);
}
