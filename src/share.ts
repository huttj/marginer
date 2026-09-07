// A whole annotation set, packed small enough to ride at the end of a comment.
//
// The reader's export ends with a marginer.app link whose fragment carries the
// notes verbatim. That link is what lets an author read those notes in place: the
// bookmarklet finds it in the comment thread and decodes it exactly, with no
// dependence on how the comment system rendered the markdown around it.
// Everything above the link stays human-readable prose, so the comment still
// reads as a comment to everyone else.

export type Payload = {
  v: 1
  url: string
  title: string
  md: string        // the annotation document, header and footer stripped
  name?: string     // who wrote it, when we know
}

export const SITE = 'https://marginer.app'
export const READ_PATH = '/i'
// Matches the link anywhere it survives: as an href, or as bare text a comment
// system did not linkify. The fragment is base64url, so the character class is tight.
export const LINK_RE = /marginer\.app\/i#([0-9A-Za-z_-]{16,})/g

const b64url = (bytes: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const unb64url = (s: string): Uint8Array => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// Both directions name the same format ('deflate-raw'); only the stream differs.
const pipe = async (bytes: Uint8Array, dir: 'in' | 'out'): Promise<Uint8Array> => {
  const s = dir === 'out' ? new CompressionStream('deflate-raw') : new DecompressionStream('deflate-raw')
  const stream = new Blob([bytes as BufferSource]).stream().pipeThrough(s as any)
  return new Uint8Array(await new Response(stream as any).arrayBuffer())
}

// `1` = deflated, `0` = plain. The marker keeps old links readable if the
// compression ever changes, and lets browsers without CompressionStream still
// produce something (just longer).
export async function encodePayload(p: Payload): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(p))
  try {
    if (typeof CompressionStream === 'function') return '1' + b64url(await pipe(json, 'out'))
  } catch { /* fall through to plain */ }
  return '0' + b64url(json)
}

export async function decodePayload(s: string): Promise<Payload | null> {
  try {
    const body = unb64url(s.slice(1))
    const json = s[0] === '1' ? await pipe(body, 'in') : body
    const p = JSON.parse(new TextDecoder().decode(json)) as Payload
    return p && typeof p.md === 'string' ? p : null
  } catch {
    return null
  }
}

export const readLink = (payload: string) => `${SITE}${READ_PATH}#${payload}`
