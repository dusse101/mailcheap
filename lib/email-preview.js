import { fillSampleName } from "./merge-tags.js";
import { UNSUBSCRIBE_PLACEHOLDER, withResponsiveImages } from "./render-email.js";

// What a preview shows of a rendered email: the sample reader's name, an unsubscribe link that goes nowhere, and
// pictures that fit the frame.
export function toPreviewHtml(html) {
	return withResponsiveImages(fillSampleName(html.replaceAll(UNSUBSCRIBE_PLACEHOLDER, "#"), { isHtml: true }));
}
