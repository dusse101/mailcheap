import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { findMergeTags } from "@/lib/merge-tags";

// {{first_name}} and the tags of the account's fields (contactFields) read as placeholders in the editor: a pill drawn
// over the text, which stays plain text to edit, so its fallback is changed by typing. A tag split by formatting isn't
// one, in the editor or in the email. Each pill carries its key and its fallback for its tooltip
// (components/TooltipMergeTag.jsx).
export const MergeTags = Extension.create({
	name: "mergeTags",

	addOptions() {
		return { contactFields: [] };
	},

	addProseMirrorPlugins() {
		const { contactFields } = this.options;
		return [
			new Plugin({
				key: new PluginKey("mergeTags"),
				state: {
					init: (_, { doc }) => decorateMergeTags(doc, contactFields),
					apply: (tr, decorations) => (tr.docChanged ? decorateMergeTags(tr.doc, contactFields) : decorations),
				},
				props: {
					decorations(state) {
						return this.getState(state);
					},
				},
			}),
		];
	},
});

function decorateMergeTags(doc, contactFields) {
	const decorations = [];
	doc.descendants((node, pos) => {
		if (!node.isText) return;
		for (const { index, length, key, fallback } of findMergeTags(node.text, contactFields)) {
			const attrs = { class: "merge-tag", "data-key": key, "data-fallback": fallback };
			decorations.push(Decoration.inline(pos + index, pos + index + length, attrs));
		}
	});
	return DecorationSet.create(doc, decorations);
}
