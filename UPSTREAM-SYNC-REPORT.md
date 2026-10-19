# Upstream sync report

Yes. Upstream `main` is worth bringing in. There is no newer release tag (upstream has no tags at all), and we are already on the same Next.js 16.4.1 / React 19.2.9 as upstream, including the advisory bump that landed before our merge base. What we were missing is three days of product work (15–18 Oct 2026), and three of those changes matter for a newsletter that actually sends:

1. A contact who bounced, complained, or sits on a suppression list cannot be marked active again, and resubscribing someone who left needs an explicit "they asked."
2. Setting up the sending tenant retries once when two Stripe events race, so a lost race no longer fails the account's sender.
3. A newsletter site stays dark until the first issue goes out, and the confirm page does not link to it before then. The stock confirm page now follows that rule; the branded Taco and Tell page is unchanged.

Segments (who a send goes to) and newsletter themes (fonts in the email HTML) are the other large pieces. Cloud marketing (the public deliverability page, the landing page, Crisp) mostly did not land in the open-source tree.

Merge base with `upstream/main`: `2528bdb` (15 Oct 2026). Upstream is 26 commits ahead of that base; this fork is 10 commits ahead (external reading site, read archive keys, branded confirm and unsubscribe, POST `/api/confirm`). None of the 26 were already on `taco-and-tell`.

This branch merges `upstream/main` and keeps every fork customization.

## Conflicts

Git stopped on four files. Each resolution keeps our behavior and takes upstream's addition.

| File | Ours | Upstream | Resolution |
| --- | --- | --- | --- |
| `app/confirm/page.js` | Button POST, branded page, dormant stays "You're in", `Referrer-Policy: strict-origin` | Theme styles, archive link only after the first issue | Both. Branded page still skips the archive link and posts to `/api/confirm`. Stock page uses `isArchiveLive` and `StyleTheme`. |
| `app/unsubscribe/page.js` | Branded page | Theme styles and theme heading | Both. Brand path unchanged; stock page uses the theme. |
| `components/CardNotice.jsx` | Focus moves to the title after the confirm button | Theme heading font | Both. |
| `lib/sending-rules.js` | Read online links go to `NEWSLETTER_EXTERNAL_SITES` | Theme font base URL on the rendered email | Both. |

These files were edited on both sides and merged cleanly: `AGENTS.md`, `SECURITY.md`, `app/(app)/api-keys/page.js`, `app/archive/[slug]/page.js`, `app/archive/[slug]/p/[post]/page.js`, `lib/actions/campaigns.js`, `lib/campaign-queries.js`, `lib/docs/llms.js`, `lib/docs/reference.js`, `proxy.js`, `tests/api.test.mjs`, `tests/newsletter-slugs.test.mjs`. Read archive keys, external-site redirects, and `/api/confirm` on archive hosts are still there. `app/keep/page.js` only gained upstream's theme style; `feature/keep-page-fix` was not touched.

## Commits

Subjects are shortened. Every row is "we did not have this." Priority is called out in the reason.

### Security

| Date | SHA | Subject | Conflicts | Recommendation |
| --- | --- | --- | --- | --- |
| 2026-10-16 | `8fd5534` | An account with no plan can add 3 contacts a day by hand, not 5. `SECURITY.md` says so. | `SECURITY.md` (clean merge with the read-archive key paragraph) | Take. Cloud-only abuse limit. Self-host has no plan limits, so production behavior does not change. |
| 2026-10-15 | `c980116` | Cloud deliverability page at `/open`, plus a daily cron. In this repo the diff is a `SECURITY.md` sentence and a chart tick. | `SECURITY.md` (clean) | Take. The page, the cron, and `openstatsdays` are not in the open-source tree. The sentence documents a cross-account read that only exists on MailCheap Cloud. |

`966d5b6` (contact status) is the security-relevant one and is listed under sending, because that is what it changes.

### Bug fixes

