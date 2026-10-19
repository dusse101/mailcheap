import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CONFIRM_URL_PLACEHOLDER, getConfirmationContent, getConfirmationProblem } from "../lib/confirmation-content.js";
import { KEEP_BUTTON_LABEL } from "../lib/last-chance-content.js";
import { getEmailBrand } from "../lib/public-brand.js";
import { UNSUBSCRIBE_PLACEHOLDER, renderEmail } from "../lib/render-email.js";
import { buildRecipientEmail } from "../lib/sending-rules.js";

process.env.BETTER_AUTH_SECRET ||= "test-secret-for-confirmation-links";
process.env.APP_URL ||= "https://app.example.com";

const APP = "https://app.example.com";
const newsletter = { name: "Field notes", postalAddress: "1 Main St, Paris" };
const STOCK = JSON.parse(readFileSync(new URL("./fixtures/render-email-unbranded.json", import.meta.url), "utf8"));

// The input the stock snapshot was rendered from, before EMAIL_BRAND existed.
const stockInput = {
	markdown:
		'# Hello\n\nA [link](https://example.com).\n\n<a href="{{confirm_url}}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px;">Confirm</a>\n',
	subject: "Hi & there",
	previewText: "Preview",
	newsletter,
	webUrl: "https://news.example.com/p/issue-1",
	fontBaseUrl: APP,
};

const CUSTOM_CONFIRMATION = {
	subject: "Confirm your Taco & Tell subscription",
	previewText: "You're not on the list yet. One tap and Thursday's issue is yours.",
	markdown: `**Almost there. Tap the button and you're in.**

You (or someone using your email) asked to get Taco & Tell. You're not subscribed yet, and nothing comes until you confirm.

<a href="${CONFIRM_URL_PLACEHOLDER}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px;">Confirm my subscription</a>

**What you'll get:** one quick email every Thursday morning about what's opening, what's being built and what got decided in Prosper, Celina, Frisco, Little Elm and McKinney. We sit through the council agendas so you don't have to.

**Two quick favors so we land in your inbox:**

- Add hello@tacoandtell.com to your contacts.
- If this email was in junk or spam, mark it "Not junk" or move it to your inbox.

Didn't sign up? Just ignore this email and you won't hear from us again.

— Taco & Tell`,
};

