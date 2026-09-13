// The embeddable build: a site owner drops this on their own pages so readers
// can highlight and note, with the notes going wherever the site says (its API,
// say) and the owner's own marginalia shown to everyone as a read-only layer.
//
//   import { init } from 'marginer-embed.esm.js'          // or window.Marginer.init
//   const m = init({ storage, layers: [{ id: 'author', label: 'Joshua', doc }] })
//   m.destroy()
//
// Nothing here touches the DOM at import time, so it is safe to import from
// code that also runs on the server (Astro, say): init() is a no-op there.

import { Marginer, type Layer } from './app'
import { defaultStorage, setStorage, type Prefs, type StorageAdapter } from './store'

export type { Layer, Prefs, StorageAdapter }
export { Marginer }

export type EmbedOptions = {
  // Where the reader's notes live. Default: this browser's localStorage.
  storage?: StorageAdapter
  // Read-only notes shown alongside the reader's own (the author's, say).
  layers?: Layer[]
  // Boot as a passive indicator: highlights and the pill, notes on hover.
  collapsed?: boolean
  // The page's storage key. Default: its URL without the fragment.
  key?: string
  // Called with the page's markdown after every save (a hook for analytics,
  // or for a site that wants to mirror the document somewhere else).
  onSave?: (md: string) => void
}

declare global {
  interface Window { __marginer?: Marginer }
}

// Wrap a storage so `onSave` sees every save, and so failures in the site's
// backend never throw into the UI (store.ts logs them).
function withHook(base: StorageAdapter, onSave?: (md: string) => void): StorageAdapter {
  return {
    loadDoc: (key) => base.loadDoc(key),
    saveDoc: async (key, md) => { await base.saveDoc(key, md); onSave?.(md) },
    loadPrefs: base.loadPrefs ? () => base.loadPrefs!() : undefined,
    savePrefs: base.savePrefs ? (p: Prefs) => base.savePrefs!(p) : undefined,
  }
}

// Boot Marginer on this page. Returns the instance (destroy() takes it down
// again -- call it before a client-side navigation swaps the article out), or
// null where there is no document to draw on.
export function init(options: EmbedOptions = {}): Marginer | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null
  // One per page: a second init (a framework re-running its scripts) replaces
  // the first rather than stacking a second UI on top of it.
  window.__marginer?.destroy()
  setStorage(withHook(options.storage ?? defaultStorage, options.onSave))
  const m = new Marginer()
  window.__marginer = m
  m.init({ collapsed: options.collapsed, layers: options.layers, key: options.key ?? null, site: false })
    .catch((e) => console.error('[marginer] init failed', e))
  return m
}
