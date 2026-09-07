// The markdown layer. Marginer stores an annotated page AS markdown -- a sequence
// of `> quote` blocks and the notes they own -- so the exported text and the saved
// state are the same string. Parse it to re-anchor; serialize it to export.
// Also a minimal, dependency-free markdown → HTML renderer for the sidebar cards. Covers the common cases (headings, bold/italic/code,
// links, images, blockquotes, lists, hr, code fences). Not CommonMark-complete.

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// A quote line carries an optional occurrence index so repeated text pins the
// right instance: `>2 text` (occurrence 2 — NO space after >) vs `> text` (the
// first/only occurrence — note the space). The number is hidden in every render.
export function parseQuoteMarker(line: string): { nth: number; text: string } {
  const m = /^\s*>(\d+)\s(.*)$/.exec(line)
  if (m) return { nth: Number(m[1]), text: m[2] }
  return { nth: 1, text: (line ?? '').replace(/^\s*>\s?/, '') }
}
export function formatQuoteMarker(nth: number, text: string): string {
  return nth > 1 ? `>${nth} ${text}` : `> ${text}`
}

// Pull quote passages (text + occurrence) from markdown; consecutive '>' lines =
// one quote, with the occurrence read from its first line.
export function extractQuotes(md: string): { text: string; nth: number }[] {
  const out: { text: string; nth: number }[] = []
  let cur: string[] = []
  let nth = 1
  const flush = () => { const t = cur.join(' ').trim(); if (t.length >= 6) out.push({ text: t, nth }); cur = []; nth = 1 }
  for (const ln of (md ?? '').split('\n')) {
    if (/^\s*>/.test(ln)) {
      if (!cur.length) { const pm = parseQuoteMarker(ln); nth = pm.nth; cur.push(pm.text) }
      else cur.push(ln.replace(/^\s*>\s?/, ''))
    } else if (cur.length) flush()
  }
  if (cur.length) flush()
  return out
}
export function extractBlockquotes(md: string): string[] {
  return extractQuotes(md).map((q) => q.text)
}

// A response block: a quote (one or more '>' lines, with its occurrence index)
// and the note it owns.
export type RBlock = { quotes: string[]; nths: number[]; note: string }

export const isQ = (l: string | undefined) => /^\s*>/.test(l ?? '')

// Split a quote's text into ordered pieces — text runs and `![](src)` images,
// inline OR on their own line (the caller joins the blockquote's lines first, so
// both encodings reduce to the same inline form). Pure text yields one piece, so
// ordinary quotes are unchanged.
export function splitQuotePieces(text: string): string[] {
  const out: string[] = []
  const re = /!\[[^\]]*\]\([^)\s]+\)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const before = text.slice(last, m.index).trim()
    if (before) out.push(before)
    out.push(m[0])
    last = m.index + m[0].length
  }
  const tail = text.slice(last).trim()
  if (tail) out.push(tail)
  return out
}

// Parse a response doc into a leading preamble + a sequence of quote-blocks.
// Each quote is its own block and owns the prose below it until the next quote
// (so two back-to-back quotes stay two separate comments, not one).
export function parseResponse(md: string): { preamble: string; blocks: RBlock[] } {
  return parseSpans(md)
}

// parseResponse, plus where each block sits in the text: `start` is the offset
// of its first quote line, `reply` the offset just past its last non-blank note
// line (or past the quote group when there is no note yet) -- the place a caret
// goes to continue the reply. The text pane uses these to map caret <-> block.
export function parseSpans(md: string): { preamble: string; blocks: RBlock[]; spans: { start: number; reply: number; end: number }[] } {
  const lines = (md ?? '').replace(/\r\n/g, '\n').split('\n')
  // Character offset of the start of each line, so spans can be reported.
  const at: number[] = []
  for (let k = 0, o = 0; k < lines.length; k++) { at.push(o); o += lines[k].length + 1 }
  const endOf = (k: number) => at[k] + lines[k].length
  let i = 0
  const preamble: string[] = []
  while (i < lines.length && !isQ(lines[i])) { preamble.push(lines[i]); i++ }

  const blocks: RBlock[] = []
  const spans: { start: number; reply: number; end: number }[] = []
  while (i < lines.length) {
    const start = at[i]
    const qlines: { text: string; nth: number }[] = []
    while (i < lines.length && isQ(lines[i])) {
      const pm = parseQuoteMarker(lines[i])
      // Tolerate editor-mangled lines: trailing `\` hard-breaks and the zero-width
      // sentinel that older saves left inside quotes.
      const text = pm.text.replace(/\\\s*$/, '').replace(/​/g, '').trim()
      if (text) qlines.push({ text, nth: pm.nth })
      i++
    }
    const qEnd = endOf(i - 1)
    const note: string[] = []
    const noteAt = i
    while (i < lines.length && !isQ(lines[i])) { note.push(lines[i]); i++ }
    // Drop the leading gap blank(s) after the quote and ALL trailing blank lines
    // (incl. the zero-width sentinel) — comments never keep trailing blanks now.
    while (note.length && note[0].trim() === '') note.shift()
    let lastNote = i - 1
    while (lastNote >= noteAt && lines[lastNote].replace(/​/g, '').trim() === '') lastNote--
    while (note.length && note[note.length - 1].replace(/​/g, '').trim() === '') note.pop()
    spans.push({ start, reply: lastNote >= noteAt ? endOf(lastNote) : qEnd, end: i < lines.length ? at[i] : (md ?? '').length })
    // Join the blockquote's lines, then split into ordered pieces (text runs +
    // images). A pure-text blockquote yields a single piece — the long-standing
    // passage — so ordinary quotes are unchanged. The occurrence index pins the
    // first piece; later pieces default to the first/only instance.
    let quotes: string[] = []
    let nths: number[] = []
    if (qlines.length) {
      quotes = splitQuotePieces(qlines.map((l) => l.text).join(' '))
      nths = quotes.map((_, i) => (i === 0 ? qlines[0].nth : 1))
    }
    blocks.push({ quotes, nths, note: note.join('\n') })
  }
  return { preamble: preamble.join('\n').trim(), blocks, spans }
}

