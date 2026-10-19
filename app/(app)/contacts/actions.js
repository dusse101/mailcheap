"use server";

import { revalidatePath } from "next/cache";
import { runDashboardAction, toFormError } from "@/lib/actions/dashboard";

export async function importContacts({ newsletterId, rows, consent, importId, duplicates }) {
	const { output, failure } = await runDashboardAction("import_contacts", {
		newsletter: String(newsletterId ?? ""),
		contacts: Array.isArray(rows) ? rows : [],
		consent: consent === true,
		...(importId && { importId: String(importId) }),
		...(duplicates && { duplicates }),
	});
	if (failure) return toFormError(failure);
	revalidatePath("/contacts");
	return output;
}

// With the box ticked, the contact is active at once: no confirmation email, the welcome email if it's on.
export async function addContact(_state, formData) {
	const { output, failure } = await runDashboardAction("add_contact", {
		newsletter: String(formData.get("newsletterId") ?? ""),
		email: String(formData.get("email") ?? ""),
		consent: formData.get("consent") === "on",
	});
	if (failure) return toFormError(failure);
	revalidatePath("/contacts");
	if (!output.created) return { error: `${output.email} is already a contact` };
	return { email: output.email, status: output.status };
}

// consent: the box the menu's dialog asks for before resubscribing someone or making a pending contact active.
export async function setContactStatus(id, status, consent = false) {
	const { failure } = await runDashboardAction("update_contact_status", { id: String(id), status, consent: consent === true });
	revalidatePath("/contacts");
	return failure ? toFormError(failure) : { ok: true };
}

export async function deleteContact(id) {
	const { failure } = await runDashboardAction("delete_contact", { id: String(id) });
	revalidatePath("/contacts");
	return failure ? toFormError(failure) : { ok: true };
}

// A link to the CSV with the list's filters, valid for an hour.
export async function exportContacts({ newsletterId, status, query, segmentId } = {}) {
	const { output, failure } = await runDashboardAction("export_contacts", {
		...(newsletterId && { newsletter: String(newsletterId) }),
		...(status && { status }),
		...(query && { search: String(query) }),
		...(segmentId && { segment: String(segmentId) }),
	});
	return failure ? toFormError(failure) : { url: output.url, count: output.count };
}

// The segment editor's conditions as it holds them; the action checks them.
export async function saveSegment(id, { newsletterId, name, match, conditions } = {}) {
	const input = { name: String(name ?? ""), match, conditions: Array.isArray(conditions) ? conditions : [] };
	const { output, failure } = id
		? await runDashboardAction("update_segment", { id: String(id), ...input })
		: await runDashboardAction("create_segment", { newsletter: String(newsletterId ?? ""), ...input });
	if (failure) return toFormError(failure);
	revalidatePath("/contacts");
	return { id: output.id };
}

export async function deleteSegment(id) {
	const { failure } = await runDashboardAction("delete_segment", { id: String(id) });
	if (failure) return toFormError(failure);
	revalidatePath("/contacts");
	return { ok: true };
}

// The editor's live count while the conditions change.
export async function countSegment({ newsletterId, match, conditions } = {}) {
	const { output, failure } = await runDashboardAction("count_segment", {
		newsletter: String(newsletterId ?? ""),
		match,
		conditions: Array.isArray(conditions) ? conditions : [],
	});
	return failure ? toFormError(failure) : { contacts: output.contacts };
}
