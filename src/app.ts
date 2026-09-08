import {
  imageQuoteFromImg, imageOccurrence, imageSrcOf, imagesInRange,
  quotePiecesFromRange, resolveImageQuote, resolveNthQuote,
} from './anchor'
import { buildThreads, detectSite, fillTextarea, groupByAnchor, PENDING_KEY, type Entry, type Pending, type Site, type Thread } from './comments'
import { buildEmojiPanel, refreshEmojiPanel } from './emoji'
import { serializeBody, stripWrapper, withFooter } from './export'
import {
  formatQuoteMarker, hasCommentText, parseSpans, renderMarkdown, serializeResponse, splitLeadingEmojis, type RBlock,
} from './markdown'
import { autoOpen, loadDoc, loadPrefs, pageKey, saveDoc, setAutoOpen, setCanonicalKey } from './store'
import { syncImageOverlays } from './overlay'
import { CSS } from './styles'

// One annotation: the quote pieces it anchors to (text runs and images, in the
// order they appear in the selection), the note that owns them, and the live
// Ranges those pieces currently resolve to. `note` is the storage form; `emojis`
// + `text` are its split view (leading emoji = reactions, rest = comment).
type Block = {
  id: string
  quotes: string[]
  nths: number[]
  note: string
  emojis: string[]
  text: string
  ranges: Range[]
  imgs: HTMLImageElement[]
  // Someone else's: the entries (from the page's comments) quoting this passage,
  // in thread order. Read-only on the page; each can be replied to.
  thread?: Entry[]
}

const HL = typeof (globalThis as any).Highlight !== 'undefined' && !!(window as any).CSS?.highlights
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const ICON = {
  eye: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.9 17.9A10.7 10.7 0 0 1 12 19c-7 0-11-7-11-7a19.4 19.4 0 0 1 5.1-5.9M9.9 4.2A10.9 10.9 0 0 1 12 4c7 0 11 7 11 7a19.3 19.3 0 0 1-2.2 3.2M1 1l22 22"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  // notes beside the text (view mode) / notes in a list (the sidebar)
  beside: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h9M3 11h9M3 16h6"/><rect x="15" y="8" width="7" height="7" rx="1.5"/></svg>',
  list: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M14 3v18"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  // open this post on its own site (from Substack's reader)
  out: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/></svg>',
  // auto-open on this site (the userscript)
  bolt: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h8l-1 8 10-12h-8l1-8z"/></svg>',
}

// View mode: cards float in the page's right gutter at the height of their
// highlight. CARD_W is what they'd like to be; GUTTER is what the gutter has to
// hold (card + a gap from the text + breathing room at the window edge).
const CARD_W = 272
const GUTTER_GAP = 20
const GUTTER = CARD_W + GUTTER_GAP + 14
const NARROW = 720 // below this the sidebar docks to the bottom and there is no gutter

type Mode = 'list' | 'beside'

// A reply in progress: which comment it goes to, the passage, the words it
// answers (`re`), and the reply. `entryKey` names the thread entry it sits
// under on the card; a reply that quotes a fresh passage has none.
type Draft = {
  id: string
  target: string      // comment id the reply is posted to
  author: string      // whose comment that is
  entryKey?: string   // `${commentId}:${index}` of the entry answered
  quotes: string[]
  nths: number[]
  re?: string
  note: string
}

export class Marginer {
  private md = ''
  private blocks: Block[] = []
  private focused: string | null = null
  private hovered: string | null = null
  private highlightsOn = true
  private open = true
  // 'list': the sidebar. 'beside': cards float in the page's right gutter,
  // level with their highlights, Google-Docs style.
  // Boots in view mode: the notes are visible on the page from the start, and
  // the sidebar (the pane) is a click away. Collapsed, a hovered highlight peeks
  // its note and a click opens the pane at its reply.
  private mode: Mode = 'beside'
  private peekEl!: HTMLElement       // the hover preview, when collapsed
  // Other readers' annotations, read from the page's own comments.
  private site: Site | null = null
  private threads: Thread[] = []
  private view: 'mine' | string = 'mine'  // 'mine' or a thread's root comment id
  private mine: { md: string; blocks: Block[]; preamble: string; spans: { start: number; reply: number; end: number }[] } | null = null
  // Replies being written: each is a block addressed to one comment, edited in
  // place on its card and highlighted until sent. Persisted per page.
  private drafts: Draft[] = []
  private reserved = ''             // the html margin we're currently claiming
  private autoToggle = false

  private styleEl!: HTMLStyleElement
  private layer!: HTMLElement       // document-anchored: margin chips + image boxes
  private sidebar!: HTMLElement
  // The sidebar is one text pane holding the whole document, Penumbra-style:
  // `> quote` lines with the reply beneath each. While it has focus it is the
  // source of truth -- the page re-anchors from it as you type.
  private paneEl!: HTMLTextAreaElement
  private paneBack!: HTMLElement     // mirror layer that tints the quote lines
  private paneWrap!: HTMLElement     // the scroller; the textarea grows and never scrolls itself
  private paneEmoji!: HTMLElement
  private paneTimer: any = null
  // A quote the pane just took from a selection, with nothing typed under it yet.
  // Clicking away without writing takes it back out, as with the popover.
  private pendingQuote: string | null = null
  private preamble = ''             // any prose above the first quote; kept verbatim
  private spans: { start: number; reply: number; end: number }[] = []
  private bar!: HTMLElement         // view-mode toolbar (the sidebar's head, as a pill)
  private besideEl!: HTMLElement    // view-mode cards, in the document layer
  private fab?: HTMLElement
  private compose?: HTMLElement
  // The block being written. It starts detached and is grafted into the document
  // the moment it has content -- which is how a reaction shows up on the page the
  // instant you click it, rather than waiting for Save.
  private composeBlock?: Block
  private composeGrafted = false
  private cardEditor?: HTMLTextAreaElement

  private quietTimer: any = null
  private mutTimer: any = null
  private rafQueued = false
  private mo?: MutationObserver
  private bound: { t: EventTarget; k: string; f: any; o?: any }[] = []

  // ---- lifecycle ------------------------------------------------------------

