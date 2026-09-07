import { EMOJI_BLOB } from './emoji-data'
import { splitLeadingEmojis } from './markdown'
import { getPrefs, setPref } from './store'

// Reactions are not a separate field. A note's LEADING emoji ARE its reactions —
// so clicking one in the picker and typing one at the front of the note are the
// same act, and both put a chip in the margin. See markdown.ts.

export const QUICK_EMOJI = ['👍', '❤️', '🔥', '😄', '🤔', '🎯']
const BAR_SLOTS = 6      // buttons that fit on one row; the bar wraps past that
const GRID_LIMIT = 400   // rendered at once; search narrows past this
const FREQUENT = 8       // the "frequently used" row in the full picker

// [char, searchable text] for the full CLDR set, unpacked from the blob on first
// use so pages that never open the picker never pay for it.
let DATA: [string, string][] | null = null
const emojiData = (): [string, string][] =>
  (DATA ??= EMOJI_BLOB.split('\n').map((line) => {
    const [cps, name, extra] = line.split('\t')
    const parts = cps.split('-').map((h) => parseInt(h, 16))
    // Legacy symbols like ☺ (U+263A) default to TEXT presentation: bare, they
    // draw as a thin monochrome glyph, in the picker and in the note alike.
    // The variation selector asks for the color emoji.
    if (parts.length === 1 && parts[0] < 0x1f000) parts.push(0xfe0f)
    const ch = String.fromCodePoint(...parts)
    return [ch, extra ? `${name} ${extra}` : name] as [string, string]
  }))

// ---- usage -------------------------------------------------------------------
// Every emoji picked is counted, and the most-picked lead both the quick bar
// (its free slots, after the note's own reactions) and the full picker.
const USE_CAP = 200 // distinct emoji remembered; the long tail is dropped

function noteUse(e: string) {
  const use = { ...(getPrefs().emojiUse ?? {}) }
  use[e] = (use[e] ?? 0) + 1
  const kept = Object.entries(use).sort((a, b) => b[1] - a[1]).slice(0, USE_CAP)
  setPref('emojiUse', Object.fromEntries(kept))
}

export function frequentEmoji(n: number): string[] {
  const use = getPrefs().emojiUse ?? {}
  return Object.keys(use).sort((a, b) => use[b] - use[a]).slice(0, n)
}

