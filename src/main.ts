import { Marginer } from './app'

// One instance per page, parked on window so a second injection (clicking the
// extension icon again, or re-running the bookmarklet) toggles the sidebar
// instead of stacking a second copy of the UI on top of the first.
declare global {
  interface Window { __marginer?: Marginer }
}

const existing = window.__marginer
if (existing) {
  existing.toggleOpen()
} else {
  const m = new Marginer()
  window.__marginer = m
  m.init().catch((e) => console.error('[marginer] init failed', e))
}
