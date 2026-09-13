// Per-page persistence. One record per URL, holding the markdown document (which
// IS the annotation state -- see markdown.ts). Where the bytes go is a
// StorageAdapter: the default uses chrome.storage.local when running as the
// extension so notes survive across profiles and are readable by the popup, and
// falls back to localStorage for the bookmarklet. An embedding site swaps in its
// own (a fetch to its API, say) with setStorage().

export type Doc = { url: string; title: string; md: string; updated: number }

// Small, cross-page preferences (emoji usage). Loaded once at boot into a
// cache so the UI can read them synchronously; writes go through the cache and
// persist in the background.
export type Prefs = { emojiUse?: Record<string, number> }

// What a storage backend has to provide. Keys are page URLs (see pageKey);
// the value is the page's markdown. Saving an EMPTY string means the page has
// no notes any more -- a backend may delete the record. Prefs are optional: a
// backend without them keeps the emoji ranking for the session only.
export interface StorageAdapter {
  loadDoc(key: string): Promise<string | null> | string | null
  saveDoc(key: string, md: string): Promise<void> | void
  loadPrefs?(): Promise<Prefs | null> | Prefs | null
  savePrefs?(prefs: Prefs): Promise<void> | void
}

const PREFIX = 'marginer:'

// Fragment-only differences are the same page; everything else (query included,
// since plenty of sites put the real content there) keys separately -- unless
// a site adapter has named the page's canonical URL, which then stands in for
// every URL the same post is served at.
let canonicalKey: string | null = null
export function setCanonicalKey(url: string | null): void { canonicalKey = url }

export function pageKey(href = location.href): string {
  if (canonicalKey && href === location.href) return canonicalKey
  try {
    const u = new URL(href)
    u.hash = ''
    return u.toString()
  } catch {
    return href
  }
}

// ---- the default adapter: chrome.storage.local, else localStorage -------------

type ChromeStorage = { get(k: string[]): Promise<Record<string, unknown>>; set(v: Record<string, unknown>): Promise<void>; remove(k: string): Promise<void> }
const chromeLocal: ChromeStorage | null = (() => {
  const c = (globalThis as any).chrome
  return c?.storage?.local?.get ? (c.storage.local as ChromeStorage) : null
})()

const PREFS_KEY = PREFIX + 'prefs'

export const defaultStorage: StorageAdapter = {
  async loadDoc(key) {
    const k = PREFIX + key
    if (chromeLocal) {
      const got = await chromeLocal.get([k])
      return (got[k] as Doc | undefined)?.md ?? null
    }
    const raw = localStorage.getItem(k)
    return raw ? (JSON.parse(raw) as Doc).md : null
  },
  async saveDoc(key, md) {
    const k = PREFIX + key
    // An empty document is a deletion, so a cleared page leaves no residue.
    if (!md.trim()) {
      if (chromeLocal) await chromeLocal.remove(k)
      else localStorage.removeItem(k)
      return
    }
    const doc: Doc = { url: key, title: document.title || key, md, updated: Date.now() }
    if (chromeLocal) await chromeLocal.set({ [k]: doc })
    else localStorage.setItem(k, JSON.stringify(doc))
  },
  async loadPrefs() {
    if (chromeLocal) return ((await chromeLocal.get([PREFS_KEY]))[PREFS_KEY] as Prefs) ?? {}
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Prefs
  },
  async savePrefs(p) {
    if (chromeLocal) await chromeLocal.set({ [PREFS_KEY]: p })
    else localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  },
}

let storage: StorageAdapter = defaultStorage
export function setStorage(adapter: StorageAdapter | null): void { storage = adapter ?? defaultStorage }
export const getStorage = (): StorageAdapter => storage

// A backend that fails (private mode, blocked storage, corrupt JSON, a network
// that is down) must never take the UI with it: the in-memory session still
// works, and the failure is logged rather than thrown.
const warn = (what: string, e: unknown) => { try { console.warn(`[marginer] ${what}`, e) } catch { /* no console */ } }

export async function loadDoc(key = pageKey()): Promise<Doc | null> {
  try {
    const md = await storage.loadDoc(key)
    return md == null ? null : { url: key, title: document.title || key, md, updated: 0 }
  } catch (e) {
    warn('load failed', e)
    return null
  }
}

export async function saveDoc(md: string, key = pageKey()): Promise<void> {
  try {
    await storage.saveDoc(key, md)
  } catch (e) {
    warn('save failed', e)
  }
}

let prefs: Prefs = {}

export async function loadPrefs(): Promise<Prefs> {
  try {
    prefs = (await storage.loadPrefs?.()) ?? {}
  } catch (e) {
    warn('prefs load failed', e)
    prefs = {}
  }
  return prefs
}

export const getPrefs = (): Prefs => prefs

export function setPref<K extends keyof Prefs>(k: K, v: Prefs[K]): void {
  prefs = { ...prefs, [k]: v }
  try {
    const r = storage.savePrefs?.(prefs)
    if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch((e) => warn('prefs save failed', e))
  } catch (e) {
    warn('prefs save failed', e)
  }
}

// Per-site: should the userscript open Marginer on its own on this site? It
// lives in the site's own localStorage, which is what the userscript (in the
// page's context) and the bookmarklet share -- so the unit of opting in is the
// site, and the choice is visible to both.
const AUTO_KEY = PREFIX + 'auto-open'
export function autoOpen(): boolean {
  try { return localStorage.getItem(AUTO_KEY) === '1' } catch { return false }
}
export function setAutoOpen(on: boolean): void {
  try { if (on) localStorage.setItem(AUTO_KEY, '1'); else localStorage.removeItem(AUTO_KEY) } catch { /* blocked storage */ }
}
