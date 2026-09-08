// All of Marginer's CSS, injected as one <style>. Everything is scoped under
// [data-mg-ui] or an .mg- class and uses its own token set, so it neither reads
// nor leaks the host page's styles.
export const CSS = `
:root {
  --mg-bg: #ffffff;
  --mg-fg: #1a1a1a;
  --mg-muted: #6b7280;
  --mg-border: #e4e4e7;
  --mg-shadow: 0 4px 22px rgba(0,0,0,.13);
  --mg-accent: #b9770a;
  --mg-accent-fg: #ffffff;
  --mg-chip: #f3f3f5;
  --mg-chip-hover: #e9e9ec;
  --mg-danger: #e0533b;
}
/* Marginer runs on other people's pages, so the theme follows the PAGE's own
   background (measured at boot, stamped as data-mg-theme) rather than the OS --
   a dark panel floating over a white article reads as broken. The OS preference
   is the fallback for pages whose background we can't determine. */
@media (prefers-color-scheme: dark) {
  :root:not([data-mg-theme="light"]) {
    --mg-bg: #232328; --mg-fg: #e9e9ec; --mg-muted: #9b9ba4; --mg-border: #3a3a42;
    --mg-shadow: 0 4px 22px rgba(0,0,0,.5); --mg-accent: #e0a52e; --mg-accent-fg: #1a1a1a;
    --mg-chip: #2e2e35; --mg-chip-hover: #3a3a42; --mg-danger: #ff6f56;
  }
}
:root[data-mg-theme="dark"] {
  --mg-bg: #232328; --mg-fg: #e9e9ec; --mg-muted: #9b9ba4; --mg-border: #3a3a42;
  --mg-shadow: 0 4px 22px rgba(0,0,0,.5); --mg-accent: #e0a52e; --mg-accent-fg: #1a1a1a;
  --mg-chip: #2e2e35; --mg-chip-hover: #3a3a42; --mg-danger: #ff6f56;
}

/* Translucent so it reads on any page background, light or dark. */
::highlight(marginer) { background-color: rgba(255, 196, 64, 0.34); }
::highlight(marginer-active) { background-color: rgba(255, 178, 43, 0.62); }
/* The pending selection, until it's committed. */
::highlight(marginer-draft) {
  background-color: rgba(255, 196, 64, 0.30);
  text-decoration: underline dotted; text-decoration-thickness: 2px;
}

[data-mg-ui], [data-mg-ui] * { box-sizing: border-box; }
[data-mg-ui] {
  font: 13.5px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  color: var(--mg-fg); font-weight: 400; letter-spacing: normal; text-align: left; text-transform: none;
}
[data-mg-ui] button { font: inherit; color: inherit; }
[data-mg-ui] [hidden], [data-mg-ui][hidden] { display: none !important; }

/* ---- image highlights: the Highlight API paints text only, so a quoted image
       gets a document-anchored box that scrolls with the page ---- */
.mg-imghl {
  position: absolute; pointer-events: none; border-radius: 4px;
  background: rgba(255, 196, 64, 0.26); outline: 2px solid rgba(255, 196, 64, 0.55); outline-offset: -1px;
}
.mg-imghl.active { background: rgba(255, 178, 43, 0.40); outline-color: var(--mg-accent); }
.mg-imghl.draft { outline-style: dashed; }

/* ---- sidebar ----
   Fixed to the right edge; the page is squeezed out from under it by an html
   margin of the same width (set from app.ts), so it sits BESIDE the content
   rather than over it. */
.mg-sidebar {
  position: fixed; top: 0; right: 0; bottom: 0; width: 380px; max-width: 92vw;
  z-index: 2147483644; display: flex; flex-direction: column;
  background: var(--mg-bg); border-left: 1px solid var(--mg-border);
}
/* The document itself: quotes and replies as text, edited in place. The
   textarea sits over a mirror layer carrying the same text, invisible, with the
   quote lines tinted -- the only way to style lines inside a textarea. Both
   layers share every metric that affects wrapping, so they stay in register. */
.mg-panewrap { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.mg-panebody { position: relative; min-height: 100%; }
.mg-pane, .mg-paneback {
  display: block; width: 100%; margin: 0; border: none; padding: 14px 16px 40px;
  font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  white-space: pre-wrap; overflow-wrap: anywhere; word-break: normal; tab-size: 4;
  letter-spacing: normal; text-transform: none; text-align: left;
}
.mg-paneback { min-height: 100%; color: transparent; pointer-events: none; background: var(--mg-bg); }
.mg-pane {
  position: absolute; inset: 0; height: 100%; overflow: hidden;
  resize: none; outline: none; background: transparent; color: var(--mg-fg);
}
.mg-pane::placeholder { color: var(--mg-muted); }
.mg-paneback .mg-q {
  background: rgba(185,119,10,.11); border-radius: 3px;
  box-shadow: -4px 0 0 rgba(185,119,10,.55), 4px 0 0 rgba(185,119,10,.11);
  box-decoration-break: clone; -webkit-box-decoration-break: clone;
}
.mg-paneback .mg-q.active { background: rgba(185,119,10,.24); box-shadow: -4px 0 0 var(--mg-accent), 4px 0 0 rgba(185,119,10,.24); }
/* a quote the page doesn't contain: marked, not tinted */
.mg-paneback .mg-q.orphan { background: none; box-shadow: -4px 0 0 rgba(128,128,128,.35); }
:root[data-mg-theme="dark"] .mg-paneback .mg-q { background: rgba(224,165,46,.16); }
:root[data-mg-theme="dark"] .mg-paneback .mg-q.active { background: rgba(224,165,46,.30); }
.mg-panebar { padding: 6px 10px 8px; border-top: 1px solid var(--mg-border); }
.mg-panebar .mg-emojipanel { position: relative; }
.mg-head {
  display: flex; align-items: center; gap: 6px; padding: 8px 10px;
  border-bottom: 1px solid var(--mg-border); flex-shrink: 0;
}
.mg-brand { font-weight: 700; font-size: 13px; margin-right: auto; display: flex; align-items: center; gap: 6px; }
.mg-count { color: var(--mg-muted); font-weight: 500; font-variant-numeric: tabular-nums; }
.mg-tbtn {
  background: none; border: none; cursor: pointer; border-radius: 7px;
  padding: 5px 8px; font-size: 13px; display: flex; align-items: center; gap: 5px;
}
.mg-tbtn:hover { background: var(--mg-chip-hover); }
.mg-tbtn.active { background: var(--mg-accent); color: var(--mg-accent-fg); }
.mg-tbtn[disabled] { opacity: .4; cursor: default; }
.mg-tbtn[disabled]:hover { background: none; }


.mg-foot {
  display: flex; gap: 8px; align-items: center; padding: 8px 10px;
  border-top: 1px solid var(--mg-border); flex-shrink: 0;
}
.mg-foot .mg-btn { flex: 1; justify-content: center; }
.mg-hint { font-size: 11.5px; color: var(--mg-muted); padding: 0 10px 8px; }

/* ---- cards ---- */
.mg-card {
  position: relative;
  background: var(--mg-bg); border: 1px solid var(--mg-border); border-radius: 11px;
  cursor: pointer; transition: border-color .15s ease, box-shadow .15s ease;
  /* A flex item in a column container shrinks by default, so a full list used to
     squash every card and clip its own content. Cards keep their height and the
     list scrolls; visible overflow also lets the emoji grid escape the card. */
  flex: 0 0 auto; overflow: visible;
}
.mg-card:hover, .mg-card.mg-emph { border-color: var(--mg-accent); }
.mg-card.focused { box-shadow: 0 0 0 1px var(--mg-accent); border-color: var(--mg-accent); cursor: default; }
.mg-card.orphan { opacity: .55; }
.mg-card.orphan .mg-quote { border-left-style: dashed; }

.mg-quote {
  font-size: 12px; color: var(--mg-muted); border-left: 3px solid var(--mg-accent);
  padding: 5px 9px; margin: 8px 10px; background: var(--mg-chip);
  border-radius: 0 6px 6px 0; white-space: pre-wrap; overflow-wrap: anywhere;
}
.mg-card:not(.focused) .mg-quote { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.mg-quote-img { padding: 4px 8px; }
.mg-quote-img img { display: block; max-height: 80px; max-width: 100%; width: auto; height: auto; border-radius: 5px; margin: 0; }

.mg-note { padding: 0 12px 10px; }
.mg-md { overflow-wrap: anywhere; }
.mg-md p { margin: .15em 0; }
.mg-md > :first-child { margin-top: 0; }
.mg-md > :last-child { margin-bottom: 0; }
.mg-md img { display: block; height: 56px; width: auto; max-width: 100%; border-radius: 6px; margin: 2px 0; }
.mg-md a { color: var(--mg-accent); }
.mg-md code { background: var(--mg-chip); border-radius: 4px; padding: 0 3px; font-size: .92em; }
.mg-md pre { background: var(--mg-chip); border-radius: 6px; padding: 6px 8px; overflow-x: auto; }
.mg-card:not(.focused) .mg-md { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.mg-muted { color: var(--mg-muted); font-style: italic; }

.mg-cardx {
  position: absolute; top: 5px; right: 5px; display: flex; padding: 3px; border-radius: 6px;
  background: var(--mg-bg); border: 1px solid transparent; color: var(--mg-muted);
  cursor: pointer; opacity: 0; transition: opacity .12s ease;
}
.mg-card:hover .mg-cardx, .mg-card.focused .mg-cardx, .mg-cardx:focus-visible { opacity: 1; }
.mg-cardx:hover { color: var(--mg-danger); border-color: var(--mg-border); }

/* tiny reactions hanging off the bottom edge of the card, as in Penumbra */
.mg-card-emoji {
  position: absolute; left: 12px; bottom: -8px; display: flex; gap: 3px;
  font-size: 13px; line-height: 1; filter: drop-shadow(0 1px 1px rgba(0,0,0,.2));
}

/* ---- other readers' notes: the picker, and their (read-only) cards ---- */
.mg-select {
  font: inherit; font-size: 12.5px; color: var(--mg-fg); background: var(--mg-chip);
  border: 1px solid var(--mg-border); border-radius: 7px; padding: 3px 6px; max-width: 150px;
  cursor: pointer;
}
.mg-select:hover { background: var(--mg-chip-hover); }
.mg-thread { padding: 0 12px 10px; display: flex; flex-direction: column; gap: 8px; }
.mg-entry { position: relative; padding-left: 8px; border-left: 2px solid var(--mg-border); }
.mg-entry:first-child { padding-left: 0; border-left: none; }
.mg-who { font-size: 12px; color: var(--mg-muted); margin-bottom: 2px; }
.mg-who b { color: var(--mg-fg); font-weight: 600; }
.mg-who a { color: var(--mg-muted); text-decoration: none; margin-left: 2px; }
.mg-who a:hover { color: var(--mg-accent); }
.mg-entry-emoji { font-size: 13px; line-height: 1; margin-top: 4px; }
.mg-entry .mg-btn.tiny { margin-top: 6px; padding: 2px 8px; font-size: 11.5px; }
.mg-card.mg-foreign .mg-md { display: block; -webkit-line-clamp: unset; }
.mg-sidebar.mg-foreign .mg-panebar, .mg-sidebar.mg-foreign .mg-hint { display: none; }
.mg-foot .mg-select { flex: 0 1 auto; }
.mg-bar .mg-btn.tiny { margin: 0 2px; }
/* an unsent reply, on the card: highlighted until Send */
.mg-entry.mg-draft {
  border-left: 2px dashed var(--mg-accent); background: rgba(185,119,10,.08);
  border-radius: 0 8px 8px 0; padding: 6px 8px 8px; margin-top: 6px;
}
.mg-entry.mg-draft .mg-who { display: flex; align-items: center; gap: 4px; }
.mg-draftx {
  margin-left: auto; background: none; border: none; padding: 2px; border-radius: 5px;
  color: var(--mg-muted); cursor: pointer; display: inline-flex; opacity: .7;
}
.mg-draftx:hover { color: var(--mg-danger); opacity: 1; }
.mg-entry.mg-draft textarea {
  width: 100%; resize: none; overflow: hidden; min-height: 30px; line-height: 1.5;
  font: 13.5px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  background: var(--mg-bg); color: var(--mg-fg); border: 1px solid var(--mg-border); border-radius: 7px; padding: 5px 7px;
}
.mg-entry.mg-draft textarea:focus { outline: none; border-color: var(--mg-accent); }
/* the reply panel: the note being answered, above the box */
.mg-re {
  font-size: 12.5px; color: var(--mg-muted); margin: 0 0 8px; padding: 4px 8px 4px 10px;
  border-left: 2px solid var(--mg-border); overflow-wrap: anywhere; max-height: 22vh; overflow-y: auto;
}
.mg-re b { color: var(--mg-fg); font-weight: 600; }

/* ---- view mode: the same cards, floating in the page's right gutter ---- */
.mg-beside .mg-card {
  position: absolute; z-index: 2147483643; box-shadow: 0 1px 4px rgba(0,0,0,.08);
}
.mg-beside .mg-card.mg-settled { transition: top .2s ease, border-color .15s ease, box-shadow .15s ease; }
.mg-beside .mg-card.focused, .mg-beside .mg-card:hover { z-index: 2147483644; box-shadow: var(--mg-shadow); }

/* view-mode toolbar: the sidebar's head, as a pill where the collapsed one sits */
.mg-bar {
  position: fixed; bottom: 14px; right: 14px; z-index: 2147483645;
  display: flex; align-items: center; gap: 2px; padding: 4px 6px 4px 12px;
  background: var(--mg-bg); border: 1px solid var(--mg-border); border-radius: 999px;
  box-shadow: var(--mg-shadow);
  /* It can sit over the bottom of the card column; recessed until wanted, like the pill. */
  opacity: .8; transition: opacity .15s ease;
}
.mg-bar:hover { opacity: 1; }
.mg-bar .mg-brand { margin-right: 6px; }
/* ---- buttons ---- */
.mg-btn {
  background: var(--mg-accent); color: var(--mg-accent-fg); border: none; border-radius: 7px;
  padding: 6px 12px; cursor: pointer; font: inherit; font-weight: 600;
  display: inline-flex; align-items: center; gap: 6px;
}
.mg-btn:hover { filter: brightness(1.06); }
.mg-btn.ghost { background: var(--mg-chip); color: var(--mg-fg); font-weight: 500; }
.mg-btn.ghost:hover { background: var(--mg-chip-hover); }
.mg-btn.danger:hover { background: var(--mg-danger); color: #fff; }
.mg-btn.tiny { padding: 3px 8px; font-size: 12px; font-weight: 500; }

/* ---- compose popover (on text selection) ---- */
.mg-compose {
  position: absolute; width: 340px; max-width: calc(100vw - 24px); z-index: 2147483646;
  background: var(--mg-bg); border: 1px solid var(--mg-border); border-radius: 11px;
  box-shadow: var(--mg-shadow); padding: 10px;
}
.mg-compose .mg-quote { margin: 0 0 8px; max-height: 22vh; overflow-y: auto; }
.mg-compose textarea, .mg-card textarea {
  width: 100%; resize: none; overflow-y: auto; max-height: 34vh; line-height: 1.5;
  font: 13.5px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  background: var(--mg-bg); color: var(--mg-fg);
  border: 1px solid var(--mg-border); border-radius: 8px; padding: 7px 8px;
}
.mg-compose textarea:focus { outline: 2px solid var(--mg-accent); outline-offset: -1px; }
.mg-card textarea:focus { outline: none; border-color: var(--mg-accent); }
.mg-composebar { margin-top: 8px; display: flex; gap: 8px; align-items: center; justify-content: space-between; }

/* ---- emoji picker ---- */
.mg-emojipanel { position: relative; }
.mg-emojibar { display: flex; flex-wrap: wrap; gap: 3px; align-items: center; }
/* The button box is a fixed size and only the GLYPH grows on hover. Scaling the
   button clipped it against the grid's scroll container and shoved its neighbours
   around; this leaves the grid perfectly still. */
/* The size is !important because these are <button>s on someone else's page,
   and a host rule like \`article button { width: auto }\` loaded after ours
   would let a narrow glyph shrink its cell and knock the grid out of line. */
.mg-emojibar button, .mg-emojigrid button {
  width: 32px !important; min-width: 32px !important; height: 30px !important; flex: 0 0 32px;
  padding: 0 !important; margin: 0 !important; display: inline-grid; place-items: center;
  font-size: 17px; line-height: 1;
  background: var(--mg-chip); border: 1px solid var(--mg-border);
  border-radius: 8px; cursor: pointer;
  transition: font-size .1s ease, background .1s ease;
}
.mg-emojibar button:hover, .mg-emojigrid button:hover {
  background: var(--mg-chip-hover); font-size: 22px;
}
.mg-emojibar button.selected, .mg-emojigrid button.selected {
  background: rgba(185,119,10,.22); border-color: var(--mg-accent);
}
.mg-emoji-more { font-size: 14px !important; color: var(--mg-muted); }
.mg-emoji-more:hover { font-size: 16px !important; }
.mg-emojimore {
  position: absolute; bottom: calc(100% + 6px); left: 0; width: 296px; z-index: 1;
  background: var(--mg-bg); border: 1px solid var(--mg-border); border-radius: 10px;
  box-shadow: var(--mg-shadow); padding: 8px;
}
.mg-emojimore.below { bottom: auto; top: calc(100% + 6px); }
.mg-emoji-search {
  width: 100%; background: var(--mg-bg); color: var(--mg-fg); font: inherit;
  border: 1px solid var(--mg-border); border-radius: 7px; padding: 5px 7px; margin-bottom: 6px;
}
.mg-emojigrid { display: flex; flex-wrap: wrap; gap: 3px; max-height: 208px; overflow-y: auto; }
.mg-emojihead { flex: 1 0 100%; font-size: 11px; font-weight: 600; color: var(--mg-muted); padding: 4px 2px 1px; }
.mg-emojihead:first-child { padding-top: 0; }
.mg-emojinote { font-size: 11px; color: var(--mg-muted); padding-top: 6px; }

/* ---- margin reaction chips: a cluster pinned to the left of the highlight ---- */
.mg-emote-stack {
  position: absolute; z-index: 2147483643; cursor: pointer;
  display: flex; align-items: center; transform: translateX(-100%);
}
.mg-emote {
  font-size: 16px; line-height: 1; white-space: nowrap; margin-left: -9px;
  filter: drop-shadow(0 1px 1px rgba(0,0,0,.18)); transition: margin-left .12s ease;
}
.mg-emote:first-child { margin-left: 0; }
/* no left margin to hang off (full-bleed layouts): sit after the line instead,
   left edge pinned, and read in natural order. */
.mg-emote-stack.right { transform: none; flex-direction: row-reverse; }
.mg-emote-stack.right .mg-emote { margin-left: 0; margin-right: -9px; }
.mg-emote-stack.right .mg-emote:first-child { margin-right: 0; }
.mg-emote-stack.right:hover .mg-emote, .mg-emote-stack.right.mg-emph .mg-emote { margin-left: 0; margin-right: 3px; }
.mg-emote-stack:hover .mg-emote, .mg-emote-stack.mg-emph .mg-emote { margin-left: 3px; }

/* ---- collapsed pill ---- */
/* Bottom-right, not top-right: the pill can appear unbidden (the userscript
   shows it on any page that already has notes), and sticky site headers live at
   the top. Slightly recessed until you look at it. */
.mg-fab {
  position: fixed; bottom: 14px; right: 14px; z-index: 2147483645;
  display: flex; align-items: center; gap: 6px;
  background: var(--mg-bg); border: 1px solid var(--mg-border); border-radius: 999px;
  box-shadow: var(--mg-shadow); padding: 6px 12px; cursor: pointer; font-weight: 600;
  opacity: .72; transition: opacity .15s ease, border-color .15s ease;
}
.mg-fab:hover { opacity: 1; border-color: var(--mg-accent); }

/* ---- toast ---- */
.mg-toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
  z-index: 2147483647; background: var(--mg-fg); color: var(--mg-bg);
  padding: 9px 16px; border-radius: 9px; box-shadow: var(--mg-shadow); font-weight: 600;
  display: flex; align-items: center; gap: 14px; animation: mg-toast-in .18s ease;
}
.mg-toast-act {
  background: none; border: none; padding: 0; cursor: pointer;
  color: var(--mg-accent); font: inherit; font-weight: 700; text-decoration: underline;
}
@keyframes mg-toast-in { from { opacity: 0; transform: translate(-50%, 8px); } }

/* ---- export dialog (clipboard fallback / "show me the markdown") ---- */
.mg-modal {
  position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,.45); padding: 24px;
}
.mg-modalbox {
  background: var(--mg-bg); border: 1px solid var(--mg-border); border-radius: 12px;
  box-shadow: var(--mg-shadow); width: 680px; max-width: 100%; max-height: 100%;
  display: flex; flex-direction: column; padding: 14px;
}
.mg-modalbox textarea {
  flex: 1; min-height: 320px; width: 100%; font: 12.5px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--mg-chip); color: var(--mg-fg); border: 1px solid var(--mg-border);
  border-radius: 8px; padding: 10px; resize: none; white-space: pre; overflow: auto;
}
.mg-modalfoot { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }

@media (max-width: 720px) {
  .mg-sidebar { width: 100%; max-width: 100%; top: auto; height: 55vh; border-left: none; border-top: 1px solid var(--mg-border); }
  .mg-emote-stack { display: none; }
}
`
