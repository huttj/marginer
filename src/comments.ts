// The comments ARE the shared annotations. A reader pastes their Marginer export
// into the page's own comment box; anyone with Marginer sees those comments in
// place. There is no server of ours in the loop: the site keeps the comments,
// its identity and moderation apply, and this module only READS them.
//
// A site adapter finds the post's comments (Substack first: the same JSON its
// own page uses, same-origin so cookies and CSP behave). The thread builder then
// turns comments whose `> quote` lines anchor in the article into threads.

import { stripWrapper } from './export'
import { parseResponse, type RBlock } from './markdown'

export type Comment = {
  id: string
  author: string
  body: string
  parentId: string | null
  date: string
  permalink: string
}

export type Site = {
  name: 'substack'
  // The post's one true URL (its publication page), whatever page it's being
  // read on. Notes are keyed by it, so the reader and the publication page
  // share a document -- within one storage, that is (see store.ts).
  canonical: string | null
  // The article itself. Comments render on the same page, so a quote must be
  // looked for HERE, or a comment's `> quote` would anchor to its own text.
  article(): Element
  fetchComments(): Promise<Comment[]>
  // The reply box for comment `id`, opened if need be -- null when the comment
  // isn't on this page (use the permalink then).
  openReplyBox(id: string): Promise<HTMLTextAreaElement | null>
  permalink(id: string): string
}

// ---- Substack ----------------------------------------------------------------

