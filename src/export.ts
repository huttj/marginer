import { serializeResponse, type RBlock } from './markdown'
import { encodePayload, LINK_RE, readLink } from './share'

// The exported document has three parts:
//   [Title](url)                      <- where it came from
//   > quote / note blocks             <- the annotations, readable as prose
//   a marginer.app/i# link            <- the same annotations, exactly, for machines
//
// Pasted into a comment box the middle part is what everyone reads; the link is
// what lets the post's author pull the notes back onto the page. Both the header
// and the footer are stripped again on load, so a round-trip through someone's
// clipboard is lossless.
const HEADER_RE = /^\[([^\]]*)\]\(([^)\s]+)\)\s*\n+/

export function serializeBody(blocks: RBlock[]): string {
  return serializeResponse('', blocks)
}

export async function serializeDoc(
  blocks: RBlock[],
  meta: { title: string; url: string } | null,
): Promise<string> {
  const body = serializeBody(blocks)
  if (!meta) return body
  const title = (meta.title || meta.url).replace(/[[\]]/g, '').trim()
  let footer = ''
  try {
    const payload = await encodePayload({ v: 1, url: meta.url, title, md: body })
    footer = `\n---\nAnnotated with Marginer — read these in place: ${readLink(payload)}\n`
  } catch {
    footer = '' // no payload is better than a broken one; the prose still stands
  }
  return `[${title}](${meta.url})\n\n${body}${footer}`
}

// Drop the source header and the trailing link, leaving just the quote/note blocks.
export function stripWrapper(md: string): string {
  const lines = (md ?? '').replace(/^\ufeff/, '').replace(HEADER_RE, '').split('\n')
  // Walk back over the footer: the link line, its `---` rule, and any blank lines.
  while (lines.length) {
    const last = lines[lines.length - 1]
    LINK_RE.lastIndex = 0
    if (!last.trim() || /^-{3,}$/.test(last.trim()) || LINK_RE.test(last)) lines.pop()
    else break
  }
  return lines.join('\n')
}
