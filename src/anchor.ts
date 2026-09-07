// Text anchoring for the W3C Web Annotation model — no dependencies.
// We never mutate the document; we map between a flat string of the root's
// visible text and DOM (node, offset) positions, and resolve highlights as
// live Ranges rendered through the CSS Custom Highlight API.

export type TextQuoteSelector = { type: 'TextQuoteSelector'; exact: string; prefix?: string; suffix?: string }
export type TextPositionSelector = { type: 'TextPositionSelector'; start: number; end: number }
export type Selector = TextQuoteSelector | TextPositionSelector

const CONTEXT_LEN = 32
const NON_TEXT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE', 'IFRAME', 'OBJECT'])

type Index = { text: string; nodes: { node: Text; start: number; end: number }[] }

function buildIndex(root: Node): Index {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const el = (n as Text).parentElement
      if (!el) return NodeFilter.FILTER_REJECT
      // Skip Marginer's own injected UI, non-rendered text (script/style/template),
      // and anything the page has hidden — none of it is selectable, so including
      // it would shift every offset relative to what the reader actually sees.
      if (el.closest('[data-mg-ui]')) return NodeFilter.FILTER_REJECT
      if (NON_TEXT.has(el.tagName)) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  const nodes: Index['nodes'] = []
  let text = ''
  let n: Node | null
  while ((n = walker.nextNode())) {
    const t = n as Text
    const start = text.length
    text += t.data
    nodes.push({ node: t, start, end: text.length })
  }
  return { text, nodes }
}

function offsetToPoint(idx: Index, offset: number): { node: Text; offset: number } | null {
  for (const e of idx.nodes) {
    if (offset >= e.start && offset <= e.end) return { node: e.node, offset: offset - e.start }
  }
  const last = idx.nodes[idx.nodes.length - 1]
  return last ? { node: last.node, offset: last.node.data.length } : null
}

function nodeOffsetToFlat(idx: Index, node: Node, offset: number): number | null {
  // Find the flat offset for a (node, offset) DOM position.
  if (node.nodeType === Node.TEXT_NODE) {
    const e = idx.nodes.find((x) => x.node === node)
    return e ? e.start + offset : null
  }
  // Element position: the point sits between child nodes. Locate it by document
  // order against the indexed text — the start of the first text at/after the
  // point, else the end of the last text before it. This resolves boundaries that
  // land next to an image (an image-only <p> has no text node to map to, which
  // used to return null and silently drop the whole selection).
  const doc = node.ownerDocument ?? document
  const pt = doc.createRange()
  try { pt.setStart(node, offset); pt.collapse(true) } catch { return null }
  let before: number | null = null
  for (const e of idx.nodes) {
    const endR = doc.createRange(); endR.setStart(e.node, e.node.data.length); endR.collapse(true)
    if (pt.compareBoundaryPoints(Range.START_TO_START, endR) >= 0) { before = e.end; continue } // whole node precedes the point
    const startR = doc.createRange(); startR.setStart(e.node, 0); startR.collapse(true)
    if (pt.compareBoundaryPoints(Range.START_TO_START, startR) <= 0) return before ?? e.start // point is at/before this node
    return e.start // point strictly inside (rare for an element position)
  }
  return before
}

// Build the selector pair for a user's live selection Range.
export function selectorsFromRange(range: Range, root: Node): Selector[] | null {
  const idx = buildIndex(root)
  const start = nodeOffsetToFlat(idx, range.startContainer, range.startOffset)
  const end = nodeOffsetToFlat(idx, range.endContainer, range.endOffset)
  if (start == null || end == null || end <= start) return null
  const exact = idx.text.slice(start, end)
  const prefix = idx.text.slice(Math.max(0, start - CONTEXT_LEN), start)
  const suffix = idx.text.slice(end, end + CONTEXT_LEN)
  return [
    { type: 'TextQuoteSelector', exact, prefix, suffix },
    { type: 'TextPositionSelector', start, end },
  ]
}

