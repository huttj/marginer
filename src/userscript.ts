import { Marginer } from './app'
import { completePendingReply } from './comments'
import { autoOpen, loadDoc } from './store'

// The userscript shell. Unlike the bookmarklet and the extension — which only run
// when you ask them to — this loads on every page, so its first duty is to be
// invisible. It reads one localStorage key and, unless this page already has
// notes, injects nothing at all: no styles, no nodes, no observers.
//
// It shares that key with the bookmarklet (same origin, same `localStorage`), so
// notes taken with one show up under the other.
declare global {
  interface Window { __marginer?: Marginer }
}

const SHORTCUT = (e: KeyboardEvent) =>
  (e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'U' || e.key === 'u')

async function summon(collapsed: boolean) {
  if (window.__marginer) { window.__marginer.toggleOpen(); return }
  const m = new Marginer()
  window.__marginer = m
  await m.init({ collapsed, autoOpenToggle: true })
}

// ⌘⇧U / Ctrl+Shift+U brings up the full UI on any page, annotated or not — so the
// userscript replaces the bookmarklet rather than sitting beside it.
document.addEventListener('keydown', (e) => {
  if (!SHORTCUT(e)) return
  e.preventDefault()
  void summon(false)
})

async function boot() {
  void completePendingReply() // a reply that came here via a comment permalink
  // A site you've opted into gets the full UI on every page. Elsewhere, a page
  // with notes gets the pill; a page without gets nothing at all.
  if (autoOpen()) { await summon(false); return }
  const doc = await loadDoc()
  if (!doc?.md?.trim()) return // no notes here — stay out of the way entirely
  await summon(true)
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void boot())
else void boot()