  // `collapsed` boots as a passive indicator (the userscript on a page it already
  // knows): highlights and the pill only, notes on hover.
  // `autoOpenToggle` offers the per-site "open on its own" switch -- only the
  // userscript can honour it, so only the userscript asks for it.
  async init(opts?: { collapsed?: boolean; autoOpenToggle?: boolean }) {
    this.autoToggle = !!opts?.autoOpenToggle
    this.styleEl = document.createElement('style')
    this.styleEl.setAttribute('data-mg-ui', '')
    this.styleEl.textContent = CSS
    document.head.appendChild(this.styleEl)
    this.applyPageTheme()

    this.layer = document.createElement('div')
    this.layer.setAttribute('data-mg-ui', '')
    this.layer.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;'
    document.body.appendChild(this.layer)
    this.besideEl = document.createElement('div')
    this.besideEl.className = 'mg-beside'
    this.besideEl.setAttribute('data-mg-ui', '')
    this.layer.appendChild(this.besideEl)

    await loadPrefs()
    this.peekEl = document.createElement('div')
    this.peekEl.className = 'mg-beside mg-peek'
    this.peekEl.setAttribute('data-mg-ui', '')
    this.layer.appendChild(this.peekEl)
    this.buildSidebar()
    this.buildBar()

    // Know the site before loading: its canonical URL is the storage key.
    this.site = detectSite()
    setCanonicalKey(this.site?.canonical ?? null)
    const stored = await loadDoc()
    this.setMarkdown(stored?.md ?? '')
    this.setOpen(!opts?.collapsed)
    if (this.site) { this.loadDrafts(); void this.loadThreads() }
    this.renderElsewhere()

    this.on(document, 'mouseup', (e: MouseEvent) => this.onMouseUp(e))
    this.on(document, 'touchend', (e: TouchEvent) => this.onMouseUp(e as any), { passive: true })
    this.on(document, 'mousedown', (e: MouseEvent) => this.onDocMouseDown(e), true)
    this.on(document, 'click', (e: MouseEvent) => this.onAltClickImage(e), true)
    this.on(document, 'click', (e: MouseEvent) => this.onClickHighlight(e))
    this.on(document, 'mousemove', (e: MouseEvent) => this.onMouseMove(e), { passive: true })
    this.on(document, 'keydown', (e: KeyboardEvent) => this.onKeyDown(e), true)
    this.on(window, 'resize', () => { this.gutterCache = null; this.queueRelayout() }, { passive: true })
    this.on(window, 'scroll', () => this.queueRelayout(), { passive: true })

    // Pages that lazy-load or hydrate can replace the nodes our Ranges point at.
    // Re-anchor from the markdown (the source of truth) when the DOM settles.
    // A record is ours if it happened inside our UI, or is our UI coming and
    // going (a toast on <body> has body as its target, not the toast).
    const ours = (r: MutationRecord) => {
      if ((r.target as Element).closest?.('[data-mg-ui]')) return true
      const nodes = [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)]
      return nodes.length > 0 && nodes.every((n) => (n as Element).hasAttribute?.('data-mg-ui'))
    }
    this.mo = new MutationObserver((recs) => {
      if (!this.blocks.length) return
      if (recs.every(ours)) return
      clearTimeout(this.mutTimer)
      this.mutTimer = setTimeout(() => { if (!this.compose && !this.cardEditor) this.reanchor() }, 800)
    })
    this.mo.observe(document.body, { childList: true, subtree: true, characterData: true })
  }

  destroy() {
    clearTimeout(this.quietTimer); clearTimeout(this.mutTimer)
    this.mo?.disconnect()
    for (const b of this.bound) b.t.removeEventListener(b.k, b.f, b.o)
    this.bound = []
    if (HL) for (const n of ['marginer', 'marginer-active', 'marginer-draft']) (window as any).CSS.highlights.delete(n)
    this.reserve('')
    document.documentElement.removeAttribute('data-mg-theme')
    document.querySelectorAll('[data-mg-ui]').forEach((n) => n.remove())
  }

  private on(t: EventTarget, k: string, f: any, o?: any) { t.addEventListener(k, f, o); this.bound.push({ t, k, f, o }) }

  // Match the panel to the page it's floating over: read the first opaque
  // background up the tree and pick the theme from its luminance.
  private applyPageTheme() {
    document.documentElement.setAttribute('data-mg-theme', this.pageTheme())
  }

  private pageTheme(): 'light' | 'dark' {
    for (const el of [document.body, document.documentElement]) {
      const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(el).backgroundColor || '')
      if (!m) continue
      const [r, g, b, a = 1] = m[1].split(',').map((v) => parseFloat(v))
      if (!a) continue // fully transparent -- keep looking further up
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5 ? 'dark' : 'light'
    }
    // Nothing opaque anywhere: the browser paints the canvas from `color-scheme`,
    // which defaults to a WHITE page no matter what the OS prefers. Only a page
    // that opted into dark (or into following the OS, with the OS in dark) is dark.
    const cs = getComputedStyle(document.documentElement).colorScheme || 'normal'
    if (!cs.includes('dark')) return 'light'
    if (!cs.includes('light')) return 'dark' // `color-scheme: dark` -- always dark
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  // ---- document <-> blocks --------------------------------------------------

  // Parse the markdown into blocks and resolve each quote piece against the live
  // DOM. A piece that no longer matches simply yields no Range: the note survives
  // as an "orphan" card (still exported) rather than being silently dropped.
  private setMarkdown(md: string) {
    // Normalize once here (drop a legacy `[Title](url)` header, trailing blanks)
    // so `md` is exactly what the pane shows and the spans line up with it.
    this.md = stripWrapper(md)
    const { preamble, blocks, spans } = parseSpans(this.md)
    this.preamble = preamble
    this.spans = spans
    this.blocks = blocks.map((b, i) => this.resolve(b, i))
    this.gutterCache = null // the page may have changed under us (that's why we re-anchor)
    this.renderAll()
  }

  // `root` is where the quotes are looked for: the whole page for your own
  // notes (you may annotate anything), the article alone for a comment's.
  private resolve(b: RBlock, i: number, root: Element = document.body): Block {
    const { emojis, text } = splitLeadingEmojis(b.note)
    const ranges: Range[] = []
    const imgs: HTMLImageElement[] = []
    const addImg = (img: HTMLImageElement) => { if (!imgs.includes(img)) imgs.push(img) }
    b.quotes.forEach((q, k) => {
      const nth = b.nths[k] ?? 1
      if (imageSrcOf(q)) {
        const img = resolveImageQuote(q, nth, root)
        if (img) { addImg(img); const r = document.createRange(); r.selectNode(img); ranges.push(r) }
      } else {
        const r = resolveNthQuote(q, nth, root)
        if (r) { ranges.push(r); imagesInRange(r, root).forEach(addImg) }
      }
    })
    return { id: `b${i}`, quotes: b.quotes, nths: b.nths, note: b.note, emojis, text, ranges, imgs }
  }

  private reanchor() {
    if (this.view !== 'mine') { this.setView(this.view); return } // re-resolve the thread's quotes
    const focused = this.focused
    this.setMarkdown(this.md)
    if (focused && this.blockById(focused)) this.focused = focused
    this.renderAll()
  }

  // Just the quote/note blocks: the document is keyed by URL, so the page needs
  // no naming inside it, and the export pastes clean. (Older documents carrying a
  // `[Title](url)` header still load: stripWrapper() drops it.)
  private serialize(): string {
    const rb: RBlock[] = this.blocks.map((b) => ({ quotes: b.quotes, nths: b.nths, note: b.note }))
    return this.preamble ? serializeResponse(this.preamble, rb) : serializeBody(rb)
  }

  // Persist and re-derive everything (drops focus; use saveQuiet while editing).
  private async save() {
    clearTimeout(this.quietTimer) // a stale autosave must not clobber a newer document
    if (this.view !== 'mine') return // someone else's notes are never ours to store
    this.md = this.serialize()
    this.focused = null
    void saveDoc(this.md)
    this.setMarkdown(this.md)
  }

  // Debounced save that does NOT re-parse, so an open editor keeps its cursor.
  private saveQuiet() {
    clearTimeout(this.quietTimer)
    if (this.view !== 'mine') return
    this.quietTimer = setTimeout(async () => {
      this.md = this.serialize()
      await saveDoc(this.md)
    }, 500)
  }

  // `note` is the only stored form; `emojis` and `text` are just a view of it,
  // re-derived whenever it changes. That's what makes an emoji you TYPE at the
  // front of a note behave exactly like one you picked: both are the same string.
  private syncDerived(b: Block) {
    const { emojis, text } = splitLeadingEmojis(b.note)
    b.emojis = emojis
    b.text = text
  }

  private blockById = (id: string | null) => this.blocks.find((b) => b.id === id)
  private docY = (b: Block) => (b.ranges.length ? b.ranges[0].getBoundingClientRect().top + window.scrollY : Number.MAX_SAFE_INTEGER)
  private ordered = () => this.blocks.slice().sort((a, b) => this.docY(a) - this.docY(b))

  // The first line box a highlight occupies (viewport coords), which is what
  // anything sitting "beside" it lines up with. The bounding rect of a wrapped
  // highlight spans every line it touches and would put a chip between them.
  private firstLine(b: Block): DOMRect | null {
    if (!b.ranges.length) return null
    // A range that starts at a node boundary (after a <br>, say) reports a
    // zero-width rect on the PREVIOUS line first; only a box with width is a line.
    for (const r of Array.from(b.ranges[0].getClientRects())) if (r.width) return r
    const rect = b.ranges[0].getBoundingClientRect()
    return rect.width || rect.height ? rect : null
  }

  // The y a chip is centered on: the middle of the whole highlight -- one line,
  // several lines, or an image -- measured over the boxes that have width (a
  // range starting at a node boundary reports a stray zero-width one).
  private lineCenter1 = (line: DOMRect) => line.top + line.height / 2
  private highlightCenter(b: Block): number | null {
    const rects = Array.from(b.ranges[0]?.getClientRects() ?? []).filter((r) => r.width)
    if (!rects.length) return null
    const top = Math.min(...rects.map((r) => r.top))
    const bottom = Math.max(...rects.map((r) => r.bottom))
    return (top + bottom) / 2
  }

  // ---- rendering ------------------------------------------------------------

  private renderAll() {
    this.renderHighlights()
    this.renderMarginChips()
    this.renderCards()
  }

  private queueRelayout() {
    if (this.rafQueued) return
    this.rafQueued = true
    requestAnimationFrame(() => {
      this.rafQueued = false
      this.applyChrome()      // the sidebar may have crossed the narrow breakpoint
      this.renderImageOverlays()
      this.renderMarginChips()
      this.layoutBeside()
      this.positionCompose()
    })
  }

  private renderHighlights() {
    this.renderImageOverlays()
    if (!HL) return
    const reg = (window as any).CSS.highlights
    const H = (globalThis as any).Highlight
    if (!this.highlightsOn) {
      for (const n of ['marginer', 'marginer-active', 'marginer-draft']) reg.delete(n)
      return
    }
    const ranges = this.blocks.flatMap((b) => b.ranges)
    if (ranges.length) reg.set('marginer', new H(...ranges)); else reg.delete('marginer')

    // Once grafted it paints as a real highlight, so the dotted draft comes off.
    const draft = this.composeGrafted ? [] : (this.composeBlock?.ranges ?? [])
    if (draft.length) reg.set('marginer-draft', new H(...draft)); else reg.delete('marginer-draft')

    const active = this.blockById(this.hovered ?? this.focused)?.ranges ?? []
    if (active.length) reg.set('marginer-active', new H(...active)); else reg.delete('marginer-active')
  }

  private renderImageOverlays() {
    if (!this.highlightsOn) { syncImageOverlays(this.layer, []); return }
    const activeId = this.hovered ?? this.focused
    const items: { img: HTMLImageElement; variant?: string }[] = []
    for (const b of this.blocks) for (const img of b.imgs) items.push({ img, variant: b.id === activeId ? 'active' : undefined })
    if (!this.composeGrafted) for (const img of this.composeBlock?.imgs ?? []) items.push({ img, variant: 'draft' })
    syncImageOverlays(this.layer, items)
  }

  // The left edge of the text column a highlight sits in -- the nearest block-level
  // ancestor. Chips hang off THAT, not off the highlight itself: a phrase caught
  // mid-paragraph would otherwise drop its emoji into the middle of the prose.
  private columnLeft(range: Range): number {
    const n = range.startContainer
    const el = (n.nodeType === Node.ELEMENT_NODE ? n : n.parentElement) as Element | null
    if (!el) return 0
    for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
      const d = getComputedStyle(e).display
      if (d === 'block' || d === 'list-item' || d === 'flow-root' || d === 'table-cell') {
        return e.getBoundingClientRect().left
      }
    }
    return el.getBoundingClientRect().left
  }

  // Reaction chips sit in the margin beside the highlight they belong to,
  // centered on its first line. The cluster's RIGHT edge is pinned (CSS
  // translateX(-100%)) so it grows leftward and the first emoji never moves as
  // others are added. Layouts with no left margin to spare get the chips on the
  // right of the line instead.
  private renderMarginChips() {
    this.layer.querySelectorAll('.mg-emote-stack').forEach((n) => n.remove())
    if (!this.highlightsOn || window.innerWidth <= NARROW) return
    let bottom = 0
    for (const blk of this.ordered()) {
      if (!blk.emojis.length) continue
      const line = this.firstLine(blk)
      if (!line) continue
      const colLeft = this.columnLeft(blk.ranges[0])
      const onRight = colLeft < 34
      // In view mode the right of the column is where the cards are, and the
      // card carries the reactions anyway.
      if (onRight && this.layout() === 'beside' && this.open) continue
      const stack = document.createElement('div')
      const emph = this.hovered === blk.id || this.focused === blk.id
      stack.className = `mg-emote-stack${onRight ? ' right' : ''}${emph ? ' mg-emph' : ''}`
      stack.setAttribute('data-mg-ui', '')
      stack.dataset.blockId = blk.id
      stack.innerHTML = blk.emojis.slice().reverse().map((e) => `<span class="mg-emote">${esc(e)}</span>`).join('')
      stack.title = hasCommentText(blk.text) ? blk.text.slice(0, 120) : 'Reaction'
      stack.addEventListener('mouseenter', () => this.setHovered(blk.id))
      stack.addEventListener('mouseleave', () => this.setHovered(null))
      stack.addEventListener('click', () => this.focus(blk.id, false))
      this.layer.appendChild(stack)
      const h = stack.offsetHeight
      const top = Math.max(window.scrollY + (this.highlightCenter(blk) ?? this.lineCenter1(line)) - h / 2, bottom + 6)
      stack.style.left = `${window.scrollX + (onRight ? this.columnRight(blk.ranges[0]) + 8 : colLeft - 8)}px`
      stack.style.top = `${top}px`
      bottom = top + h
    }
  }

  // ---- sidebar --------------------------------------------------------------

  private buildSidebar() {
    const bar = document.createElement('div')
    bar.className = 'mg-sidebar'
    bar.setAttribute('data-mg-ui', '')
    bar.innerHTML = `
      <div class="mg-head">
        <div class="mg-brand">✍️ Marginer <span class="mg-count" data-count></span></div>
        <select class="mg-select" data-view title="Whose notes to show" hidden></select>
        <button class="mg-tbtn" data-act="elsewhere" hidden>${ICON.out}</button>
        <button class="mg-tbtn" data-act="auto" hidden>${ICON.bolt}</button>
        <button class="mg-tbtn" data-act="mode" title="Show notes beside the text">${ICON.beside}</button>
        <button class="mg-tbtn" data-act="hl" title="Show/hide highlights">${ICON.eye}</button>
        <button class="mg-tbtn" data-act="collapse" title="Collapse">${ICON.close}</button>
      </div>
      <div class="mg-panewrap" data-panewrap>
        <div class="mg-panebody">
          <div class="mg-paneback" data-paneback aria-hidden="true"></div>
          <textarea class="mg-pane" data-pane spellcheck="false" placeholder="Select text on the page and it lands here as a quote. Write your reply beneath it."></textarea>
        </div>
      </div>
      <div class="mg-hint">Emoji at the front of a reply are its reactions. <b>⌥-click</b> an image to quote it.</div>
      <div class="mg-panebar" data-emojislot></div>
      <div class="mg-foot">
        <button class="mg-btn" data-act="copy">Copy markdown</button>
        <button class="mg-btn" data-act="send" hidden>Send reply</button>
      </div>`
    document.body.appendChild(bar)
    this.sidebar = bar
    this.paneEl = bar.querySelector('[data-pane]') as HTMLTextAreaElement
    this.paneBack = bar.querySelector('[data-paneback]') as HTMLElement
    this.paneWrap = bar.querySelector('[data-panewrap]') as HTMLElement

    const act = (n: string, f: () => void) => bar.querySelector(`[data-act="${n}"]`)!.addEventListener('click', f)
    act('mode', () => this.setMode('beside'))
    act('hl', () => this.toggleHighlights())
    act('collapse', () => this.setOpen(false))
    act('copy', () => this.copyMarkdown())

    const ta = this.paneEl
    ta.addEventListener('input', () => this.onPaneInput())
    ta.addEventListener('keydown', (e) => {
      // ⌘↵ keeps a bare quote (nothing typed under it) that click-away would drop.
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.pendingQuote = null; ta.blur() }
      if (e.key === 'Escape') { e.stopPropagation(); ta.blur() }
    })
    // The caret's block is the active one: its highlight brightens on the page.
    this.on(document, 'selectionchange', () => { if (document.activeElement === ta) this.onPaneCaret() })
    ta.addEventListener('blur', () => this.flushPane())

    // Reactions for the reply under the caret. Typing the emoji does the same.
    this.paneEmoji = buildEmojiPanel(() => this.blockAtCaret()?.note ?? '', (note) => {
      this.flushPane()
      const blk = this.blockAtCaret()
      if (!blk) return
      blk.note = note
      this.syncDerived(blk)
      this.replaceDoc(this.serialize(), blk.id)
    })
    bar.querySelector('[data-emojislot]')!.appendChild(this.paneEmoji)
  }

  // ---- the text pane ---------------------------------------------------------

  private paneOpen = () => this.open && this.layout() === 'list'

  private blockAtCaret(): Block | undefined {
    const pos = this.paneEl.selectionStart
    const i = this.spans.findIndex((sp) => pos >= sp.start && pos <= sp.end)
    return i >= 0 ? this.blocks[i] : undefined
  }

  // Typing: the text is the document now. Re-anchor shortly after the keys stop.
  // The quote lines' tint. A textarea can't style its own lines, so a layer
  // behind it carries the same text (invisible) with the `>` lines marked; the
  // two wrap identically because they share font, padding and width. The mirror
  // is in flow and sets the height; the textarea stretches over it and never
  // scrolls itself -- the wrapper scrolls, so the two move as one, rubber-band
  // bounce included. Only quotes that anchored on the page get the tint.
  private renderPaneBack() {
    const text = this.paneEl.value
    const lines = text.split('\n')
    let o = 0
    const html = lines.map((l) => {
      const start = o
      o += l.length + 1
      if (!/^\s*>/.test(l)) return esc(l)
      if (this.view !== 'mine') return `<span class="mg-q">${esc(l)}</span>`
      const k = this.spans.findIndex((sp) => start >= sp.start && start < sp.end)
      const blk = k >= 0 ? this.blocks[k] : undefined
      const cls = !blk?.ranges.length ? 'mg-q orphan' : blk.id === this.focused ? 'mg-q active' : 'mg-q'
      return `<span class="${cls}" data-block-id="${blk?.id ?? ''}">${esc(l)}</span>`
    }).join('\n')
    this.paneBack.innerHTML = html + '\n' // a trailing newline keeps the heights equal
  }

  // Scroll the pane so block i's quote (and the reply under it) is in view.
  private paneScrollTo(i: number) {
    const id = this.blocks[i]?.id
    const q = id && (this.paneBack.querySelector(`[data-block-id="${id}"]`) as HTMLElement | null)
    if (!q) return
    const top = q.offsetTop
    const wrap = this.paneWrap
    if (top - 24 < wrap.scrollTop || top + 80 > wrap.scrollTop + wrap.clientHeight) {
      wrap.scrollTo({ top: Math.max(0, top - wrap.clientHeight * 0.3), behavior: 'smooth' })
    }
  }

  private onPaneInput() {
    if (this.view !== 'mine') return // the pane is a preview while a thread is up
    this.pendingQuote = null
    this.md = this.paneEl.value
    this.renderPaneBack()
    if (this.paneTimer != null) clearTimeout(this.paneTimer)
    this.paneTimer = setTimeout(() => this.reparsePane(), 150)
  }

  // Anything that rebuilds the document from `blocks` must see what was just
  // typed, debounce or no debounce.
  private flushPane() {
    if (this.paneTimer == null || this.view !== 'mine') return
    clearTimeout(this.paneTimer)
    this.paneTimer = null
    this.reparsePane()
  }

  private reparsePane() {
    this.paneTimer = null
    if (this.view !== 'mine') return
    this.md = this.paneEl.value
    const { preamble, blocks, spans } = parseSpans(this.md)
    this.preamble = preamble
    this.spans = spans
    this.blocks = blocks.map((b, i) => this.resolve(b, i))
    this.onPaneCaret()
    this.renderHighlights()
    this.renderMarginChips()
    this.renderCounts()
    this.renderPaneBack()
    refreshEmojiPanel(this.paneEmoji)
    void saveDoc(this.md)
  }

  private onPaneCaret() {
    const id = this.blockAtCaret()?.id ?? null
    if (id === this.focused) return
    this.focused = id
    this.renderHighlights()
    this.renderMarginChips()
    this.renderPaneBack()
    refreshEmojiPanel(this.paneEmoji)
  }

  // Put a new document in the pane, keeping the caret on `atBlock`'s reply line.
  private replaceDoc(md: string, atBlock: string | null) {
    this.setMarkdown(md)
    this.paneEl.value = this.md
    const i = this.blocks.findIndex((b) => b.id === atBlock)
    if (i >= 0) this.caretTo(i)
    void saveDoc(this.md)
  }

  // Drop the caret at the end of block i's reply (adding the blank reply line
  // under a bare quote), and bring it into view.
  private caretTo(i: number) {
    const ta = this.paneEl
    const sp = this.spans[i]
    if (!sp) return
    let pos = sp.reply
    if (pos === sp.start || !this.blocks[i].note) {
      // Nothing under the quote yet: make sure there's a line to write on.
      const after = ta.value.slice(sp.reply)
      const have = /^\n\n/.test(after) ? 2 : /^\n/.test(after) ? 1 : 0
      if (have < 2) {
        ta.value = ta.value.slice(0, sp.reply) + '\n\n'.slice(have) + after
        this.md = ta.value
        this.spans = parseSpans(this.md).spans
      }
      pos = sp.reply + 2
    }
    ta.focus({ preventScroll: true })
    ta.setSelectionRange(pos, pos)
    this.onPaneCaret()
    this.renderPaneBack()
    this.paneScrollTo(i)
  }

  // A selection on the page, with the pane open: the quote goes to the end of
  // the document and the caret to the line beneath it, ready for the reply.
  private appendQuote(range: Range) {
    const pieces = quotePiecesFromRange(range, document.body)
    if (!pieces?.quotes.length) return
    this.flushPane()
    this.dropPendingQuote()
    const blk: Block = {
      id: `b${this.blocks.length}`, quotes: pieces.quotes, nths: pieces.nths,
      note: '', emojis: [], text: '', ranges: [range], imgs: imagesInRange(range, document.body),
    }
    this.blocks.push(blk)
    window.getSelection()?.removeAllRanges() // before the pane takes focus, or it would unseat the caret
    this.replaceDoc(this.serialize(), blk.id)
    this.pendingQuote = this.blocks[this.blocks.length - 1]?.id ?? null
  }

  private dropPendingQuote() {
    const id = this.pendingQuote
    this.pendingQuote = null
    this.flushPane()
    const pq = this.blockById(id)
    if (!pq || pq.note.trim()) return
    this.blocks = this.blocks.filter((b) => b !== pq)
    this.replaceDoc(this.serialize(), null)
    this.paneEl.blur()
  }

  private renderCounts() {
    const n = this.blocks.length
    for (const root of [this.sidebar, this.bar]) {
      (root.querySelector('[data-count]') as HTMLElement).textContent = n ? String(n) : ''
      const hlBtn = root.querySelector('[data-act="hl"]') as HTMLElement
      hlBtn.innerHTML = this.highlightsOn ? ICON.eye : ICON.eyeOff
      hlBtn.classList.toggle('active', !this.highlightsOn)
      ;(root.querySelector('[data-act="copy"]') as HTMLButtonElement).disabled = !n
    }
    if (this.fab) {
      this.fab.querySelector('[data-fabcount]')!.textContent = String(n)
      this.fab.title = n ? `${n} note${n === 1 ? '' : 's'} on this page — click to open` : 'Open Marginer'
    }
  }

  // View mode has no sidebar, so its controls live in a pill where the collapsed
  // one sits: back to the list, highlights, copy, collapse.
  private buildBar() {
    const bar = document.createElement('div')
    bar.className = 'mg-bar'
    bar.setAttribute('data-mg-ui', '')
    bar.innerHTML = `
      <div class="mg-brand">✍️ <span class="mg-count" data-count></span></div>
      <select class="mg-select" data-view title="Whose notes to show" hidden></select>
      <button class="mg-tbtn" data-act="elsewhere" hidden>${ICON.out}</button>
      <button class="mg-tbtn" data-act="auto" hidden>${ICON.bolt}</button>
      <button class="mg-tbtn" data-act="mode" title="Show notes in a list">${ICON.list}</button>
      <button class="mg-tbtn" data-act="hl" title="Show/hide notes and highlights">${ICON.eye}</button>
      <button class="mg-tbtn" data-act="copy" title="Copy markdown">${ICON.copy}</button>
      <button class="mg-btn tiny" data-act="send" hidden>Send replies</button>
      <button class="mg-tbtn" data-act="collapse" title="Collapse">${ICON.close}</button>`
    document.body.appendChild(bar)
    this.bar = bar
    const act = (n: string, f: () => void) => bar.querySelector(`[data-act="${n}"]`)!.addEventListener('click', f)
    act('mode', () => this.setMode('list'))
    act('hl', () => this.toggleHighlights())
    act('copy', () => this.copyMarkdown())
    act('collapse', () => this.setOpen(false))
    for (const sel of document.querySelectorAll<HTMLSelectElement>('[data-mg-ui] [data-view], .mg-bar [data-view]')) {
      sel.addEventListener('change', () => this.setView(sel.value))
    }
    for (const root of [this.sidebar, this.bar]) {
      root.querySelector('[data-act="send"]')!.addEventListener('click', () => void this.sendDrafts())
      root.querySelector('[data-act="auto"]')!.addEventListener('click', () => this.toggleAutoOpen())
      root.querySelector('[data-act="elsewhere"]')!.addEventListener('click', () => { if (this.site?.canonical) location.href = this.site.canonical })
    }
    this.renderAutoOpen()
  }

  // Reading a post somewhere other than its own page (Substack's reader): offer
  // the hop to the publication page, where the site's own storage keeps the
  // notes made there.
  private renderElsewhere() {
    const c = this.site?.canonical
    let show = false
    try { show = !!c && new URL(c).origin !== location.origin } catch { /* not a URL */ }
    for (const root of [this.sidebar, this.bar]) {
      const b = root.querySelector('[data-act="elsewhere"]') as HTMLButtonElement
      b.hidden = !show
      if (show) b.title = `Open this post on ${new URL(c!).hostname}`
    }
  }

  // Opt this site in (or out): the userscript then opens Marginer on every
  // page here, not just the ones with notes.
  private toggleAutoOpen() {
    const on = !autoOpen()
    setAutoOpen(on)
    this.renderAutoOpen()
    this.toast(on ? `Marginer will open on its own on ${location.hostname}` : `Marginer will stay out of the way on ${location.hostname} (⌘⇧U opens it)`)
  }

  private renderAutoOpen() {
    const on = autoOpen()
    for (const root of [this.sidebar, this.bar]) {
      const b = root.querySelector('[data-act="auto"]') as HTMLButtonElement
      b.hidden = !this.autoToggle
      b.classList.toggle('active', on)
      b.title = on ? `Opens on its own on ${location.hostname} — click to stop` : `Open on its own on ${location.hostname}`
    }
  }

  // ---- other readers' notes ---------------------------------------------------

  private async loadThreads() {
    if (!this.site) return
    try {
      const comments = await this.site.fetchComments()
      const article = this.site.article()
      this.threads = buildThreads(comments, (b) => this.resolve(b, 0, article).ranges.length > 0)
    } catch {
      this.threads = [] // the site's API said no; your own notes still work
    }
    this.renderPicker()
  }

  private renderPicker() {
    const opts = [`<option value="mine">Your notes</option>`].concat(
      this.threads.map((t) => `<option value="${esc(t.rootId)}">${esc(t.author)} · ${t.entries.length}</option>`))
    for (const sel of document.querySelectorAll<HTMLSelectElement>('.mg-sidebar [data-view], .mg-bar [data-view]')) {
      sel.innerHTML = opts.join('')
      sel.value = this.view
      sel.hidden = !this.threads.length
    }
  }

  // Show one reader's thread (a top-level comment and its replies) on the page,
  // or your own notes again. Your document is parked untouched while a thread
  // is up: nothing in that state is saved.
  setView(view: string) {
    const thread = view === 'mine' ? null : this.threads.find((t) => t.rootId === view)
    if (view !== 'mine' && !thread) return
    this.closeCompose(false)
    this.flushPane()
    if (this.cardEditor && this.focused) { const b = this.blockById(this.focused); if (b && this.view === 'mine') this.commitCard(b, this.cardEditor) }
    if (this.view === 'mine' && view !== 'mine') this.mine = { md: this.md, blocks: this.blocks, preamble: this.preamble, spans: this.spans }
    this.view = view
    this.focused = null
    this.cardEditor = undefined
    this.sidebar.classList.toggle('mg-foreign', view !== 'mine')
    if (!thread) {
      const mine = this.mine
      this.mine = null
      if (mine) { this.md = mine.md; this.setMarkdown(this.md) } else this.renderAll()
    } else {
      this.rebuildThread(thread)
      this.md = ''
      this.spans = []
      this.gutterCache = null
      this.renderAll()
    }
    this.renderPicker()
    this.renderDraft()
  }

  // One block per quoted passage: every entry quoting it, plus any reply draft
  // that quotes a passage nobody has yet (it gets a card of its own).
  private rebuildThread(thread: Thread) {
    const article = this.site?.article() ?? document.body
    const key = (quotes: string[], nths: number[]) => `${nths[0] ?? 1}:${quotes.join(' | ')}`
    const groups = groupByAnchor(thread.entries)
    const seen = new Set(groups.map((g) => key(g[0].block.quotes, g[0].block.nths)))
    this.blocks = groups.map((group, i) => {
      const b = this.resolve(group[0].block, i, article)
      b.id = `t${i}`
      b.thread = group
      return b
    })
    for (const d of this.threadDrafts(thread)) {
      const k = key(d.quotes, d.nths)
      if (seen.has(k)) continue
      seen.add(k)
      const b = this.resolve({ quotes: d.quotes, nths: d.nths, note: '' }, this.blocks.length, article)
      b.id = `t${this.blocks.length}`
      b.thread = []
      this.blocks.push(b)
    }
  }

  private threadDrafts(thread: Thread): Draft[] {
    const ids = new Set(thread.entries.map((e) => e.commentId))
    ids.add(thread.rootId)
    return this.drafts.filter((d) => ids.has(d.target))
  }
  private currentThread(): Thread | undefined { return this.threads.find((t) => t.rootId === this.view) }

  // ---- reply drafts ------------------------------------------------------------
  // A reply is written on the card, under the note it answers, and stays there
  // -- highlighted as unsent -- until Send posts every draft in the thread
  // through the site's reply boxes, one comment per person replied to.

  private draftsKey = () => `marginer:drafts:${pageKey()}`
  private loadDrafts() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.draftsKey()) ?? '[]')
      this.drafts = Array.isArray(raw) ? raw : []
    } catch { this.drafts = [] }
  }
  private saveDrafts() {
    try {
      if (this.drafts.length) localStorage.setItem(this.draftsKey(), JSON.stringify(this.drafts))
      else localStorage.removeItem(this.draftsKey())
    } catch { /* blocked storage: the session still has it */ }
  }

  // A reply that says something. A bare reaction is sent along but isn't
  // counted as a reply.
  private isReply = (d: Draft) => hasCommentText(splitLeadingEmojis(d.note).text)

  // Reply on an entry: a draft under it (or the one already there), focused.
  private openReply(blk: Block, entry: Entry | null) {
    const thread = this.currentThread()
    if (!thread) return
    const entryKey = entry ? this.entryKey(thread, entry) : undefined
    let d = entryKey ? this.drafts.find((x) => x.entryKey === entryKey) : undefined
    if (!d) {
      d = {
        id: `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        target: entry ? entry.commentId : thread.rootId,
        author: entry ? entry.author : thread.author,
        entryKey,
        quotes: blk.quotes, nths: blk.nths,
        // Quote their words, not their reaction: the note minus its leading emoji.
        re: entry ? splitLeadingEmojis(entry.block.note).text : undefined,
        note: '',
      }
      this.drafts.push(d)
      this.saveDrafts()
    }
    this.focused = blk.id
    this.renderAll()
    this.focusDraft(d.id)
  }

  // A selection while a thread is up: quote it into a reply to the thread's
  // author, on a card of its own at that passage.
  private quoteIntoReply(quotes: string[], nths: number[]) {
    const thread = this.currentThread()
    if (!thread) return
    const d: Draft = {
      id: `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      target: thread.rootId, author: thread.author, quotes, nths, note: '',
    }
    this.drafts.push(d)
    this.saveDrafts()
    this.rebuildThread(thread)
    this.gutterCache = null
    this.focused = this.blocks.find((b) => b.thread && b.quotes.join('') === quotes.join(''))?.id ?? null
    this.renderAll()
    this.focusDraft(d.id)
  }

  // Names an entry uniquely within its thread (a comment can hold several).
  private entryKey = (thread: Thread, e: Entry) => `${e.commentId}:${thread.entries.indexOf(e)}`

  private focusDraft(id: string) {
    const ta = this.besideEl.querySelector(`textarea[data-draft-id="${id}"]`) as HTMLTextAreaElement | null
    if (!ta) return
    ta.focus({ preventScroll: true })
    ta.setSelectionRange(ta.value.length, ta.value.length)
  }

  private discardDraft(id: string) {
    this.drafts = this.drafts.filter((d) => d.id !== id)
    this.saveDrafts()
    const t = this.currentThread()
    if (t) { this.rebuildThread(t); this.gutterCache = null }
    this.renderAll()
  }

  // The unsent replies, on the card: one editable, highlighted entry each.
  private draftHtml(d: Draft): string {
    return `<div class="mg-entry mg-draft" data-draft="${esc(d.id)}">
      <div class="mg-who"><b>You</b> · unsent reply to ${esc(d.author)} <button class="mg-draftx" data-discard="${esc(d.id)}" title="Discard this reply">${ICON.close}</button></div>
      <textarea data-draft-id="${esc(d.id)}" rows="1" placeholder="Your reply… (emoji at the front is a reaction)">${esc(d.note)}</textarea>
    </div>`
  }

  private wireDrafts(card: HTMLElement) {
    card.querySelectorAll<HTMLTextAreaElement>('textarea[data-draft-id]').forEach((ta) => {
      const d = this.drafts.find((x) => x.id === ta.dataset.draftId)
      if (!d) return
      const grow = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px` }
      grow()
      ta.addEventListener('input', () => {
        d.note = ta.value
        grow()
        this.saveDrafts()
        this.layoutBeside()    // the card grew; neighbours move
        this.renderDraft()     // the count on Send
      })
      ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); ta.blur() } })
      ta.addEventListener('mousedown', (e) => e.stopPropagation())
      ta.addEventListener('click', (e) => e.stopPropagation())
    })
    card.querySelectorAll<HTMLElement>('[data-discard]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation()
      this.discardDraft(b.dataset.discard!)
    }))
  }

  // What the pane shows while a thread is up: the replies as they will be
  // posted, one comment per person. Read-only; the cards are where you write.
  private previewText(thread: Thread): string {
    const byTarget = new Map<string, Draft[]>()
    for (const d of this.threadDrafts(thread)) { const l = byTarget.get(d.target) ?? []; l.push(d); byTarget.set(d.target, l) }
    if (!byTarget.size) return ''
    return [...byTarget.values()].map((ds) => `— reply to ${ds[0].author} —\n\n${withFooter(serializeBody(ds.map((d) => ({ quotes: d.quotes, nths: d.nths, note: d.note, re: d.re }))))}`).join('\n\n')
  }

  // Send button + preview. The count is replies written over notes in the
  // thread that could be replied to (reactions don't count on either side).
  private renderDraft() {
    const thread = this.currentThread()
    const foreign = !!thread
    const ds = thread ? this.threadDrafts(thread).filter(this.isReply) : []
    const n = thread ? thread.entries.filter((e) => hasCommentText(splitLeadingEmojis(e.block.note).text)).length : 0
    if (foreign) {
      this.paneEl.readOnly = true
      this.paneEl.value = this.previewText(thread!)
      this.paneEl.placeholder = `Press Reply on a note to write beneath it. What you write shows here as it will be posted.`
      this.renderPaneBack()
    } else {
      this.paneEl.readOnly = false
      this.paneEl.placeholder = 'Select text on the page and it lands here as a quote. Write your reply beneath it.'
    }
    for (const root of [this.sidebar, this.bar]) {
      const send = root.querySelector('[data-act="send"]') as HTMLButtonElement
      send.hidden = !foreign || !ds.length
      send.textContent = `Send replies · ${ds.length}/${n}`
      ;(root.querySelector('[data-act="copy"]') as HTMLElement).hidden = foreign
    }
  }

  // Send every draft in the thread: one comment per person replied to, each
  // through that comment's own reply box, pre-filled for you to post. A comment
  // that isn't on the page goes by its permalink (the userscript fills it in).
  private async sendDrafts() {
    const site = this.site
    const thread = this.currentThread()
    if (!site || !thread) return
    const byTarget = new Map<string, Draft[]>()
    for (const d of this.threadDrafts(thread)) if (d.note.trim()) { const l = byTarget.get(d.target) ?? []; l.push(d); byTarget.set(d.target, l) }
    let filled = 0
    let travel: Pending | null = null
    for (const [target, ds] of byTarget) {
      const text = withFooter(serializeBody(ds.map((d) => ({ quotes: d.quotes, nths: d.nths, note: d.note, re: d.re }))))
      const ta = await site.openReplyBox(target)
      if (ta) {
        fillTextarea(ta, text)
        if (!filled) ta.scrollIntoView({ block: 'center', behavior: 'smooth' })
        filled++
        this.drafts = this.drafts.filter((d) => d.target !== target)
      } else if (!travel) {
        travel = { url: site.permalink(target), id: target, text }
        try { await navigator.clipboard.writeText(text) } catch { /* fine */ }
        this.drafts = this.drafts.filter((d) => d.target !== target)
      }
    }
    this.saveDrafts()
    this.rebuildThread(thread)
    this.renderAll()
    this.renderDraft()
    if (filled) this.toast(filled === 1 ? 'Your reply is in its box below — press Post' : `${filled} replies are in their boxes below — press Post on each`)
    if (travel) {
      try { localStorage.setItem(PENDING_KEY, JSON.stringify(travel)) } catch { /* fine */ }
      this.toast('Reply copied — opening the comment…')
      setTimeout(() => { location.href = travel!.url }, 900)
    }
  }

  // Below the narrow breakpoint there is no gutter to put cards in, so view
  // mode falls back to the (bottom-docked) list until the window grows again.
  private layout(): Mode { return window.innerWidth <= NARROW ? 'list' : this.mode }

  // Show whichever chrome the state calls for, and claim the page margin it
  // needs. The sidebar SQUEEZES the page rather than covering it: an html
  // margin the width of the sidebar reflows the content into the space beside
  // it. (Fixed-position page furniture ignores the margin; nothing to be done.)
  private applyChrome() {
    const layout = this.layout()
    const list = this.open && layout === 'list'
    const beside = this.open && layout === 'beside'
    this.sidebar.style.display = list ? '' : 'none'
    this.bar.style.display = beside ? '' : 'none'
    // In view mode the cards ARE the annotation layer, so the eye hides them too.
    this.besideEl.style.display = beside && this.highlightsOn ? '' : 'none'
    if (list) {
      const w = this.sidebar.offsetWidth
      this.reserve(window.innerWidth <= NARROW ? `0 0 ${this.sidebar.offsetHeight}px 0` : `0 ${w}px 0 0`)
    } else if (!beside) {
      this.reserve('')
    } // view mode reserves what it needs in layoutBeside()
  }

  private reserve(margin: string) {
    if (margin === this.reserved) return
    this.reserved = margin
    const s = document.documentElement.style
    if (margin) s.setProperty('margin', margin, 'important'); else s.removeProperty('margin')
  }

  setMode(mode: Mode) {
    if (this.mode === mode) return
    this.mode = mode
    this.applyChrome()
    this.renderAll()
  }

  // The pane shows the document; view mode shows it as floating cards.
  private renderCards() {
    const list = this.ordered()
    this.renderCounts()
    // The pane is the source of truth while it has focus; otherwise it follows.
    if (this.view === 'mine' && document.activeElement !== this.paneEl && this.paneEl.value !== this.md) this.paneEl.value = this.md
    if (this.view === 'mine') this.renderPaneBack()
    refreshEmojiPanel(this.paneEmoji)

    // Preserve the open editor across a re-render triggered by something else.
    const editing = this.cardEditor ? { id: this.focused, val: this.cardEditor.value, sel: this.cardEditor.selectionStart } : null
    const active = document.activeElement as HTMLTextAreaElement | null
    const draftFocus = active?.dataset?.draftId ? { id: active.dataset.draftId, sel: active.selectionStart } : null
    this.detachEditor()
    this.besideEl.innerHTML = ''
    if (this.layout() !== 'beside') return
    // A reaction with no comment is already on the page as a margin chip; its
    // card only shows while it's being edited (click the highlight).
    const shown = list.filter((b) => b.thread || hasCommentText(b.text) || b.id === this.focused)
    if (!shown.length) { this.reserve(''); return } // nothing to make room for
    for (const blk of shown) this.besideEl.appendChild(this.buildCard(blk))
    this.layoutBeside()
    if (draftFocus) {
      const ta = this.besideEl.querySelector(`textarea[data-draft-id="${draftFocus.id}"]`) as HTMLTextAreaElement | null
      if (ta) { ta.focus({ preventScroll: true }); ta.setSelectionRange(draftFocus.sel, draftFocus.sel) }
    }
    const ed: HTMLTextAreaElement | undefined = this.cardEditor
    if (ed && editing?.id && this.focused === editing.id) {
      ed.value = editing.val
      ed.setSelectionRange(editing.sel, editing.sel)
    }
  }

  // The right edge of the text column a highlight sits in (viewport coords).
  private columnRight(range: Range): number {
    const n = range.startContainer
    const el = (n.nodeType === Node.ELEMENT_NODE ? n : n.parentElement) as Element | null
    if (!el) return 0
    for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
      const d = getComputedStyle(e).display
      if (d === 'block' || d === 'list-item' || d === 'flow-root' || d === 'table-cell') {
        return e.getBoundingClientRect().right
      }
    }
    return el.getBoundingClientRect().right
  }

  // Where the cards go: just right of the widest annotated column. A page with
  // no gutter to speak of gets one by squeezing the content (the same html
  // margin the sidebar uses). Squeezing a centered column only yields half the
  // margin as gutter, so measure how much a first push actually gained and
  // extrapolate, rather than iterating toward it.
  private gutterCache: { x: number; w: number; reserved: string } | null = null
  private gutter(): { x: number; w: number; reserved: string } {
    // Measuring means un-squeezing and re-squeezing the page, so it is cached
    // until something that could move the column happens: a resize, a re-render,
    // or the reserve being reset behind our back (collapsing, say).
    if (this.gutterCache && this.gutterCache.reserved === this.reserved) return this.gutterCache
    const before = this.reserved
    const colRight = () => {
      let right = 0
      for (const b of this.blocks) if (b.ranges.length) right = Math.max(right, this.columnRight(b.ranges[0]))
      return right || document.body.getBoundingClientRect().right
    }
    const avail = () => document.documentElement.clientWidth - colRight()
    const push = (px: number) => this.reserve(px > 0 ? `0 ${Math.round(px)}px 0 0` : '')
    const cap = document.documentElement.clientWidth * 0.55
    push(0)
    let a = avail()
    if (a < GUTTER) {
      let m = Math.min(cap, GUTTER - a)
      push(m)
      const a2 = avail()
      const gain = (a2 - a) / m
      if (a2 < GUTTER && gain > 0.05) { m = Math.min(cap, m + (GUTTER - a2) / gain); push(m) }
      a = avail()
    }
    const w = Math.max(180, Math.min(CARD_W, a - GUTTER_GAP - 14))
    // Measuring moved the page, so anything placed before this call (chips,
    // image boxes) is now stale -- the cache means the next pass is cheap.
    if (this.reserved !== before) this.queueRelayout()
    return (this.gutterCache = { x: window.scrollX + colRight() + GUTTER_GAP, w, reserved: this.reserved })
  }

  // Place the floating cards. Each wants to sit level with its highlight; where
  // that would overlap, cards stack downward -- except that the focused card is
  // pinned exactly to its highlight and pushes its neighbours out of the way,
  // above and below, the way Google Docs does it.
  private layoutBeside() {
    if (this.layout() !== 'beside' || !this.open || !this.highlightsOn) return
    const cards = Array.from(this.besideEl.children).filter((c) => c.classList.contains('mg-card')) as HTMLElement[]
    if (!cards.length) { this.reserve(''); return }
    const { x, w } = this.gutter()
    const GAP = 14 // room for the reactions hanging off a card's bottom edge
    const items = cards.map((el) => {
      const blk = this.blockById(el.dataset.blockId ?? null)
      const line = blk ? this.firstLine(blk) : null
      el.style.left = `${x}px`
      el.style.width = `${w}px`
      return { el, line, want: line ? window.scrollY + line.top - 4 : null, h: el.offsetHeight }
    })
    const top: number[] = []
    let y = -GAP
    items.forEach((it, i) => { top[i] = Math.max(it.want ?? y + GAP, y + GAP); y = top[i] + it.h })
    const f = items.findIndex((it) => it.el.dataset.blockId === this.focused)
    if (f >= 0 && items[f].want != null) {
      top[f] = items[f].want!
      for (let i = f - 1; i >= 0; i--) top[i] = Math.min(top[i], top[i + 1] - GAP - items[i].h)
      for (let i = f + 1; i < items.length; i++) top[i] = Math.max(items[i].want ?? -Infinity, top[i - 1] + items[i - 1].h + GAP)
    }
    // Pushed off the top of the document? Fall back to plain stacking from the top.
    if (top[0] < 8) { y = 8; items.forEach((it, i) => { top[i] = Math.max(top[i], y); y = top[i] + it.h + GAP }) }
    items.forEach((it, i) => {
      it.el.style.top = `${top[i]}px`
      requestAnimationFrame(() => it.el.classList.add('mg-settled')) // animate moves, not arrival
    })
  }

  // Written as a method so TypeScript doesn't narrow `cardEditor` to `undefined`
  // for the rest of the caller -- buildCard() re-attaches it.
  private detachEditor() { this.cardEditor = undefined }

  private buildCard(blk: Block): HTMLElement {
    const focused = this.focused === blk.id
    const card = document.createElement('div')
    card.className = `mg-card${focused ? ' focused' : ''}${blk.ranges.length ? '' : ' orphan'}${this.hovered === blk.id ? ' mg-emph' : ''}`
    card.setAttribute('data-mg-ui', '')
    card.dataset.blockId = blk.id

    const quoteHtml = blk.quotes.map((q) => {
      const src = imageSrcOf(q)
      return src
        ? `<div class="mg-quote mg-quote-img"><img src="${esc(src)}" alt=""></div>`
        : `<div class="mg-quote">${esc(q)}</div>`
    }).join('')

    if (blk.thread) {
      // Someone else's: every entry quoting this passage, in thread order, each
      // with a Reply. Read-only on the page.
      card.classList.add('mg-foreign')
      const anchorKey = `${blk.nths[0] ?? 1}:${blk.quotes.join(' | ')}`
      const mine = this.drafts.filter((d) => `${d.nths[0] ?? 1}:${d.quotes.join(' | ')}` === anchorKey)
      const thread = this.currentThread()
      const entriesHtml = blk.thread.map((e, i) => {
        const { emojis, text } = splitLeadingEmojis(e.block.note)
        const under = thread ? mine.filter((d) => d.entryKey === this.entryKey(thread, e)) : []
        return `<div class="mg-entry" style="margin-left:${Math.min(e.depth, 4) * 12}px" data-entry="${i}">
          <div class="mg-who"><b>${esc(e.author)}</b> <a href="${esc(e.permalink)}" title="This comment on the page">↗</a></div>
          ${text.trim() ? `<div class="mg-md">${renderMarkdown(text)}</div>` : ''}
          ${emojis.length ? `<div class="mg-entry-emoji">${emojis.map((x) => esc(x)).join(' ')}</div>` : ''}
          ${under.length ? under.map((d) => this.draftHtml(d)).join('') : `<button class="mg-btn tiny ghost" data-reply="${i}">Reply</button>`}
        </div>`
      }).join('')
      const fresh = mine.filter((d) => !d.entryKey).map((d) => this.draftHtml(d)).join('')
      card.innerHTML = quoteHtml + `<div class="mg-thread">${entriesHtml}${fresh}</div>`
      card.querySelectorAll<HTMLElement>('[data-reply]').forEach((b) => b.addEventListener('click', (ev) => {
        ev.stopPropagation()
        this.openReply(blk, blk.thread![Number(b.dataset.reply)])
      }))
      this.wireDrafts(card)
      card.addEventListener('click', () => this.focus(blk.id, true))
      card.addEventListener('mouseenter', () => this.setHovered(blk.id))
      card.addEventListener('mouseleave', () => this.setHovered(null))
      return card
    }
    if (!focused) {
      const noteHtml = hasCommentText(blk.text)
        ? `<div class="mg-md">${renderMarkdown(blk.text)}</div>`
        : `<div class="mg-md mg-muted">Add a note…</div>`
      const emojiHtml = blk.emojis.length
        ? `<div class="mg-card-emoji">${blk.emojis.map((e) => `<span>${esc(e)}</span>`).join('')}</div>` : ''
      card.innerHTML = quoteHtml + `<div class="mg-note">${noteHtml}</div>` + emojiHtml
      card.addEventListener('click', () => this.focus(blk.id, true))
    } else {
      card.innerHTML = quoteHtml +
        `<div class="mg-note"><textarea data-note rows="3" placeholder="Add a note… (emoji at the front become margin chips)"></textarea></div>
         <div class="mg-note" data-emojislot style="padding-top:0"></div>`
      const ta = card.querySelector('[data-note]') as HTMLTextAreaElement
      ta.value = blk.note   // the WHOLE note, leading emoji included
      this.cardEditor = ta
      const panel = buildEmojiPanel(() => blk.note, (note) => {
        ta.value = note
        onEdit()
        requestAnimationFrame(() => ta.focus())
      })
      const grow = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px` }
      const onEdit = () => {
        grow()
        blk.note = ta.value
        this.syncDerived(blk)
        this.renderMarginChips()  // an emoji typed at the front lands in the margin now
        this.layoutBeside()       // a growing note nudges the cards below it
        refreshEmojiPanel(panel)
        this.saveQuiet()
      }
      ta.addEventListener('input', onEdit)
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.commitCard(blk, ta) }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.commitCard(blk, ta) }
      })
      requestAnimationFrame(() => { grow(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length) })

      card.querySelector('[data-emojislot]')!.appendChild(panel)
    }
    const del = document.createElement('button')
    del.className = 'mg-cardx'
    del.title = 'Delete this note'
    del.innerHTML = ICON.close
    del.addEventListener('click', (e) => { e.stopPropagation(); this.deleteBlock(blk) })
    card.appendChild(del)

    card.addEventListener('mouseenter', () => this.setHovered(blk.id))
    card.addEventListener('mouseleave', () => this.setHovered(null))
    return card
  }

  private commitCard(blk: Block, ta: HTMLTextAreaElement) {
    clearTimeout(this.quietTimer)
    blk.note = ta.value
    this.syncDerived(blk)
    this.cardEditor = undefined
    // A note emptied of everything -- prose and emoji alike -- is a deletion.
    if (!blk.note.trim()) this.blocks = this.blocks.filter((b) => b !== blk)
    void this.save()
  }

  private focus(id: string, scroll: boolean) {
    if (!this.open) {
      // Collapsed: a click on a highlight (or its peek) brings the notes back
      // in view mode and opens this one for editing.
      this.mode = 'beside'
      this.setOpen(true)
    }
    if (this.paneOpen()) {
      // In the pane, focusing a note means putting the caret on its reply --
      // every time, even if it's already the active block and merely scrolled away.
      this.flushPane()
      const i = this.blocks.findIndex((b) => b.id === id)
      if (i < 0) return
      this.closeCompose(false)
      if (scroll && this.blocks[i].ranges.length) this.scrollToRange(this.blocks[i].ranges[0])
      this.caretTo(i)
      return
    }
    if (this.focused === id) return
    if (this.cardEditor) { const prev = this.blockById(this.focused); if (prev) { prev.note = this.cardEditor.value; this.syncDerived(prev) } }
    this.closeCompose(false)
    this.focused = id
    this.cardEditor = undefined
    this.renderAll()
    const blk = this.blockById(id)
    if (scroll && blk?.ranges.length) this.scrollToRange(blk.ranges[0])
  }

  private scrollToRange(r: Range) {
    const rect = r.getBoundingClientRect()
    if (rect.top > 80 && rect.bottom < window.innerHeight - 80) return
    window.scrollTo({ top: window.scrollY + rect.top - window.innerHeight * 0.35, behavior: 'smooth' })
  }

  private setHovered(id: string | null) {
    if (this.hovered === id) return
    this.hovered = id
    document.querySelectorAll<HTMLElement>('[data-mg-ui][data-block-id]').forEach((el) =>
      el.classList.toggle('mg-emph', el.dataset.blockId === id))
    this.renderHighlights()
    this.renderPeek()
  }

  // Collapsed, the notes are still a hover away: the hovered highlight's card
  // appears in the gutter beside it, or under it when the page has no gutter.
  // Clicking it (or the highlight) brings view mode back with the note open.
  private renderPeek() {
    this.peekEl.innerHTML = ''
    if (this.open || !this.highlightsOn) return
    const blk = this.blockById(this.hovered)
    const line = blk && this.firstLine(blk)
    if (!blk || !line || (!blk.thread && !hasCommentText(blk.text))) return // a bare reaction: the chip says it all
    const card = this.buildCard(blk)
    card.querySelector('.mg-cardx')?.remove() // read-only glance; edit in the pane
    this.peekEl.appendChild(card)
    const colRight = this.columnRight(blk.ranges[0])
    const vw = document.documentElement.clientWidth
    if (vw - colRight >= GUTTER) {
      card.style.width = `${CARD_W}px`
      card.style.left = `${window.scrollX + colRight + GUTTER_GAP}px`
      card.style.top = `${window.scrollY + line.top - 4}px`
    } else {
      const w = Math.min(320, vw - 24)
      card.style.width = `${w}px`
      card.style.left = `${window.scrollX + Math.max(12, Math.min(line.left, vw - 12 - w))}px`
      card.style.top = `${window.scrollY + line.bottom + 8}px`
    }
  }

  // ---- selection -> new note -----------------------------------------------

  private onMouseUp(e: MouseEvent) {
    if ((e.target as HTMLElement)?.closest?.('[data-mg-ui]')) return
    // Let the browser finish settling the selection before we read it.
    setTimeout(() => this.offerNote(), 10)
  }

  // Finishing a selection opens the note panel straight away -- no button to aim
  // at in between. The cost is that ordinary selecting (copying a line, double-
  // clicking a word) opens it too, so the panel has to cost nothing to ignore:
  // click away with it empty and it leaves no highlight behind.
  private offerNote() {
    if (!this.highlightsOn) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) return
    const range = sel.getRangeAt(0)
    if (this.sidebar.contains(range.commonAncestorContainer)) return
    if (this.inEditable(range)) return
    // A selection with no text is still worth taking if it holds an image --
    // that's how a figure gets annotated.
    if (!sel.toString().trim() && !imagesInRange(range, document.body).length) return
    if (this.view !== 'mine') {
      const t = this.threads.find((x) => x.rootId === this.view)
      const pieces = quotePiecesFromRange(range, document.body)
      window.getSelection()?.removeAllRanges()
      if (t && pieces?.quotes.length) this.quoteIntoReply(pieces.quotes, pieces.nths)
      return
    }
    if (this.paneOpen()) this.appendQuote(range.cloneRange())
    else this.openCompose(range.cloneRange())
  }

  // Selecting inside a form field or a rich-text editor is someone writing, not
  // someone reading. Stay out of it.
  private inEditable(range: Range): boolean {
    const n = range.commonAncestorContainer
    const el = (n.nodeType === Node.ELEMENT_NODE ? n : n.parentElement) as Element | null
    return !!el?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
  }

  // Alt/Option-click an image to annotate it on its own. A plain click is left
  // alone so links, lightboxes and galleries keep working.
  private onAltClickImage(e: MouseEvent) {
    if (!e.altKey || !this.highlightsOn) return
    const t = e.target as HTMLElement
    if (t?.tagName !== 'IMG' || t.closest('[data-mg-ui]')) return
    e.preventDefault(); e.stopPropagation()
    const r = document.createRange()
    r.selectNode(t)
    if (this.paneOpen()) this.appendQuote(r); else this.openCompose(r)
  }

  // The note panel. It opens on the selection itself, and it commits as you go:
  // clicking a reaction grafts the note into the document immediately, so the
  // margin chip and the sidebar card appear under your cursor rather than after a
  // round-trip through Save.
  private openCompose(range: Range) {
    const pieces = quotePiecesFromRange(range, document.body)
    if (!pieces?.quotes.length) return
    if (this.compose) this.closeCompose(false) // keep whatever was typed into the last one
    this.focused = null

    const wb: Block = {
      id: `b${this.blocks.length}`,
      quotes: pieces.quotes,
      nths: pieces.nths,
      note: '', emojis: [], text: '',
      ranges: [range],
      imgs: imagesInRange(range, document.body),
    }
    this.composeBlock = wb
    this.composeGrafted = false

    const box = document.createElement('div')
    box.className = 'mg-compose'
    box.setAttribute('data-mg-ui', '')
    const first = wb.quotes[0]
    const src = imageSrcOf(first)
    box.innerHTML =
      (src ? `<div class="mg-quote mg-quote-img"><img src="${esc(src)}" alt=""></div>`
           : `<div class="mg-quote">${esc(first)}</div>`) +
      `<textarea data-note rows="2" placeholder="Add a note… (⌘↵ to save)"></textarea>
       <div class="mg-composebar">
         <div data-emojislot></div>
         <button class="mg-btn" data-act="save">Save</button>
       </div>`

    const ta = box.querySelector('[data-note]') as HTMLTextAreaElement
    const panel = buildEmojiPanel(() => wb.note, (note) => {
      ta.value = note
      onEdit()
      requestAnimationFrame(() => ta.focus())
    })
    const grow = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px` }
    const onEdit = () => {
      grow()
      wb.note = ta.value
      refreshEmojiPanel(panel)
      this.reflectCompose() // the note — reaction and all — lands on the page now
    }
    ta.addEventListener('input', onEdit)
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.commitCompose(ta.value, true) }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.dismissCompose() }
    })
    box.querySelector('[data-emojislot]')!.appendChild(panel)
    ;(box.querySelector('[data-act="save"]') as HTMLElement).addEventListener('click', () => this.commitCompose(ta.value, true))

    this.layer.appendChild(box)
    this.compose = box
    this.positionCompose()
    this.renderHighlights()
    ta.focus()
  }

  // Graft the in-progress note into the document (or pull it back out when it's
  // emptied again), then repaint everything it touches — without re-parsing, so
  // the open panel keeps its cursor.
  private reflectCompose() {
    const wb = this.composeBlock
    if (!wb) return
    this.syncDerived(wb)
    const keep = !!wb.note.trim()
    const inDoc = this.blocks.includes(wb)
    if (keep && !inDoc) { this.blocks.push(wb); this.composeGrafted = true }
    else if (!keep && inDoc) { this.blocks = this.blocks.filter((b) => b !== wb); this.composeGrafted = false }
    this.renderHighlights()
    this.renderMarginChips()
    this.renderCards()
    this.saveQuiet()
  }

  // Keep the panel beside its selection, inside the viewport, and clear of the
  // sidebar -- and, above all, never on top of the text it quotes.
  private positionCompose() {
    const box = this.compose
    const wb = this.composeBlock
    if (!box || !wb?.ranges.length) return
    const rect = wb.ranges[0].getBoundingClientRect()
    const limitRight = window.innerWidth - (this.open ? this.sidebar.offsetWidth : 0) - 12

    // Fit the panel into whichever side of the selection has more room by capping
    // the NOTE's height (not the panel's -- a scrolling panel would clip the emoji
    // grid, which opens upward and out of the box).
    const GAP = 8
    const above = rect.top - GAP - 12
    const below = window.innerHeight - rect.bottom - GAP - 12
    const room = Math.max(above, below)
    const ta = box.querySelector('[data-note]') as HTMLTextAreaElement | null
    if (ta) {
      const chrome = box.offsetHeight - ta.offsetHeight // quote + emoji bar + padding
      ta.style.maxHeight = `${Math.max(46, room - chrome)}px`
    }

    const w = box.offsetWidth || 340
    const h = box.offsetHeight || 160
    const goBelow = h <= below || below >= above
    box.style.left = `${window.scrollX + Math.max(12, Math.min(rect.left, limitRight - w))}px`
    box.style.top = `${window.scrollY + (goBelow ? rect.bottom + GAP : rect.top - h - GAP)}px`
  }

  // Close the panel, keeping what's in it. `explicit` marks a deliberate commit
  // (Save, ⌘↵) as opposed to an incidental one (clicking away, starting another
  // selection) -- the difference decides what an EMPTY panel means.
  private closeCompose(explicit: boolean) {
    const ta = this.compose?.querySelector('[data-note]') as HTMLTextAreaElement | null
    this.commitCompose(ta?.value ?? '', explicit)
  }

  private commitCompose(text: string, explicit: boolean) {
    const wb = this.composeBlock
    if (!wb) return
    wb.note = text
    this.syncDerived(wb)
    this.compose?.remove(); this.compose = undefined
    this.composeBlock = undefined; this.composeGrafted = false

    // The panel opens on every selection, so an empty one you merely clicked away
    // from must leave NO trace -- otherwise copying a line litters the page with
    // blank highlights. Save is different: that's you asking for a bare highlight,
    // and the quote alone is a useful export line.
    const keep = !!wb.note.trim() || explicit
    const inDoc = this.blocks.includes(wb)
    if (keep && !inDoc) this.blocks.push(wb)
    else if (!keep && inDoc) this.blocks = this.blocks.filter((b) => b !== wb)
    if (!keep && !inDoc) { this.renderAll(); return } // nothing was ever committed
    window.getSelection()?.removeAllRanges()
    void this.save()
  }

  // Escape cancels the whole interaction, including a reaction that already
  // grafted itself -- otherwise "never mind" would silently leave a note behind.
  private dismissCompose() {
    const wb = this.composeBlock
    const grafted = this.composeGrafted
    this.compose?.remove(); this.compose = undefined
    this.composeBlock = undefined; this.composeGrafted = false
    if (!wb) { this.renderHighlights(); return }
    clearTimeout(this.quietTimer)
    if (grafted) { this.blocks = this.blocks.filter((b) => b !== wb); void this.save() }
    else this.renderAll()
  }

  // ---- global input ---------------------------------------------------------

  private onDocMouseDown(e: MouseEvent) {
    const t = e.target as HTMLElement
    if (t?.closest?.('[data-mg-ui]')) return
    // Click-away from an open panel keeps whatever is in it (matching the card
    // editors, which autosave) -- but an untouched panel is simply dropped.
    if (this.compose) { this.closeCompose(false); return }
    if (this.pendingQuote) { this.dropPendingQuote(); return }
    if (this.cardEditor && this.focused) {
      const blk = this.blockById(this.focused)
      if (blk) this.commitCard(blk, this.cardEditor)
    }
  }

  private hoverRaf = false
  private onMouseMove(e: MouseEvent) {
    if (this.hoverRaf) return
    this.hoverRaf = true
    const { clientX: x, clientY: y } = e
    requestAnimationFrame(() => {
      this.hoverRaf = false
      if (!this.highlightsOn) return
      if ((e.target as HTMLElement)?.closest?.('[data-mg-ui]')) return
      this.setHovered(this.blockAt(x, y))
    })
  }

  // Which highlight is under a viewport point. Highlights are paint, not DOM,
  // so this is a geometry test against the live Ranges.
  private blockAt(x: number, y: number): string | null {
    for (const b of this.blocks) {
      for (const r of b.ranges) {
        for (const rc of Array.from(r.getClientRects())) {
          if (x >= rc.left && x <= rc.right && y >= rc.top && y <= rc.bottom) return b.id
        }
      }
    }
    return null
  }

  // A plain click on a highlight brings its note back up to edit: the card
  // opens in the sidebar, or pins itself beside the text in view mode. A drag
  // that ended here is a selection, not a click, and is left to offerNote().
  private onClickHighlight(e: MouseEvent) {
    if (!this.highlightsOn || e.altKey || e.button !== 0) return
    if ((e.target as HTMLElement)?.closest?.('[data-mg-ui]')) return
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return
    const id = this.blockAt(e.clientX, e.clientY)
    if (id) this.focus(id, false)
  }

  private onKeyDown(e: KeyboardEvent) {
    // ⌘/Ctrl + Shift + H: annotate the current selection without reaching for the mouse.
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'H' || e.key === 'h')) {
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed && sel.rangeCount && sel.toString().trim()) {
        e.preventDefault()
        if (this.paneOpen()) this.appendQuote(sel.getRangeAt(0).cloneRange())
        else this.openCompose(sel.getRangeAt(0).cloneRange())
      }
      return
    }
    if (e.key !== 'Escape') return
    if (this.compose) { this.dismissCompose(); return }
    if (this.focused) { this.focused = null; this.cardEditor = undefined; this.renderAll() }
  }

  // ---- toolbar actions ------------------------------------------------------

  private toggleHighlights() {
    this.highlightsOn = !this.highlightsOn
    if (!this.highlightsOn) this.dismissCompose()
    this.applyChrome()
    this.renderAll()
  }

  setOpen(open: boolean) {
    this.open = open
    this.fab?.remove(); this.fab = undefined
    this.peekEl.innerHTML = ''
    this.applyChrome()
    this.queueRelayout()  // the page just reflowed around (or back over) the sidebar
    if (open) return
    const f = document.createElement('button')
    f.className = 'mg-fab'
    f.setAttribute('data-mg-ui', '')
    const n = this.blocks.length
    f.innerHTML = `✍️ <span data-fabcount>${n || 0}</span>`
    f.title = n ? `${n} note${n === 1 ? '' : 's'} on this page — click to open` : 'Open Marginer'
    f.addEventListener('click', () => this.setOpen(true))
    document.body.appendChild(f)
    this.fab = f
  }

  toggleOpen() { this.setOpen(!this.open) }

  // Deleting is one click plus an undo, rather than a confirm: the note is small,
  // the action is instantly reversible, and a modal for every stray highlight is
  // worse than the mistake it prevents.
  private deleteBlock(blk: Block) {
    const before = this.md
    this.blocks = this.blocks.filter((b) => b !== blk)
    void this.save()
    this.toast('Note deleted', { label: 'Undo', run: () => { this.setMarkdown(before); void saveDoc(before) } })
  }

  markdown(): string { return this.serialize() }

  private async copyMarkdown() {
    const md = withFooter(this.serialize())
    try {
      await navigator.clipboard.writeText(md)
      this.toast('Markdown copied')
    } catch {
      // Clipboard is gated on some pages (permissions policy, no focus) -- fall
      // back to the dialog with everything selected so ⌘C just works.
      this.showMarkdown()
    }
  }

  private showMarkdown() {
    const md = withFooter(this.serialize())
    const wrap = document.createElement('div')
    wrap.className = 'mg-modal'
    wrap.setAttribute('data-mg-ui', '')
    wrap.innerHTML = `<div class="mg-modalbox">
        <textarea spellcheck="false"></textarea>
        <div class="mg-modalfoot">
          <button class="mg-btn ghost" data-act="close">Close</button>
          <button class="mg-btn" data-act="copy">Copy</button>
        </div></div>`
    const ta = wrap.querySelector('textarea') as HTMLTextAreaElement
    ta.value = md
    const close = () => wrap.remove()
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close() })
    ;(wrap.querySelector('[data-act="close"]') as HTMLElement).addEventListener('click', close)
    ;(wrap.querySelector('[data-act="copy"]') as HTMLElement).addEventListener('click', async () => {
      ta.select()
      try { await navigator.clipboard.writeText(md) } catch { document.execCommand('copy') }
      this.toast('Markdown copied')
      close()
    })
    document.body.appendChild(wrap)
    ta.focus(); ta.select()
  }

  private toast(msg: string, action?: { label: string; run: () => void }) {
    document.querySelectorAll('.mg-toast').forEach((n) => n.remove())
    const t = document.createElement('div')
    t.className = 'mg-toast'
    t.setAttribute('data-mg-ui', '')
    t.textContent = msg
    if (action) {
      const b = document.createElement('button')
      b.className = 'mg-toast-act'
      b.textContent = action.label
      b.addEventListener('click', () => { t.remove(); action.run() })
      t.appendChild(b)
    }
    document.body.appendChild(t)
    setTimeout(() => t.remove(), action ? 6000 : 1900)
  }
}