// Resolve selectors back to a live Range against the current DOM.
// Prefers the quote selector (survives edits elsewhere); falls back to position.
export function rangeFromSelectors(selectors: Selector[], root: Node): Range | null {
  const idx = buildIndex(root)
  const quote = selectors.find((s) => s.type === 'TextQuoteSelector') as TextQuoteSelector | undefined
  const pos = selectors.find((s) => s.type === 'TextPositionSelector') as TextPositionSelector | undefined

  let start = -1
  let end = -1

  if (quote && quote.exact) {
    const hit = bestQuoteMatch(idx.text, quote)
    if (hit >= 0) {
      start = hit
      end = hit + quote.exact.length
    }
  }
  if (start < 0 && pos && idx.text.slice(pos.start, pos.end)) {
    start = pos.start
    end = pos.end
  }
  if (start < 0) return null // orphaned — the anchored text no longer exists

  const a = offsetToPoint(idx, start)
  const b = offsetToPoint(idx, end)
  if (!a || !b) return null
  const range = document.createRange()
  range.setStart(a.node, a.offset)
  range.setEnd(b.node, b.offset)
  return range
}

// Strict quote resolver: matches ONLY the exact quoted text (no position
// fallback). Returns null when the exact text is gone — i.e. the source was
// edited where this quote points, which is exactly our "stale/touched" signal.
export function resolveQuoteStrict(selectors: Selector[], root: Node): Range | null {
  const quote = selectors.find((s) => s.type === 'TextQuoteSelector') as TextQuoteSelector | undefined
  if (!quote?.exact) return null
  const idx = buildIndex(root)
  const start = bestQuoteMatch(idx.text, quote)
  if (start < 0) return null
  const a = offsetToPoint(idx, start)
  const b = offsetToPoint(idx, start + quote.exact.length)
  if (!a || !b) return null
  const range = document.createRange()
  range.setStart(a.node, a.offset)
  range.setEnd(b.node, b.offset)
  return range
}

