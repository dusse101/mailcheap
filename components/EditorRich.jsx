"use client";

import { useImperativeHandle, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import FileHandler from "@tiptap/extension-file-handler";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { HtmlBlock } from "@/components/BlockHtml";
import DialogImagePicker from "@/components/DialogImagePicker";
import MenuButton from "@/components/MenuButton";
import MenuFormat from "@/components/MenuFormat";
import MenuImage from "@/components/MenuImage";
import { SlashCommand } from "@/components/MenuSlash";
import TooltipMergeTag from "@/components/TooltipMergeTag";
import { BlockHandle } from "@/lib/editor-block-handle";
import { ButtonBlock, findButton } from "@/lib/editor-button";
import { Callout } from "@/lib/editor-callout";
import { findWords } from "@/lib/editor-find";
import { ImageAligned } from "@/lib/editor-image";
import { MergeTags } from "@/lib/editor-merge-tags";
import { UndoDelete } from "@/lib/editor-undo-delete";
import { toast } from "@/lib/toast";
import { IMAGE_TYPES, IMAGE_TYPE_ERROR, getDisplaySize, prepareImage, uploadImage } from "@/lib/upload-image";
import { useFileDropGuard } from "@/lib/use-file-drop";

const MIN_HEIGHT = "min-h-[560px]";

// contactFields: the account's fields, whose tags the editor draws as placeholders and its slash menu inserts.
// newsletter: whose email design HTML blocks preview in, and whose button colors and corners buttons show.
// ref: select(words), which selects the first place the issue has them and says whether it found one.
export default function EditorRich({ ref, content, onChange, contactFields = [], newsletter = null }) {
	const [isEditingLink, setIsEditingLink] = useState(false);
	const [isEditingButtonLink, setIsEditingButtonLink] = useState(false);
	const [isPickingImage, setIsPickingImage] = useState(false);
	const editor = useEditor({
		immediatelyRender: false,
		content,
		extensions: [
			StarterKit.configure({
				heading: { levels: [1, 2, 3] },
				codeBlock: false,
				link: { openOnClick: false, defaultProtocol: "https" },
				dropcursor: { color: "var(--ring)", width: 2 },
			}),
			ImageAligned.configure({
				resize: {
					enabled: true,
					directions: ["left", "right"],
					minWidth: 80,
					minHeight: 40,
					alwaysPreserveAspectRatio: true,
				},
			}),
			Callout,
			ButtonBlock.configure({ newsletter, onEditLink: () => setIsEditingButtonLink(true) }),
			HtmlBlock.configure({ newsletter }),
			BlockHandle,
			UndoDelete,
			MergeTags.configure({ contactFields }),
			Placeholder.configure({
				placeholder: ({ node }) => (node.type.name === "heading" ? "Heading" : "Write, or press / for commands"),
			}),
			FileHandler.configure({
				allowedMimeTypes: IMAGE_TYPES,
				consumePasteEvent: true,
				onDrop: (current, files, position) => insertImages(current, files, position),
				onPaste: (current, files) => insertImages(current, files),
			}),
			SlashCommand.configure({ onPickImage: () => setIsPickingImage(true), contactFields }),
		],
		editorProps: {
			// With a mouse, the left padding holds the blocks' drag handle (lib/editor-block-handle.js).
			attributes: { class: `prose-issue ${MIN_HEIGHT} px-5 py-5 outline-none [@media(pointer:fine)]:pl-12`, "aria-label": "Content" },
			// In a button, ⌘K opens the button's own link (lib/editor-button.js).
			handleKeyDown: (view, event) => {
				const isLinkShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
				if (!isLinkShortcut || view.state.selection.empty || findButton(view.state)) return false;
				setIsEditingLink(true);
				return true;
			},
			// The file handler takes pictures and passes on any other file, which would vanish without a word.
			handleDrop: (_view, event) => {
				const files = [...(event.dataTransfer?.files ?? [])];
				if (files.length === 0 || files.some((file) => IMAGE_TYPES.includes(file.type))) return false;
				event.preventDefault();
				toast.error(IMAGE_TYPE_ERROR);
				return true;
			},
		},
		onUpdate: ({ editor: current }) => onChange(current.getHTML()),
	});
	useFileDropGuard();
	useImperativeHandle(ref, () => ({ select: (words) => Boolean(editor && selectWords(editor, words)) }), [editor]);

	if (!editor) return <div className={MIN_HEIGHT} />;

	return (
		<>
			<EditorContent editor={editor} className="relative" />
			<MenuFormat editor={editor} isEditingLink={isEditingLink} onEditLink={setIsEditingLink} />
			<MenuButton editor={editor} isEditingLink={isEditingButtonLink} onEditLink={setIsEditingButtonLink} />
			<MenuImage editor={editor} />
			<TooltipMergeTag editor={editor} contactFields={contactFields} />
			<DialogImagePicker
				open={isPickingImage}
				onOpenChange={setIsPickingImage}
				onSelect={(image) => insertImage(editor, image)}
			/>
		</>
	);
}

// Centered on the screen, where the editor's own scrolling would leave the words at its edge, under the page's header.
function selectWords(editor, words) {
	const found = findWords(editor.state.doc, words);
	if (!found || editor.isDestroyed) return false;
	editor.chain().focus(null, { scrollIntoView: false }).setTextSelection(found).run();
	const { node } = editor.view.domAtPos(found.from);
	(node.nodeType === Node.TEXT_NODE ? node.parentElement : node)?.scrollIntoView({ block: "center" });
	return true;
}

// Where the slash command was typed: the editor keeps its selection while the picker has focus.
function insertImage(editor, { url, width, height }) {
	if (editor.isDestroyed) return;
	const size = width && height ? getDisplaySize({ width, height }) : {};
	editor.chain().focus().insertContent({ type: "image", attrs: { src: url, alt: "", ...size } }).run();
}

// Each picture shows right away from the local file and switches to its CDN URL once uploaded. The
// switch stays out of the undo history, so undo never brings back the local preview.
async function insertImages(editor, files, position) {
	for (const file of files) {
		let image;
		try {
			image = await prepareImage(file);
		} catch (error) {
			toast.error(error.message);
			continue;
		}
		if (editor.isDestroyed) return;

		const previewUrl = URL.createObjectURL(image.file);
		const node = { type: "image", attrs: { src: previewUrl, alt: "", ...getDisplaySize(image) } };
		const chain = editor.chain().focus();
		(position === undefined ? chain.insertContent(node) : chain.insertContentAt(position, node)).run();
		position = undefined;

		uploadImage(image.file)
			.then((url) => updateImages(editor, previewUrl, (tr, pos, attrs) => tr.setNodeMarkup(pos, undefined, { ...attrs, src: url })))
			.catch((error) => {
				updateImages(editor, previewUrl, (tr, pos, _attrs, size) => tr.delete(pos, pos + size));
				toast.error(error.message);
			});
	}
}

function updateImages(editor, src, change) {
	if (editor.isDestroyed) return;
	const matches = [];
	editor.state.doc.descendants((node, pos) => {
		if (node.type.name === "image" && node.attrs.src === src) matches.push({ node, pos });
	});
	if (!matches.length) return;
	const { tr } = editor.state;
	for (const { node, pos } of matches.reverse()) change(tr, pos, node.attrs, node.nodeSize);
	editor.view.dispatch(tr.setMeta("addToHistory", false));
}
