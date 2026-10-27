import { SAMPLE_READER, fillForReader } from "./merge-tags.js";
import { UNSUBSCRIBE_PLACEHOLDER, withResponsiveImages } from "./render-email.js";

// What a preview shows of a rendered email: an unsubscribe link that goes nowhere, and pictures that fit the frame. Its
// merge tags stay for the preview to fill in for the reader it shows (fillForReader).
export function toPreviewFrame(html) {
	return withResponsiveImages(html.replaceAll(UNSUBSCRIBE_PLACEHOLDER, "#"));
}

// The same, as the sample reader sees it.
export function toPreviewHtml(html) {
	return fillForReader({ html: toPreviewFrame(html) }, SAMPLE_READER).html;
}