| Date | SHA | Subject | Conflicts | Recommendation |
| --- | --- | --- | --- | --- |
| 2026-10-16 | `be6dd5d` | Escape closes the email preview after a click inside the email. | None | Take. Small dialog bug. |
| 2026-10-15 | `d2bce27` | Deliverability charts say "1 week" and keep the month's capital for screen readers. | None | Take. The chart component is shared; the public page is not in this repo. |
| 2026-10-18 | `5a22e37` | The formatting menu closes when focus leaves the text, including an open link field. | None | Take. It was staying open over the send step. |
| 2026-10-18 | `151799f` | The dashboard sidebar stays put at the end of long pages. | None | Take. Layout bug. |

### Deliverability and sending

| Date | SHA | Subject | Conflicts | Recommendation |
| --- | --- | --- | --- | --- |
| 2026-10-15 | `cd7ed85` | A plan start that loses a Stripe race retries the tenant setup and the shared address once, then stays quiet if the other run won. | None (`lib/tenants.js`, `lib/shared-sender.js`, SES stub) | Take. High priority. Stops a false failure while the sending identity is created. |
| 2026-10-15 | `40018f6` | New newsletters start with the website on, and nothing is public until the first issue. Confirm does not link to it before then. Signups and unsubscribe keep working. | `app/confirm/page.js` | Take with adaptation. High priority for the stock confirm page. Existing newsletters are not migrated. The branded confirm page still links to tacoandtell.com, not the MailCheap archive. |
| 2026-10-17 | `506b319` | Admin shows each sending lane's last hour and 24 hours against its caps, and stops naming the provider in pause reasons. | None | Take. Useful on `/admin`. No provider name on the page. |
| 2026-10-18 | `bbf9023` | Segments filter who a send goes to, shared by the dashboard, the API, and MCP. A deleted segment blocks its drafts. | `lib/actions/campaigns.js`, `lib/campaign-queries.js` (clean) | Take. Changes the send audience. Read archive keys are unchanged. |
| 2026-10-18 | `966d5b6` | Set a contact active, dormant, or unsubscribed from the menu, the API, and MCP. Resubscribe and activating a pending contact need consent. Bounced, complained, and suppressed addresses never come back. Last 20 changes are kept. | None (`lib/contacts.js`, `lib/contact-status.js`) | Take. High priority. Matches how we already treat dormant on the confirm page: the button does not bring a dormant contact back. |

### Features

| Date | SHA | Subject | Conflicts | Recommendation |
| --- | --- | --- | --- | --- |
| 2026-10-15 | `9aaae6d` | Support chat tells Crisp who is writing. In this repo: `/admin?account=<id>` opens that account. | None | Take. The Crisp payload did not land here. The admin deep link did. |
| 2026-10-16 | `4081540` | Campaign editor: checks live with the email, blockers show on Send or Schedule, calendar for the day, desktop preview. | None | Take. Editor only. |
| 2026-10-16 | `190b631` | Schedule says when it is reusing the last issue's time. | None | Take. Copy. |
| 2026-10-17 | `6b46ee6` | The campaign more menu can send a test and open the preview from any step. | None | Take. |
| 2026-10-17 | `9dbff72` | Admin is an overview: totals, 30-day email chart, recent campaigns, a short account list with search. The provider is not named. | None | Take. |
| 2026-10-17 | `556595a` | Pictures can sit left, center, or right. Blocks can be dragged or moved with the keyboard. | None | Take. Emails and the archive keep the alignment. |
| 2026-10-17 | `e235e3d` | Email preview scrolls like a mail app. | None | Take. |
| 2026-10-18 | `94ddf3c` | Picture toolbar shows on hover and edits alt text. | None | Take. |
| 2026-10-18 | `74f699f` | Newsletter themes reach the open source, with self-hosted fonts. The scrub no longer treats a CSS unicode range as a phone number. | `components/CardNotice.jsx`, `app/unsubscribe/page.js`, archive pages (archive pages merged clean) | Take with adaptation. Theme class on our notice card; brand pages do not use it. `fontBaseUrl` is in `lib/sending-rules.js` next to the external Read online link. |
| 2026-10-18 | `8b6dd5e` | Contact status tabs look like filters, not black pills. | None | Take. Visual only. |
| 2026-10-18 | `2659607` | Landing-page feature tiles. In this repo: small email-preview and Gmail-logo edits. | None | Take. The landing page itself is not in the open-source tree. |

