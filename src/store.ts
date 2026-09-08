// Per-page persistence. One record per URL, holding the markdown document (which
// IS the annotation state -- see markdown.ts). Uses chrome.storage.local when
// running as the extension so notes survive across profiles and are readable by
// the popup; falls back to localStorage for the bookmarklet.

export type Doc = { url: string; title: string; md: string; updated: number }

const PREFIX = 'marginer:'

// Fragment-only differences are the same page; everything else (query included,
// since plenty of sites put the real content there) keys separately.
export function pageKey(href = location.href): string {
  try {
    const u = new URL(href)
    u.hash = ''
    return u.toString()
  } catch {
    return href
  }
}

type ChromeStorage = { get(k: string[]): Promise<Record<string, unknown>>; set(v: Record<string, unknown>): Promise<void>; remove(k: string): Promise<void> }
const chromeLocal: ChromeStorage | null = (() => {
  const c = (globalThis as any).chrome
  return c?.storage?.local?.get ? (c.storage.local as ChromeStorage) : null
})()

export async function loadDoc(key = pageKey()): Promise<Doc | null> {
  const k = PREFIX + key
  try {
    if (chromeLocal) {
      const got = await chromeLocal.get([k])
      return (got[k] as Doc) ?? null
    }
    const raw = localStorage.getItem(k)
    return raw ? (JSON.parse(raw) as Doc) : null
  } catch {
    return null // private mode, blocked storage, corrupt JSON -- start empty
  }
}

// Small, cross-page preferences (emoji usage). Loaded once at boot
// into a cache so the UI can read them synchronously; writes go through the
// cache and persist in the background.
export type Prefs = { emojiUse?: Record<string, number> }
const PREFS_KEY = PREFIX + 'prefs'
let prefs: Prefs = {}

export async function loadPrefs(): Promise<Prefs> {
  try {
    if (chromeLocal) prefs = ((await chromeLocal.get([PREFS_KEY]))[PREFS_KEY] as Prefs) ?? {}
    else prefs = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Prefs
  } catch {
    prefs = {}
  }
  return prefs
}

export const getPrefs = (): Prefs => prefs

export function setPref<K extends keyof Prefs>(k: K, v: Prefs[K]): void {
  prefs = { ...prefs, [k]: v }
  try {
    if (chromeLocal) void chromeLocal.set({ [PREFS_KEY]: prefs }).catch(() => {})
    else localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* blocked storage -- the session still has the in-memory copy */
  }
}

export async function saveDoc(md: string, key = pageKey()): Promise<void> {
  const k = PREFIX + key
  const doc: Doc = { url: key, title: document.title || key, md, updated: Date.now() }
  try {
    // An empty document is a deletion, so a cleared page leaves no residue.
    if (!md.trim()) {
      if (chromeLocal) await chromeLocal.remove(k)
      else localStorage.removeItem(k)
      return
    }
    if (chromeLocal) await chromeLocal.set({ [k]: doc })
    else localStorage.setItem(k, JSON.stringify(doc))
  } catch {
    /* storage full or blocked -- the in-memory session still works */
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
