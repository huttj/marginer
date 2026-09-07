# Marginer

Highlight anything on any web page, attach a note or an emoji, and walk away with
markdown you can paste into a PR, an issue, an email, or a doc.

It's Penumbra's annotation layer — the same W3C-style text anchoring and the same
`> quote` + note document model — cut loose from the server, the accounts, and the
Quartz site, so it works on pages you don't own.

```
                 ┌─────────────┐
                 │             ├──▶ extension/            Chrome MV3, click the toolbar icon
   src/ ──build──┤ marginer.js ├──▶ dist/bookmarklet.txt  one javascript: URL, zero install
                 │             ├──▶ dist/marginer.user.js Tampermonkey; shows you a page has notes
                 └─────────────┘
```

## The one idea worth stealing

**The markdown export *is* the storage format.** There's no annotation database and
no separate serializer. A page's notes are a single markdown string:

```markdown
> the only honest reading anyone ever gives a text

🔥 Overstated, but I like it. Compare Coleridge on Kant.


> Markdown travels

👍
```

That string is what gets saved, what gets re-parsed and re-anchored on the next
visit, what lands on your clipboard — and what the sidebar *is*: one text pane
holding the document, edited in place, Penumbra-style. Nothing can drift out of
sync with the export, because there's nothing else to drift. (The page's URL is
the storage key, so the document carries no title line.)

A note's **leading emoji are its reactions** — and that's the whole mechanism,
not a convention layered on top. There is no separate reactions field: the note
field holds the emoji, so picking 🔥 from the picker and *typing* 🔥 at the front
of the note are the same edit, and both put a chip in the margin as you do it.

## Install

### Chrome extension (recommended)

```bash
npm install && npm run build
```

Then `chrome://extensions` → **Developer mode** on → **Load unpacked** → pick the
`extension/` folder. Click the toolbar icon (or ⌘⇧U / Ctrl+Shift+U) on any page.

Nothing is injected until you click: the manifest asks for `activeTab`, not host
permissions, and there are no content scripts. To use it on `file://` pages, turn
on *Allow access to file URLs* in the extension's details.

### Bookmarklet

`npm run build` also writes `dist/index.html` — open it and drag the button
to your bookmarks bar. The whole tool is inlined in the URL, because a loader that
fetches remote script is blocked by the Content-Security-Policy on most sites
worth annotating. That makes for a large bookmark (~170 KB, most of it the emoji
set) — browsers handle it fine, but it is why the emoji data is stored as hex
codepoints rather than literal characters: percent-encoding triples every
non-ASCII byte.

**Whether it runs is the site's decision, not yours.** Chrome enforces a page's
Content-Security-Policy against `javascript:` URLs, so the bookmarklet is refused
on sites with a strict one. `test/csp.mjs` checks the four cases against a real
server:

| The page sends | Bookmarklet |
|---|---|
| no CSP | runs |
| `script-src … 'unsafe-inline'` | runs |
| `script-src 'self'` | **blocked** |
| `default-src 'self'` (no `script-src`) | **blocked** |

In practice (checked live): **Substack sends only `frame-ancestors`**, so the
bookmarklet works across Substack, custom domains included. The NYT allows
`'unsafe-inline'`, so it works there too. GitHub sends `default-src 'none'` and
refuses it. The extension injects through `chrome.scripting`, which a page's CSP
does not govern — that's the fallback wherever the bookmarklet is refused.

### Sharing it with readers

You cannot put the bookmarklet in a post. Every CMS sanitizer strips
`javascript:` hrefs — that's XSS 101, and Substack is no exception. Publish
`dist/` somewhere you control (it's a complete static site; marginer.app is a
Cloudflare Pages deploy of it) and link *that* from the post: "drag this to your bookmarks bar." The drag
gesture has to happen on a page you serve.

### Userscript — the "this page has notes" indicator

A bookmarklet cannot tell you a page is already annotated. Nothing of it runs
until you click it, so there is no hook to hang an indicator on. A userscript is
the fix: install `dist/marginer.user.js` in Tampermonkey or Violentmonkey.

Revisit a page you annotated and your highlights come back on their own, with a
small pill in the bottom-right corner showing the count. Press ⌘⇧U / Ctrl+Shift+U
to open Marginer anywhere else.