// All matches of a quote in the page text, in document order.
//
// Matching is whitespace-TOLERANT: any run of whitespace in the quote matches any
// run of whitespace in the page. It has to be. A quote's stored form is a single
// markdown line (serialization flattens it), but the page it came from wraps
// wherever its HTML source wrapped -- so an exact match silently orphaned every
// highlight that happened to span a line break, the moment the page reloaded.
// The match's own length is returned because it can differ from the quote's.
function occurrences(text: string, exact: string): { start: number; end: number }[] {
  const pattern = (exact ?? '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  if (!pattern) return []
  const re = new RegExp(pattern, 'g')
  const out: { start: number; end: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    out.push({ start: m.index, end: m.index + m[0].length })
    re.lastIndex = m.index + 1 // overlapping scan, as the old indexOf walk did
  }
  return out
}

// Which occurrence (1-based) of its own exact text does this selection point at?
// 1 when the text is unique. Lets a quote pin the right instance of repeated text.
export function occurrenceOf(range: Range, root: Node): number {
  const idx = buildIndex(root)
  const start = nodeOffsetToFlat(idx, range.startContainer, range.startOffset)
  const end = nodeOffsetToFlat(idx, range.endContainer, range.endOffset)
  if (start == null || end == null || end <= start) return 1
  const exact = idx.text.slice(start, end)
  const n = occurrences(idx.text, exact).findIndex((o) => o.start === start)
  return n >= 0 ? n + 1 : 1
}

// The root's flat visible text (skips Marginer's own UI) — for counting how many
// times a quote's text occurs, to drive the occurrence picker.
export function sourceText(root: Node): string {
  return buildIndex(root).text
}

// Resolve the Nth (1-based) occurrence of `exact` to a live Range. Falls back to
// the last occurrence if nth overshoots (e.g. the source lost some copies).
export function resolveNthQuote(exact: string, nth: number, root: Node): Range | null {
  if (!exact) return null
  const idx = buildIndex(root)
  const occ = occurrences(idx.text, exact)
  if (!occ.length) return null
  const hit = occ[Math.min(Math.max(1, nth || 1), occ.length) - 1]
  const a = offsetToPoint(idx, hit.start)
  const b = offsetToPoint(idx, hit.end)
  if (!a || !b) return null
  const range = document.createRange()
  range.setStart(a.node, a.offset)
  range.setEnd(b.node, b.offset)
  return range
}

// Best-effort: does this exact string occur in the source? Used for paste-match
// (auto-anchoring pasted quotes) — returns selectors if found, else null.
export function locateText(text: string, root: Node): Selector[] | null {
  const trimmed = text.trim()
  if (trimmed.length < 8) return null // too short to anchor reliably
  const idx = buildIndex(root)
  const at = idx.text.indexOf(trimmed)
  if (at < 0) return null
  return [
    {
      type: 'TextQuoteSelector',
      exact: trimmed,
      prefix: idx.text.slice(Math.max(0, at - CONTEXT_LEN), at),
      suffix: idx.text.slice(at + trimmed.length, at + trimmed.length + CONTEXT_LEN),
    },
    { type: 'TextPositionSelector', start: at, end: at + trimmed.length },
  ]
}

// ---- image anchoring ------------------------------------------------------
// An image quote isn't text, so it can't live in the flat-text index. We anchor
// it the way the author refers to it: by the image's *source*. The wire form is a
// markdown image — `![](<src>)` — and we resolve it to a live <img> by matching
// the src's BASENAME (so it survives directory/baseUrl differences between pages)
// plus an occurrence index (the analogue of a text quote's prefix/suffix, to pin
// the right instance when the same image appears more than once).

// Detect an image-embed quote and pull out its src. Returns null for plain text.
// Both markdown spellings are accepted: `![](url)` and the angle-bracket form
// `![](<url with spaces>)` that CommonMark uses for URLs containing whitespace.
export function imageSrcOf(quote: string): string | null {
  const q = quote ?? ''
  const angled = /^\s*!\[[^\]]*\]\(<([^>]+)>\)\s*$/.exec(q)
  if (angled) return angled[1]
  const m = /^\s*!\[[^\]]*\]\(([^)\s]+)\)\s*$/.exec(q)
  return m ? m[1] : null
}

// The stable identity of an image src: last path segment, query/hash stripped,
// percent-decoded, lowercased. `../attachments/Pasted%20image.png?v=2` → `pasted image.png`.
export function imageBasename(src: string): string {
  let s = (src ?? '').split('#')[0].split('?')[0]
  s = s.slice(s.lastIndexOf('/') + 1)
  try { s = decodeURIComponent(s) } catch {}
  return s.toLowerCase()
}

// Every content <img> under root, in document order, skipping Marginer's own UI.
function imagesInRoot(root: Node): HTMLImageElement[] {
  const all = Array.from((root as Element).querySelectorAll?.('img') ?? []) as HTMLImageElement[]
  return all.filter((img) => !img.closest('[data-mg-ui],[data-mg-skip]'))
}

// Resolve an image quote to the live <img> element: the `nth` (1-based) image
// whose src basename matches. Falls back to the last match if nth overshoots.
export function resolveImageQuote(quote: string, nth: number, root: Node): HTMLImageElement | null {
  const src = imageSrcOf(quote)
  if (!src) return null
  const want = imageBasename(src)
  const matches = imagesInRoot(root).filter((img) => imageBasename(img.getAttribute('src') ?? '') === want)
  if (!matches.length) return null
  return matches[Math.min(Math.max(1, nth || 1), matches.length) - 1]
}

// Which occurrence (1-based) of its own basename a given <img> is — for capture,
// mirroring occurrenceOf() for text.
export function imageOccurrence(img: HTMLImageElement, root: Node): number {
  const want = imageBasename(img.getAttribute('src') ?? '')
  const matches = imagesInRoot(root).filter((i) => imageBasename(i.getAttribute('src') ?? '') === want)
  const n = matches.indexOf(img)
  return n >= 0 ? n + 1 : 1
}