### Refactors and dependencies

Nothing in this range. `package.json` matches on both sides: Next `16.4.1`, React `19.2.9`, eslint-config-next `16.4.1`. The Next.js advisory bump (Image Optimization SVG RCE, Server Action DoS, React Server Components) is already on `taco-and-tell`, in history before `2528bdb`.

### Docs

| Date | SHA | Subject | Conflicts | Recommendation |
| --- | --- | --- | --- | --- |
| 2026-10-18 | `7a578a0` | Public help center at `/help`, linked from the header, footer, sitemap, and account menu. | `AGENTS.md`, `lib/docs/llms.js` (clean) | Take. Self-host serves `/help` (it is a public path). Articles describe MailCheap, which is what this admin is. Confirmed opt-in is still "they click the button," which matches our POST. |
| 2026-10-18 | `4788e3f` | Help center segment article: active contacts, date windows, a segment in use cannot be deleted. | None | Take. Follows the segment feature. |
| 2026-10-18 | `86a0887` | Public pages end on a Get started card, on MailCheap Cloud only. | `AGENTS.md`, `components/SiteExtensions.jsx` (clean) | Take. The extension adds nothing on a self-hosted server. |
| 2026-10-18 | `e925e26` | Docs are labeled API and MCP. Addresses under `/docs` stay the same. | `app/(app)/api-keys/page.js`, `lib/docs/llms.js`, `lib/docs/reference.js` (clean) | Take. The read-archive label on the API keys page is still there. |

## Tests and build

- Node v22.14.0
- `npm test`: 865 passed, 0 failed, 0 skipped (138 suites, about 83s). The fork had 794 before this sync; the extra tests came in with upstream.
- `npm run lint`: clean
- `npm run build`: compiled, 73 static pages generated, Next.js 16.4.1

`mongod` 8.0.15 was used via `MONGOD_PATH` for the test run. Nothing was sent, and no Vercel env or production branch was changed.

## After PR #3

`taco-and-tell` moved to `de1a7f1` (merge of PR #3, the keep-page fix) after this branch was opened. That commit was merged in, not rebased.

Git conflicted only on `app/keep/page.js`. The resolution is PR #3's page in full: GET does not change state, nothing auto-submits, the button POSTs to `/api/keep`, `Referrer-Policy` is `strict-origin`, `PUBLIC_PAGES_BRAND` picks the branded page, and a refresh reads the contact again. The stock page also renders `StyleTheme` with the newsletter's theme, the same addition upstream made on confirm and unsubscribe. The branded keep page is unchanged. `CardNotice` already uses the theme heading, so the stock keep card picks up the theme font.

`app/api/keep/route.js`, `tests/keep.test.mjs`, and the `/api/keep` entries on `PUBLIC_PATHS` and `ARCHIVE_HOST_PATHS` came through next to upstream's `/help` route and `woff2` font matcher. `proxy.js` merged on its own.

Checks on this merge, Node v22.14.0:

- `npm run lint`: clean
- `npm test`: 879 passed, 0 failed (139 suites). That is the 865 from the upstream sync plus the 14 keep tests from PR #3.
- `npm run build`: compiled, 74 static pages, including `/api/keep`, Next.js 16.4.1

## Keeping up

Check `upstream/main` once a week, and again whenever `package.json` or `SECURITY.md` changes. One command from a checkout that already has the remote:

```bash
git fetch upstream
git log --format='%h %ad %s' --date=short $(git merge-base taco-and-tell upstream/main)..upstream/main
```

Watch, in order: `package.json` (Next and React advisories), `SECURITY.md`, `lib/tenants.js`, `lib/sending.js`, `lib/sending-rules.js`, `lib/contacts.js`, `lib/email-provider/`, and `app/confirm/`. Merge `upstream/main` onto a branch off `taco-and-tell` the way this branch does. Do not rebase `taco-and-tell`, and do not open the pull request against `marclou/mailcheap`.

Cloud commit messages describe the private product. The open-source diff is often smaller. Read the diff, not only the subject, before treating a "landing page" or "deliverability page" commit as something this fork will show.