On a page with **no** notes it injects nothing at all — no styles, no nodes, no
observers. It reads one `localStorage` key and stops. That key is the same one the
bookmarklet uses (`@grant none` puts the script in the page's own context), so
notes taken with either show up under the other and you can install both.

| | Bookmarklet | Userscript | Extension |
|---|---|---|---|
| Install | drag a link | needs Tampermonkey | load unpacked |
| Tells you a page has notes | no | **yes** | on click |
| Survives a strict CSP | often not | yes | yes |
| Stored in | site `localStorage` | site `localStorage` | `chrome.storage` |

## Using it

It boots in **view mode**: the notes are on the page from the start, floating
beside their highlights, with a small pill bar in the corner. The sidebar — the
text pane — is one click away (⊟ on the bar, or click any highlight while
collapsed). Collapsed to the pill, a hovered highlight peeks its note.

| | |
|---|---|
| Select any text | the note panel opens on the spot, beside the selection |
| Select with the sidebar open | the quote lands at the end of the pane, caret on the line beneath — type the reply |
| Click a reaction | lands immediately — margin chip and card appear as you click |
| Type an emoji at the front | identical to picking one; the margin updates as you type |
| ＋ in the picker | the full CLDR set, ~1,900 emoji, searchable; your most-used lead it |
| Reactions per note | no limit — the bar wraps rather than hiding any |
| Click away | keeps what you wrote; an untouched panel (or a quote with nothing under it) leaves no trace |
| ⌘↵ | save, including a bare highlight with no note |
| Esc | cancel the whole thing |
| ⌥-click an image | annotate a figure on its own |
| Edit the pane | the page re-anchors as you type; delete a `>` line and its highlight goes. Quote lines are tinted (a mirror layer behind the textarea — the only way to style lines in one) |
| Click a highlight | drops the caret at the end of its reply (in view mode: opens its card; collapsed: opens the pane) |
| Hover a highlight, collapsed | peeks its note beside the text |
| The caret's block | is the active one — its highlight brightens on the page |
| ⊞ in the header | **view mode**: cards float beside the text, level with their highlights |
| Click a card | scrolls to its highlight and opens it for editing; ✕ deletes it, with an undo |
| 👁 | hide highlights to read the page clean |
| **Copy markdown** | the whole document, ready to paste |

The sidebar **squeezes the page rather than covering it**: while it's open the
document gets a right margin of the sidebar's width, so a centered column
re-centers in the space that's left. (Fixed-position site furniture ignores
that margin — nothing to be done there.)

**View mode** is the Google-Docs layout. Cards float in the page's right
gutter at the height of their highlight; where two would collide they stack
downward, and the card you're editing pins itself level with its highlight
(a short lead line joins the two) and pushes its neighbours out of the way. It's the boot state. A full-bleed page with no gutter has one
squeezed out of it, by the same margin trick — and since squeezing a centered
column only yields half the margin as gutter, the code measures what one push
gained and extrapolates rather than iterating. The choice of mode is
remembered.

The emoji picker keeps count of what you pick. Your most-used emoji fill the
free slots of the quick bar (after the note's own reactions) and lead the full
picker under *Frequently used*.

Because the panel opens on *every* selection, it is built to cost nothing to
ignore: click away without touching it and no highlight is created. It also stays
out of form fields and rich-text editors, where a selection means you're writing
rather than reading.

Notes are keyed by URL (ignoring the `#fragment`) and come back when you revisit.
A note whose text can no longer be found on the page isn't thrown away — its card
dims to show the anchor is stale, and it still exports.

## Layout

| | |
|---|---|
| `src/anchor.ts` | text + image anchoring, lifted from Penumbra. Maps a flat string of the page's visible text to live DOM positions; resolves quotes back to `Range`s |
| `src/markdown.ts` | the document model: parse/serialize `> quote` + note blocks (with text spans, so the pane can map caret ↔ block), split leading emoji, render notes to HTML |
| `src/emoji-data.ts` | generated: ~1,900 emoji as codepoints + CLDR names + keywords. Rebuild with `tools/gen-emoji.py` |

**Why the emoji list is a data file and not a loop.** You can walk the emoji
codepoint ranges at runtime, but 522 of the 1,910 entries are multi-codepoint
sequences — every country flag, and every ZWJ combination like 🤷‍♀️ — which no
range walk produces. And a loop yields no names, so there is nothing to search:
codepoints alone are 17 KB, CLDR names take it to 43 KB, and the emojilib
keywords (what makes "lol" find 🤣) take it to 84 KB. The searchable half is the
expensive half, and it is the half worth having.
| `src/app.ts` | the whole UI — the text pane, view mode, compose popover, margin chips, highlight painting |
| `src/store.ts` | `chrome.storage.local`, or `localStorage` for the bookmarklet; also the small cross-page prefs (layout mode, emoji usage) |
| `src/userscript.ts` | userscript shell: stays dormant until a page it already knows about shows up |
| `extension/` | MV3 shell: a background worker that injects the bundle on click |

Highlights are painted with the **CSS Custom Highlight API**, so the page's DOM is
never mutated — no wrapper `<span>`s, nothing for React to fight over. Images
can't be painted that way, so they get an absolutely-positioned overlay box.

## Development

```bash
npm run build     # bundle → dist/ + extension/
npm run watch     # rebuild on change
npm test          # end-to-end in real Chrome: annotate, export, reload, re-anchor
npm run shots     # screenshots into test/.shots/
```

`npm test` drives a real browser through the full loop for all three shells — a
click on an actual `javascript:` bookmarklet link, the extension loaded unpacked
with its service worker, and the userscript's silence on unannotated pages — so it
catches the anchoring and permission problems that unit tests miss.

## Not built yet

- **Sharing an annotated page as a web page.** The export is already a portable
  document, so this is a publish step (markdown + the source URL → a page that
  re-anchors on load), not a rewrite.
- **A badge on the extension's toolbar icon.** Possible, but the service worker
  needs to read the active tab's URL to know whether it has notes, which means the
  `tabs` permission and a "read your browsing history" warning at install. The
  userscript gets the same indicator for free, so this is a deliberate hold.
- Cross-page index: every page you've annotated, in one list.
- Threaded replies — Penumbra has them, but they need identities to be worth much.