function withEnv(values, run) {
	const previous = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
	Object.assign(process.env, values);
	try {
		return run();
	} finally {
		for (const [name, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
}

test("EMAIL_BRAND unset renders the stock email, byte for byte", () => {
	for (const env of [{ EMAIL_BRAND: "" }, { EMAIL_BRAND: "nope" }, { PUBLIC_PAGES_BRAND: "tacoandtell", EMAIL_BRAND: "" }]) {
		withEnv(env, () => {
			assert.equal(getEmailBrand(), null);
			assert.equal(renderEmail(stockInput).html, STOCK.html);
			assert.equal(renderEmail(stockInput).text, STOCK.text);
			assert.equal(renderEmail({ ...stockInput, kind: "confirmation" }).html, STOCK.html);
		});
	}
});

test("EMAIL_BRAND=tacoandtell wraps Markdown in the branded shell", () => {
	withEnv({ EMAIL_BRAND: "tacoandtell" }, () => {
		assert.equal(getEmailBrand().name, "Taco & Tell");
		const { html, bytes } = renderEmail({ ...stockInput, markdown: stockInput.markdown });
		const badge = `${APP}/brands/tacoandtell/badge-160.png`;
		assert.ok(html.includes(`src="${badge}"`), html.slice(0, 200));
		assert.ok(html.includes('width="88"'));
		assert.ok(html.includes('alt="Taco &amp; Tell"'));
		assert.ok(html.includes("Prosper · Celina · Frisco · Little Elm · McKinney"));
		assert.equal(html.includes("Breakfast-sized"), false);
		assert.equal(html.includes("★"), false);
		assert.match(html, /bgcolor="#d63a55"[^>]*mso-padding-alt:13px 28px[^>]*>\s*<a href="\{\{confirm_url\}\}"[^>]*padding:13px 28px/);
		assert.ok(html.includes("1 Main St, Paris"));
		assert.ok(html.includes(UNSUBSCRIBE_PLACEHOLDER));
		assert.ok(html.includes("data-preheader"));
		assert.ok(html.includes("<!--[if mso]>"));
		assert.ok(html.includes('name="color-scheme" content="light only"'));
		assert.equal(html.includes(".webp"), false);
		assert.ok(html.includes(`${APP}/brands/tacoandtell/fonts/figtree-latin.woff2`));
		assert.ok(bytes < 30_000, `shell is ${bytes} bytes`);

		const htmlIssue = renderEmail({
			format: "html",
			html: "<html><body><p>Issue</p></body></html>",
			newsletter,
			fontBaseUrl: APP,
		});
		assert.equal(htmlIssue.html.includes(badge), false);
		assert.ok(htmlIssue.html.includes("You're receiving this because you subscribed"));

		const rich = renderEmail({
			format: "rich",
			html: "<p>Hello</p>",
			subject: "Hi",
			newsletter,
			fontBaseUrl: APP,
		});
		assert.ok(rich.html.includes(badge));
	});
});

test("confirmation and campaign footers say what the kind is, with an unsubscribe and the address", () => {
	withEnv({ EMAIL_BRAND: "tacoandtell" }, () => {
		const base = { markdown: "Hello", subject: "Hi", previewText: "Soon", newsletter, fontBaseUrl: APP };
		const confirmation = renderEmail({ ...base, kind: "confirmation" });
		assert.match(confirmation.html, /not on the list until you confirm/);
		assert.equal(/you subscribed/i.test(confirmation.html), false);
		assert.match(confirmation.text, /not on the list until you confirm/);
		assert.equal(/you subscribed/i.test(confirmation.text), false);
		assert.equal(confirmation.html.includes("Past issues"), false);

		const campaign = renderEmail({ ...base, kind: "campaign" });
		assert.match(campaign.html, /signed up/);
		assert.match(campaign.text, /signed up/);
		assert.match(campaign.html, /every Thursday morning/);
		assert.ok(campaign.html.includes("Past issues"));
		assert.equal(/not on the list until you confirm/.test(campaign.html), false);

		for (const email of [confirmation, campaign]) {
			assert.ok(email.html.includes(">Unsubscribe</a>"));
			assert.ok(email.html.includes("1 Main St, Paris"));
			assert.ok(email.text.includes(`Unsubscribe: ${UNSUBSCRIBE_PLACEHOLDER}`));
			assert.ok(email.text.includes("1 Main St, Paris"));
		}

		const welcome = renderEmail({ ...base, kind: "welcome" });
		assert.match(welcome.text, /signed up/);
		assert.ok(welcome.html.includes("Past issues"));

		const lastChance = renderEmail({ ...base, kind: "last-chance" });
		const lastChanceEnding = `This is the last email unless you tap “${KEEP_BUTTON_LABEL}” above.`;
		assert.ok(lastChance.html.includes(lastChanceEnding));
		assert.ok(lastChance.text.includes(lastChanceEnding));
		assert.equal(lastChance.html.includes("tap keep."), false);
		assert.equal(lastChance.text.includes("tap keep."), false);
		assert.equal(/every Thursday morning/.test(lastChance.html), false);
		assert.equal(/every Thursday morning/.test(lastChance.text), false);
		assert.equal(/One email, every/.test(lastChance.html), false);
		assert.equal(/One email, every/.test(lastChance.text), false);
		assert.ok(lastChance.html.includes(">Unsubscribe</a>"));
		assert.ok(lastChance.html.includes("Past issues"));
		assert.ok(lastChance.html.includes("1 Main St, Paris"));
		assert.ok(lastChance.text.includes(`Unsubscribe: ${UNSUBSCRIBE_PLACEHOLDER}`));
		assert.ok(lastChance.text.includes("1 Main St, Paris"));
	});
});

test("the text part has no HTML, and a confirmation button stays a link with the URL", () => {
	withEnv({ EMAIL_BRAND: "tacoandtell" }, () => {
		const confirmUrl = "https://app.example.com/confirm?token=abc";
		const { text } = renderEmail({
			...getConfirmationContent({ name: "Field notes" }),
			kind: "confirmation",
			newsletter,
			fontBaseUrl: APP,
			unsubscribeUrl: "https://app.example.com/unsubscribe?token=abc",
		});
		const filled = text.replaceAll(CONFIRM_URL_PLACEHOLDER, confirmUrl);
		assert.equal(filled.includes("<"), false);
		assert.equal(filled.includes(">"), false);
		assert.ok(filled.includes(`Confirm my subscription (${confirmUrl})`));
		assert.ok(filled.includes("Unsubscribe: https://app.example.com/unsubscribe?token=abc"));
	});
});

test("buildRecipientEmail keeps List-Unsubscribe and fills the confirm link when the brand is on", () => {
	withEnv({ EMAIL_BRAND: "tacoandtell", APP_URL: APP }, () => {
		const reference = { contactId: "64f1a2b3c4d5e6f7a8b9c0a1", newsletterId: "64f1a2b3c4d5e6f7a8b9c0b1" };
		const email = buildRecipientEmail({
			campaign: getConfirmationContent({ name: "Field notes" }),
			newsletter: { _id: reference.newsletterId, name: "Field notes", fromEmail: "hi@news.example.org", postalAddress: "1 Main St, Paris" },
			contact: { _id: reference.contactId, email: "reader@example.com" },
			messageId: null,
			confirmUrl: "https://app.example.com/confirm?token=abc",
			kind: "confirmation",
		});
		assert.ok(email.headers["List-Unsubscribe"].includes("/api/unsubscribe?token="));
		assert.equal(email.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
		assert.ok(email.html.includes('href="https://app.example.com/confirm?token=abc"'));
		assert.equal(email.html.includes(CONFIRM_URL_PLACEHOLDER), false);
		assert.equal(email.text.includes(CONFIRM_URL_PLACEHOLDER), false);
		assert.ok(email.text.includes("Confirm my subscription (https://app.example.com/confirm?token=abc)"));
		assert.ok(email.html.includes(`${APP}/brands/tacoandtell/badge-160.png`));
		assert.match(email.html, /not on the list until you confirm/);
	});
});

test("getConfirmationProblem still accepts the custom confirmation copy when the brand is on", () => {
	withEnv({ EMAIL_BRAND: "tacoandtell" }, () => {
		assert.equal(getConfirmationProblem(CUSTOM_CONFIRMATION), null);
		assert.equal(getConfirmationProblem(getConfirmationContent({ name: "Field notes" })), null);
		const { html } = renderEmail({ ...CUSTOM_CONFIRMATION, kind: "confirmation", newsletter, fontBaseUrl: APP });
		assert.match(html, /bgcolor="#d63a55"[^>]*mso-padding-alt:13px 28px[^>]*>\s*<a href="\{\{confirm_url\}\}"[^>]*padding:13px 28px/);
	});
});

test("the web version stays stock with the brand on", () => {
	const web = { ...stockInput, isWebVersion: true };
	const stock = withEnv({ EMAIL_BRAND: "" }, () => renderEmail(web));
	const branded = withEnv({ EMAIL_BRAND: "tacoandtell" }, () => renderEmail(web));
	assert.equal(branded.html, stock.html);
	assert.equal(branded.text, stock.text);
	assert.equal(branded.html.includes("badge-160.png"), false);
	assert.equal(branded.html.includes(UNSUBSCRIBE_PLACEHOLDER), false);
	assert.equal(branded.html.includes("You're receiving this"), false);
});