const SUBSTACK_POST = /^\/p\/([^/?#]+)/
const SUBSTACK_READER = /^\/home\/post\/p-(\d+)/

// A post is served two ways: on its publication (`pub.substack.com/p/slug`, or
// a custom domain) and in Substack's reader (`substack.com/home/post/p-<id>`).
// The reader page's canonical link names the publication, whose API it calls
// itself, cross-origin -- so the same endpoints work from either page.
export function detectSite(): Site | null {
  const isSubstack = !!document.querySelector('script[src*="substackcdn.com"], link[href*="substackcdn.com"], meta[content*="substack" i]')
  if (!isSubstack) return null
  const canonical = (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href ?? ''
  let base = location.origin
  let slug: string | null = null
  let postId: number | null = null
  const onPub = SUBSTACK_POST.exec(location.pathname)
  const inReader = SUBSTACK_READER.exec(location.pathname)
  if (onPub) slug = onPub[1]
  else if (inReader) {
    postId = Number(inReader[1])
    try {
      const c = new URL(canonical)
      const cm = SUBSTACK_POST.exec(c.pathname)
      if (cm) { base = c.origin; slug = cm[1] }
    } catch { /* no canonical: the by-id lookup below fills these in */ }
  } else return null
  const post = () => `${base}/p/${slug}`
  return {
    name: 'substack',
    canonical: slug ? post() : null,
    article: () => document.querySelector('.available-content, .body.markup, article') ?? document.body,
    async fetchComments() {
      // The page's own JSON: the post id from the slug (or the slug from the id,
      // in the reader), then the comments as a tree, flattened here with parent
      // pointers. Deleted bodies are dropped.
      if (postId && !slug) {
        const p = await (await fetch(`https://substack.com/api/v1/posts/by-id/${postId}`, { credentials: 'include' })).json()
        const canon = p?.post?.canonical_url ?? p?.canonical_url
        try { const c = new URL(canon); base = c.origin; slug = SUBSTACK_POST.exec(c.pathname)?.[1] ?? null } catch { /* stay */ }
      }
      if (!postId && slug) {
        const p = await (await fetch(`${base}/api/v1/posts/${encodeURIComponent(slug)}`, { credentials: 'include' })).json()
        postId = p?.id ?? null
      }
      const id = postId
      if (!id) return []
      const r = await (await fetch(`${base}/api/v1/post/${id}/comments?all_comments=true&sort=oldest_first`, { credentials: 'include' })).json()
      const out: Comment[] = []
      const walk = (c: any, parentId: string | null) => {
        if (!c || c.deleted) return
        const cid = String(c.id)
        if (c.body) out.push({ id: cid, author: c.name || 'Anonymous', body: String(c.body), parentId, date: c.date || '', permalink: `${post()}/comment/${cid}` })
        for (const ch of c.children ?? []) walk(ch, cid)
      }
      for (const c of r?.comments ?? []) walk(c, null)
      return out
    },
    openReplyBox: (id) => openSubstackReplyBox(id),
    permalink: (id) => `${post()}/comment/${id}`,
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Substack's comment markup: `.comment` holds `#comment-<id>` (an anchor), the
// comment itself (`[role=article]`, whose actions row has an <a>Reply</a> --
// "Reply (2)" once it has replies) and then a nested `.comment-list` of its
// children. So "this comment's" controls and box are the ones whose nearest
// `.comment` is this one, and not a child's.
async function openSubstackReplyBox(id: string): Promise<HTMLTextAreaElement | null> {
  const anchor = document.getElementById(`comment-${id}`)
  const box = anchor?.closest('.comment') as HTMLElement | null
  if (!box) return null
  const own = (el: Element) => el.closest('.comment') === box
  const boxes = () => Array.from(box.querySelectorAll('textarea')).find(own) ?? null
  const open = boxes()
  if (open) return open
  const ctl = Array.from(box.querySelectorAll('a, button')).find((el) => own(el) && /^\s*reply\b/i.test(el.textContent ?? ''))
  if (!ctl) return null
  ;(ctl as HTMLElement).click()
  for (let i = 0; i < 20; i++) {
    await sleep(100)
    const ta = boxes()
    if (ta) return ta
  }
  return null
}

// ---- threads -------------------------------------------------------------------

// One quote+note from one comment, with where it came from.
export type Entry = {
  commentId: string
  author: string
  date: string
  permalink: string
  depth: number        // nesting under the thread's root comment
  block: RBlock
}

// A top-level comment and everything under it, reduced to the entries that
// quote the article. `entries` are in tree order (a reply follows what it
// replies to; siblings by date), which is the order they are shown in.
export type Thread = { rootId: string; author: string; entries: Entry[] }

// Build threads from a flat comment list. `anchors` says whether a block's quote
// is found on the page -- that is the whole test for "this is an annotation":
// a hand-written `> quote` reply counts, a quote of something else does not.
export function buildThreads(comments: Comment[], anchors: (b: RBlock) => boolean): Thread[] {
  const byParent = new Map<string | null, Comment[]>()
  for (const c of comments) {
    const list = byParent.get(c.parentId) ?? []
    list.push(c)
    byParent.set(c.parentId, list)
  }
  for (const list of byParent.values()) list.sort((a, b) => a.date.localeCompare(b.date))

  const threads: Thread[] = []
  for (const root of byParent.get(null) ?? []) {
    const entries: Entry[] = []
    const walk = (c: Comment, depth: number) => {
      for (const block of parseResponse(stripWrapper(c.body)).blocks) {
        if (!block.quotes.length || !anchors(block)) continue
        entries.push({ commentId: c.id, author: c.author, date: c.date, permalink: c.permalink, depth, block })
      }
      for (const ch of byParent.get(c.id) ?? []) walk(ch, depth + 1)
    }
    walk(root, 0)
    if (entries.length) threads.push({ rootId: root.id, author: root.author, entries })
  }
  return threads
}

// Group a thread's entries by the passage they quote, keeping tree order within
// each group. Two entries quote "the same passage" when their first quote piece
// and occurrence match -- the same rule the anchoring uses.
export function groupByAnchor(entries: Entry[]): Entry[][] {
  const groups = new Map<string, Entry[]>()
  for (const e of entries) {
    const key = `${e.block.nths[0] ?? 1}:${e.block.quotes.join(' | ')}`
    const g = groups.get(key) ?? []
    g.push(e)
    groups.set(key, g)
  }
  return [...groups.values()]
}

// Put text into a framework-managed textarea so the page notices: React and
// friends ignore a plain `.value =` unless the native setter and an input
// event are used.
export function fillTextarea(ta: HTMLTextAreaElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  if (setter) setter.call(ta, text); else ta.value = text
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  ta.focus()
  ta.setSelectionRange(text.length, text.length)
}

// A reply that had to travel via the comment's permalink: once that page has
// the comment, open ITS reply box and fill it. The userscript runs this on
// every load; it does nothing unless a reply is pending for this very URL.
export const PENDING_KEY = 'marginer:pending-reply'
export type Pending = { url: string; id: string; text: string }

export async function completePendingReply(): Promise<boolean> {
  let pending: Pending | null = null
  try { pending = JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null') } catch { /* nothing pending */ }
  if (!pending || !location.href.startsWith(pending.url)) return false
  for (let i = 0; i < 40; i++) {
    if (document.getElementById(`comment-${pending.id}`)) break
    await sleep(200)
  }
  const ta = await openSubstackReplyBox(pending.id)
  if (!ta) return false
  fillTextarea(ta, pending.text)
  ta.scrollIntoView({ block: 'center' })
  localStorage.removeItem(PENDING_KEY)
  return true
}
