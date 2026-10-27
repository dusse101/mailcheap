import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import LinkApp from "@/components/LinkApp";
import { isCloud } from "@/lib/config";
import { getHelpHref, getHelpPageMetadata } from "@/lib/help";
import { UNSUBSCRIBE_PLACEHOLDER } from "@/lib/render-email";

export const metadata = getHelpPageMetadata("writing");

export default function WritingPage() {
	return (
		<ArticleHelp slug="writing">
			<h2 id="steps">Write, review, send</h2>
			<p>
				Start a draft from the <LinkApp href="/campaigns">Campaigns page</LinkApp>. A campaign goes through three steps, shown at the
				top: Write, where you type the
				subject, the preview text and the issue; Review, a checklist of what to fix before it can go out and of what may look broken;
				and Send, where you pick
				who gets it and when
				{isCloud() && (
					<>
						, with <Link href={getHelpHref("sending", "tips")}>tips for more opens</Link> before it goes out when your issue has
						some
					</>
				)}
				. Everything saves as you type, and a check shows each time it&apos;s saved. While you edit, the{" "}
				<Link href={getHelpHref("getting-started", "sidebar")}>sidebar</Link> folds down to its icons to leave the issue more room.
			</p>
			<p>
				The preview text is what inboxes show after the subject. Without one, they show your issue&apos;s first words.
			</p>

			<h2 id="editor">The editor</h2>
			<ul>
				<li>
					<strong>Formatting</strong>: select text to get bold, italic, strikethrough, a link, two heading sizes and a quote.
				</li>
				<li>
					<strong>Slash commands</strong>: type <kbd>/</kbd> on an empty line for text, three heading sizes, bulleted and numbered
					lists, a picture, a quote, a divider, a box, which sets a block apart on a gray background, a{" "}
					<Link href={getHelpHref("writing", "buttons")}>button</Link> or{" "}
					<Link href={getHelpHref("writing", "html")}>your own HTML</Link>. Contact fields, at the bottom
					of the menu, opens the <Link href={getHelpHref("writing", "first-name")}>first name and your own fields</Link>. From the
					keyboard, <kbd>→</kbd> opens it and <kbd>←</kbd> comes back. Keep typing after the slash to find any of them, like{" "}
					<kbd>/quote</kbd> or a field&apos;s name.
				</li>
				<li>
					<strong>Links</strong>: select text, press <kbd>⌘ K</kbd> (<kbd>Ctrl K</kbd> on Windows) and paste the address. An email
					address becomes a link that opens an email to it.
				</li>
				<li>
					<strong>Markdown</strong>: shortcuts work as you type, like <code>#</code> and a space for a heading, <code>-</code> for a
					list or <code>&gt;</code> for a quote.
				</li>
			</ul>

			<h2 id="pictures">Pictures</h2>
			<p>
				Paste a picture, drop it in the editor, or type <kbd>/</kbd> and pick Image to upload one or use one you uploaded before. PNG,
				JPEG, GIF and WebP work, under 4 MB. Wider pictures are resized to 1,200 pixels. A picture shows at once and uploads in the
				background, and its address never changes, so sent emails keep showing it.
			</p>
			<p>
				Drag the handles on a picture&apos;s sides to resize it. Point at it to show its toolbar, inside its top edge (on a touch
				screen, tap the picture): place it on the left, in the center or on the right, add its alt text, or delete it. Emails and your
				website keep it where you put it.
			</p>
			<p>
				Alt text describes the picture in a few words, for readers who can&apos;t see it, inboxes that block images and search
				engines reading your website. Click Alt and type it: it saves as you type, and <kbd>Enter</kbd> closes it. The Alt button
				stays highlighted once a picture has one.
			</p>

			<h2 id="buttons">Buttons</h2>
			<p>
				Type <kbd>/</kbd> and pick Button to add a link readers can&apos;t miss, like Read the full story or Join the waitlist. Type
				its text right on the button, press <kbd>Enter</kbd> and paste the link it opens: a web address, or an email address, which
				opens an email to it. <kbd>Enter</kbd> again goes on below it. While you write on a button, a bar above it shows where it
				goes, places it on the left, in the center or on the right, and deletes it, which you can{" "}
				<Link href={getHelpHref("writing", "deleting-blocks")}>undo</Link>. Click its link, or press <kbd>⌘ K</kbd>, to change it.
				Names and fields work in its text and its link.
			</p>
			<p>
				Buttons take your newsletter&apos;s <Link href={getHelpHref("design", "customize")}>theme</Link>: its accent color, with text
				that reads on it, and its corners, in your emails and on your website. Change them in{" "}
				<LinkApp href="/newsletters/design">Design</LinkApp>, and every button follows. A button needs its text and its link before the
				issue can go out: the review step says when one is missing, and the button shows No link.
			</p>

			<h2 id="html">HTML blocks</h2>
			<p>
				Type <kbd>/</kbd> and pick HTML to add your own HTML to an issue, like a table, a sponsor&apos;s banner or a signature. Paste or type it, and its tags, attributes and styles show in color. Click Done or press <kbd>Esc</kbd> when
				you&apos;re finished: the block then shows what readers get, in your newsletter&apos;s email design. Click it to change it
				again, and <Link href={getHelpHref("writing", "preview")}>Preview</Link> shows it in the whole email.
			</p>
			<p>
				To delete a block, click it, then the bin next to Done. It goes at once, and{" "}
				<Link href={getHelpHref("writing", "deleting-blocks")}>Undo</Link> brings it back.
			</p>
			<p>
				Your emails and your website get the same block, cleaned first. Scripts, forms, frames, <code>&lt;style&gt;</code> tags,
				classes and ids are removed, and so are styles that could move the block over the rest of the issue, like{" "}
				<code>position</code> or a negative margin. Style each element inline instead, with <code>style=&quot;…&quot;</code>.
				Tables, colors, fonts, borders, spacing and sizes stay. Links and pictures need their full address, starting with{" "}
				<code>https://</code>. Names and fields work in its text and its links.
			</p>
			<p>
				The <Link href={getHelpHref("sending", "review")}>review step</Link> points out a block whose tags don&apos;t match up, like a{" "}
				<code>&lt;table&gt;</code> never closed, which can take in everything after it, and what the cleaning removes.
			</p>
			<p>
				Embeds that need a script, like a video player or a signup form from another site, can&apos;t work in an email: link to
				them instead. Where the HTML sets no font or color, your website shows the block in its own.
			</p>

			<h2 id="moving-blocks">Moving blocks</h2>
			<p>
				With a mouse, a grip appears to the left of the paragraph, heading, list, picture, box, button or HTML block under the pointer. Drag
				it to move the block, and a line shows where it lands. Click it to select the block. From the keyboard,{" "}
				<kbd>⌘ Shift ↑</kbd> and{" "}
				<kbd>⌘ Shift ↓</kbd> (<kbd>Ctrl</kbd> instead of <kbd>⌘</kbd> on Windows) move the block the cursor is in. Moves undo like any
				other change.
			</p>

			<h2 id="deleting-blocks">Deleting blocks</h2>
			<p>
				Pictures, buttons and HTML blocks go as soon as you delete them, from their bin or with the keyboard. A message at the top of
				the page says so for a few seconds: click Undo in it to bring the block back, or press <kbd>⌘ Z</kbd> (<kbd>Ctrl Z</kbd> on
				Windows), as its button shows. The message goes once you change something else, since undo would take that back first.
			</p>

			<h2 id="first-name">Names and fields in your emails</h2>
			<p>
				<code>{"{{first_name}}"}</code> shows each reader&apos;s first name. Type <kbd>/</kbd>, pick Contact fields at the bottom of
				the menu, then First name, or click the person icon at the end of the subject. Both add <code>{"{{first_name|there}}"}</code>: the word
				after the bar is what readers without a first name see, so &ldquo;Hi {"{{first_name|there}}"}&rdquo; reads &ldquo;Hi
				Jane&rdquo; or &ldquo;Hi there&rdquo;. Change it, or remove it with the bar to show nothing. In the editor, names and fields
				show on a gray background: point at one to see what it prints, with a value and without one.
			</p>
			<p>
				Your own <Link href={getHelpHref("contacts", "fields")}>contact fields</Link> work the same way, by their key:{" "}
				<code>{"{{birthday}}"}</code>, <code>{"{{plan|free}}"}</code>. Contact fields lists them after the first name, and typing a
				field&apos;s name after the slash, like <kbd>/birthday</kbd>, finds it right away. The person icon in the subject lists them
				too, once you have some. Both lists end on How to add names and fields to contacts, which opens{" "}
				<Link href={getHelpHref("contacts", "fields")}>Adding fields, step by step</Link>. Text shows as it is, a number with its
				thousands separated (1,250), and a date written out (April 12, 1991). A reader without a value sees the fallback, or
				nothing. Tags never show in emails: they&apos;re for picking who gets an issue, with{" "}
				<Link href={getHelpHref("contacts", "segments")}>segments</Link>.
			</p>
			<p>
				Names and fields work in the subject, the preview text and the content, and in your welcome and confirmation emails. Your
				website and its issue pages always show the fallback, so no reader&apos;s details are ever public. The preview shows the
				name Jane, with no field values, or the details of a contact you{" "}
				<Link href={getHelpHref("writing", "preview")}>pick in it</Link>. Test emails show Jane too, or your own first name and
				fields if you&apos;re one of your contacts. The review step flags any other <code>{"{{...}}"}</code>, like a tag from another
				platform or a field you deleted, since it would go out as written.
			</p>

			<h2 id="preview">Preview and test emails</h2>
			<p>
				Preview, in the write step and in the <strong>⋯</strong> menu at any step, shows the email in a mail app&apos;s window on a
				desktop, or in Gmail on a phone: the inbox first, with a fingertip tapping the issue&apos;s row until you open it, then the
				email.
				On your own phone, Mobile shows the email itself, edge to edge. Press <kbd>Esc</kbd> to close it.
			</p>
			<p>
				Sample reader, at the top left, shows the email as a reader called Jane gets it. Click it to pick one of your active
				contacts instead, the newest first, each with their picture as on the <LinkApp href="/contacts">Contacts page</LinkApp>, or
				find one by typing any part of their email address or first name. The subject, the preview text and the email then read as
				that person gets them, with their first name and field values, or the fallbacks where they have none. They stay picked
				while the campaign is open. How to add names and fields to contacts, at the bottom of the list, opens{" "}
				<Link href={getHelpHref("contacts", "fields")}>Adding fields, step by step</Link>.
			</p>
			<p>
				Send a test email, in the same menu, sends the email as saved to your account&apos;s address, with [Test] before the subject.
				Nobody else gets it.{isCloud() && " It counts toward your plan's emails."} The review step reminds you when you haven&apos;t
				sent one. If it lands in spam: <Link href={getHelpHref("deliverability", "test-in-spam")}>When a test lands in spam</Link>
			</p>

			<h2 id="other">Duplicate, discard and HTML</h2>
			<p>
				The <strong>⋯</strong> menu also duplicates a campaign into a new draft, or discards a draft. A sent campaign can&apos;t be
				changed, but it can come off your website.{" "}
				<Link href={getHelpHref("website", "remove-issue")}>Removing an issue</Link>
			</p>
			<p>
				A campaign made with the API or an AI assistant can be a whole HTML document. The dashboard then shows its HTML to edit, and it
				needs <code>{UNSUBSCRIBE_PLACEHOLDER}</code> where the unsubscribe link goes.{" "}
				<Link href={getHelpHref("api-and-ai")}>API and AI assistants</Link>
			</p>
			<p>
				To add HTML to an issue you write in the editor, use an <Link href={getHelpHref("writing", "html")}>HTML block</Link>.
			</p>
			<p>
				When you&apos;re done, <Link href={getHelpHref("sending")}>send or schedule it</Link>.
			</p>
		</ArticleHelp>
	);
}