// The markdown image-embed quote for an <img>. The src is ABSOLUTE (a relative
// attribute would break the moment the markdown is pasted somewhere else) and any
// whitespace in it is percent-encoded, so the `![](url)` form always parses back.
// Resolution keys off the basename, so the full URL is only a hint.
export function imageQuoteFromImg(img: HTMLImageElement): string {
  const raw = img.currentSrc || img.src || img.getAttribute('src') || ''
  return `![](${raw.replace(/\s/g, '%20')})`
}

// The <img> elements that fall inside a live range, in document order — used to
// paint overlay highlights for images caught in a text passage.
export function imagesInRange(range: Range, root: Node): HTMLImageElement[] {
  return imagesInRoot(root).filter((img) => range.intersectsNode(img))
}

// The flat-text offset an image sits at: the end of the last text node before it
// (buildIndex skips images, so this is the seam between the text on either side).
function imageFlat(idx: Index, img: HTMLImageElement): number {
  let flat = 0
  for (const e of idx.nodes) {
    if ((img.compareDocumentPosition(e.node) & Node.DOCUMENT_POSITION_PRECEDING) !== 0) flat = e.end
    else break // idx.nodes is in document order; once past the image, stop
  }
  return flat
}

// Decompose a selection into ordered quote pieces — text runs and the images
// between them — so a passage that spans an image stores (and renders, and shows
// in the response doc) the image *in place*, not stitched out. Each text run gets
// its own occurrence index; image pieces are `![](src)`. A selection with no
// images yields a single text piece, identical to the plain-text path.
export function quotePiecesFromRange(range: Range, root: Node): { quotes: string[]; nths: number[] } | null {
  const idx = buildIndex(root)
  const startFlat = nodeOffsetToFlat(idx, range.startContainer, range.startOffset)
  const endFlat = nodeOffsetToFlat(idx, range.endContainer, range.endOffset)
  if (startFlat == null || endFlat == null || endFlat < startFlat) return null

  const cuts = imagesInRange(range, root)
    .map((img) => ({ img, flat: imageFlat(idx, img) }))
    .filter((c) => c.flat >= startFlat && c.flat <= endFlat)
    .sort((a, b) => a.flat - b.flat)

  const quotes: string[] = []
  const nths: number[] = []
  const pushText = (from: number, to: number) => {
    const raw = idx.text.slice(from, to)
    const exact = raw.trim()
    if (!exact) return
    const at = from + (raw.length - raw.trimStart().length) // flat offset of the trimmed text
    const n = occurrences(idx.text, exact).findIndex((o) => o.start === at)
    quotes.push(exact); nths.push(n >= 0 ? n + 1 : 1)
  }

  let p = startFlat
  for (const c of cuts) {
    pushText(p, c.flat)
    quotes.push(imageQuoteFromImg(c.img)); nths.push(imageOccurrence(c.img, root))
    p = c.flat
  }
  pushText(p, endFlat)
  return quotes.length ? { quotes, nths } : null
}

// When `exact` appears more than once, pick the occurrence whose surrounding
// text best matches the recorded prefix/suffix.
function bestQuoteMatch(text: string, q: TextQuoteSelector): number {
  const positions: number[] = []
  let i = text.indexOf(q.exact)
  while (i >= 0) {
    positions.push(i)
    i = text.indexOf(q.exact, i + 1)
  }
  if (positions.length === 0) return -1
  if (positions.length === 1) return positions[0]

  let best = positions[0]
  let bestScore = -1
  for (const p of positions) {
    let score = 0
    if (q.prefix) {
      const before = text.slice(Math.max(0, p - q.prefix.length), p)
      score += commonSuffix(before, q.prefix)
    }
    if (q.suffix) {
      const after = text.slice(p + q.exact.length, p + q.exact.length + q.suffix.length)
      score += commonPrefix(after, q.suffix)
    }
    if (score > bestScore) {
      bestScore = score
      best = p
    }
  }
  return best
}

const commonPrefix = (a: string, b: string) => {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}
const commonSuffix = (a: string, b: string) => {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
  return n
}