// Match on WORD starts, not bare substrings: "cat" should find 🐱, not every
// emoji whose description happens to contain "edu(cat)ion" or "notifi(cat)ion".
// Falls back to a substring pass so a half-typed word still finds something.
function search_(all: [string, string][], q: string): [string, string][] {
  const at = new RegExp('\\b' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const words = all.filter(([e, kw]) => at.test(kw) || e === q)
  return words.length ? words : all.filter(([, kw]) => kw.includes(q))
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Toggle `emoji` in the leading run of a note, leaving the prose untouched.
// Adding puts it at the end of the run, so the order matches the order clicked.
export function toggleLeadingEmoji(note: string, emoji: string): string {
  const { emojis, text } = splitLeadingEmojis(note ?? '')
  const i = emojis.indexOf(emoji)
  if (i >= 0) emojis.splice(i, 1)
  else emojis.push(emoji)
  const lead = emojis.join('')
  const rest = text.replace(/^\s+/, '')
  if (!lead) return rest
  return rest ? `${lead} ${rest}` : lead
}

// A picker bound to a live note: `getNote` reads it (so the selected state stays
// in sync however the note is edited — including by typing) and `onToggle` is
// handed the new note text.
export function buildEmojiPanel(getNote: () => string, onToggle: (note: string) => void): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'mg-emojipanel'
  wrap.innerHTML = `
    <div class="mg-emojibar" data-bar></div>
    <div class="mg-emojimore" data-more hidden>
      <input class="mg-emoji-search" placeholder="Search 1,900 emoji…">
      <div class="mg-emojigrid" data-grid></div>
      <div class="mg-emojinote" data-note hidden></div>
    </div>`
  const bar = wrap.querySelector('[data-bar]') as HTMLElement
  const grid = wrap.querySelector('[data-grid]') as HTMLElement
  const more = wrap.querySelector('[data-more]') as HTMLElement
  const note = wrap.querySelector('[data-note]') as HTMLElement
  const search = wrap.querySelector('.mg-emoji-search') as HTMLInputElement

  // Tapping an emoji must NOT steal focus from the note field (that's what makes
  // an open card feel like it closed). preventDefault on the buttons keeps focus;
  // the search input is excluded so it can still be focused and typed into.
  bar.addEventListener('mousedown', (e) => e.preventDefault())
  grid.addEventListener('mousedown', (e) => e.preventDefault())
  // renderBar() detaches the clicked button mid-click; without stopping here the
  // click bubbles to the document handler with an orphaned target (no [data-mg-ui]
  // ancestor), which then reads as a click-away and tears the panel down.
  wrap.addEventListener('click', (e) => e.stopPropagation())

  const btn = (e: string, sel: string[]) =>
    `<button type="button" class="${sel.includes(e) ? 'selected' : ''}" data-e="${esc(e)}">${esc(e)}</button>`
  const wire = (el: HTMLElement) =>
    el.querySelectorAll('[data-e]').forEach((b) =>
      b.addEventListener('click', (ev) => { ev.stopPropagation(); tap((b as HTMLElement).dataset.e!) }))

  const renderGrid = () => {
    const sel = splitLeadingEmojis(getNote()).emojis
    const q = search.value.trim().toLowerCase()
    const all = emojiData()
    const hits = q ? search_(all, q) : all
    const frequent = q ? [] : frequentEmoji(FREQUENT)
    const head = (t: string) => `<div class="mg-emojihead">${t}</div>`
    grid.innerHTML =
      (frequent.length ? head('Frequently used') + frequent.map((e) => btn(e, sel)).join('') + head('All emoji') : '') +
      hits.slice(0, GRID_LIMIT).map(([e]) => btn(e, sel)).join('')
    note.hidden = hits.length <= GRID_LIMIT
    note.textContent = `${hits.length - GRID_LIMIT} more — keep typing to narrow`
    wire(grid)
  }
  const renderBar = () => {
    const sel = splitLeadingEmojis(getNote()).emojis
    // EVERY emoji on the note leads the bar and stays visible -- there's no cap on
    // how many a note can carry, so the bar wraps rather than hiding some. The
    // rest of the first row is your most-used emoji, then the defaults.
    const picks = [...new Set([...frequentEmoji(BAR_SLOTS), ...QUICK_EMOJI])]
    const quick = picks.filter((e) => !sel.includes(e)).slice(0, Math.max(0, BAR_SLOTS - sel.length))
    bar.innerHTML = sel.map((e) => btn(e, sel)).join('') + quick.map((e) => btn(e, sel)).join('') +
      `<button type="button" class="mg-emoji-more" data-act="more" title="All emoji">＋</button>`
    wire(bar)
    bar.querySelector('[data-act="more"]')!.addEventListener('click', (ev) => {
      ev.stopPropagation()
      more.hidden = !more.hidden
      if (!more.hidden) {
        // Opens upward (clear of the note being typed) unless that would run
        // off the top of the window -- the first card in the sidebar, say.
        more.classList.toggle('below', wrap.getBoundingClientRect().top < 300)
        renderGrid(); search.focus()
      }
    })
  }
  const tap = (e: string) => {
    const before = splitLeadingEmojis(getNote()).emojis
    if (!before.includes(e)) noteUse(e) // adding counts as use; taking it off doesn't
    onToggle(toggleLeadingEmoji(getNote(), e))
    renderBar()
    if (!more.hidden) renderGrid()
  }
  // Keep the picker honest when the note is edited by typing instead of clicking.
  const refresh = () => { renderBar(); if (!more.hidden) renderGrid() }
  ;(wrap as any).refresh = refresh
  search.addEventListener('input', renderGrid)
  renderBar()
  return wrap
}

export const refreshEmojiPanel = (el: HTMLElement | null | undefined) => (el as any)?.refresh?.()