// Round-trip the structure back to markdown. Notes carry no trailing blanks, and
// there's an extra blank line before every quote but the first (more readable).
export function serializeResponse(preamble: string, blocks: RBlock[]): string {
  const blockStrs: string[] = []
  for (const b of blocks) {
    const note = b.note.replace(/^\n+/, '').replace(/[\s​]+$/, '') // drop leading + trailing blanks
    const pieces = b.quotes.map((q) => (q ?? '').replace(/\n/g, ' ').trim()).filter(Boolean)
    if (!pieces.length && !note.trim()) continue
    // Pieces (text + images) join inline into one '>' line, so an in-quote image
    // is an inline embed — the editor flows it inline and the cursor can sit on
    // either side. The occurrence index rides on the first piece.
    const qs = pieces.length ? formatQuoteMarker(b.nths?.[0] ?? 1, pieces.join(' ')) : ''
    blockStrs.push(qs && note ? `${qs}\n\n${note}` : qs || note)
  }
  const blockBody = blockStrs.join('\n\n\n') // '\n\n\n' = one extra blank line before quotes 2..n
  const pre = preamble.trim()
  const body = pre && blockBody ? `${pre}\n\n${blockBody}` : pre || blockBody
  return body + '\n'
}

// Split a note into its LEADING emoji(s) (reactions → left chips) and the
// remaining text (the comment → right card). "👍🔥 Good point" → ['👍','🔥'] + "Good point".
export function splitLeadingEmojis(note: string): { emojis: string[]; text: string } {
  const t = note ?? ''
  const emojis: string[] = []
  let idx = 0
  const Seg = (Intl as any).Segmenter
  if (typeof Seg === 'function') {
    for (const { segment } of new Seg('en', { granularity: 'grapheme' }).segment(t)) {
      if (/^\s+$/.test(segment)) { idx += segment.length; continue }
      if (/\p{Extended_Pictographic}/u.test(segment)) { emojis.push(segment); idx += segment.length; continue }
      break
    }
  } else {
    const m = /^((?:\p{Extended_Pictographic}(?:[️‍\u{1F3FB}-\u{1F3FF}]|\p{Extended_Pictographic})*|\s)+)/u.exec(t)
    if (m) { idx = m[0].length; for (const ch of [...m[0]]) if (/\p{Extended_Pictographic}/u.test(ch)) emojis.push(ch) }
  }
  return { emojis, text: t.slice(idx) }
}

// True only if `text` holds real comment content — at least one character that
// isn't whitespace, the zero-width blank-line sentinel, or an emoji. (So a blank
// editor, or one with only reactions, never spawns a sidebar comment card.)
export function hasCommentText(text: string): boolean {
  const t = (text ?? '').replace(/​/g, '')
  const Seg = (Intl as any).Segmenter
  if (typeof Seg === 'function') {
    for (const { segment } of new Seg('en', { granularity: 'grapheme' }).segment(t)) {
      if (/^\s+$/.test(segment)) continue
      if (/\p{Extended_Pictographic}/u.test(segment)) continue
      return true
    }
    return false
  }
  return /\S/.test(t.replace(/\p{Extended_Pictographic}/gu, ''))
}

// A note that's ONLY emoji (one or more) renders as a left-rail chip, not a card.
export function isEmojiNote(note: string): boolean {
  const t = note.trim()
  if (!t) return false
  // strip emoji, flag/skin-tone/ZWJ/variation selectors and whitespace; emoji-only
  // means nothing is left and there was at least one pictographic.
  const stripped = t.replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}️‍\s]/gu, '')
  return stripped === '' && /\p{Extended_Pictographic}/u.test(t)
}

function inline(s: string): string {
  return esc(s)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
}

export function renderMarkdown(md: string): string {
  const lines = (md ?? '').replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (/^```/.test(line)) {
      const buf: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++])
      i++ // closing fence
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`)
      continue
    }
    if (/^[\s​]*$/.test(line)) { i++; continue } // blank, incl. the zero-width blank-line sentinel
    if (/^#{1,6}\s/.test(line)) {
      const m = /^(#{1,6})\s+(.*)$/.exec(line)!
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`)
      i++; continue
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue }
    if (/^\s*>/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''))
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`)
      continue
    }
    if (/^\s*[-*+]\s/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*[-*+]\s/.test(lines[i])) buf.push(`<li>${inline(lines[i++].replace(/^\s*[-*+]\s+/, ''))}</li>`)
      out.push(`<ul>${buf.join('')}</ul>`)
      continue
    }
    if (/^\s*\d+\.\s/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) buf.push(`<li>${inline(lines[i++].replace(/^\s*\d+\.\s+/, ''))}</li>`)
      out.push(`<ol>${buf.join('')}</ol>`)
      continue
    }
    // paragraph: gather until blank line (the zero-width sentinel counts as blank)
    const buf: string[] = []
    while (i < lines.length && !/^[\s​]*$/.test(lines[i]) && !/^(#{1,6}\s|```|\s*>|\s*[-*+]\s|\s*\d+\.\s)/.test(lines[i]))
      buf.push(lines[i++])
    const content = inline(buf.join(' '))
    // an image on its own line renders as a bare block <img> (no <p> line-box/margin under it)
    out.push(/^<img\b[^>]*>$/.test(content) ? content : `<p>${content}</p>`)
  }
  return out.join('\n')
}
