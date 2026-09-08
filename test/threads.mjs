// Other readers' notes, read from the page's own comments. A local server stands
// in for Substack: the post page (with comment anchors and Reply buttons, as a
// logged-in reader sees them), and the two JSON routes the adapter calls.
import { createServer } from 'node:http'
import puppeteer from 'puppeteer-core'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const base = `${process.env.HOME}/.cache/puppeteer/chrome`
const rel = 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
const CHROME = readdirSync(base).sort().map((b) => join(base, b, rel)).filter(existsSync).pop()
const bundle = readFileSync(join(root, 'dist/marginer.js'), 'utf8')
const user = readFileSync(join(root, 'dist/marginer.user.js'), 'utf8')
const fails = []
const ok = (n, c, x = '') => { console.log(`${c ? '  ok  ' : ' FAIL '} ${n}${c ? '' : '  ← ' + x}`); if (!c) fails.push(n) }

// ---- the thread ---------------------------------------------------------------
// Maria annotates two passages (one with a reaction) and pastes the export.
// Tom replies to her first note, nested email-style. Maria answers Tom AND
// quotes a third passage in the same reply. Ann quotes a passage by hand, with
// no Marginer involved. Two comments must be ignored: prose only, and a quote
// of something that is not on the page.
const FOOTER = '✍️ marginer.app — see these highlights on the page'
const comments = [
  { id: 101, name: 'Maria', date: '2026-09-01T10:00:00Z', body:
    `> only honest reading anyone ever gives a text\n\n🔥 Overstated, but I like it.\n\n\n> argument in miniature\n\nThis is the thesis.\n\n${FOOTER}\n`,
    children: [
      { id: 102, name: 'Tom', date: '2026-09-01T11:00:00Z', body:
        `> > only honest reading anyone ever gives a text\n> Overstated, but I like it.\n\nNot overstated at all — that narrower thing is exactly what he meant.\n\n${FOOTER}\n`,
        children: [
          { id: 103, name: 'Maria', date: '2026-09-01T12:00:00Z', body:
            `> > only honest reading anyone ever gives a text\n> Not overstated at all — that narrower thing is exactly what he meant.\n\nFair. And then this bit:\n\n\n> Markdown travels\n\n👍 Agreed here too.\n`, children: [] },
        ] },
    ] },
  { id: 201, name: 'Ann', date: '2026-09-02T09:00:00Z', body: `> digital reading was never\n\nI typed this quote by hand, no tool.`, children: [] },
  { id: 301, name: 'Bob', date: '2026-09-02T10:00:00Z', body: `Great piece, no quotes here.`, children: [] },
  { id: 401, name: 'Cy', date: '2026-09-02T11:00:00Z', body: `> this sentence is not in the article\n\nQuoting something else.`, children: [] },
  { id: 501, name: 'Del', date: '2026-09-02T12:00:00Z', body: 'gone', deleted: true, children: [] },
]

const article = readFileSync(join(root, 'demo/index.html'), 'utf8').replace(/^[\s\S]*?<h1>/, '<h1>')
const commentHtml = (c, depth = 0) => c.deleted ? '' : `
  <div class="comment" style="margin-left:${depth * 24}px">
    <div id="comment-${c.id}"></div>
    <b>${c.name}</b> <a href="/p/on-marginalia/comment/${c.id}">permalink</a>
    <pre style="white-space:pre-wrap;font:inherit">${c.body.replace(/</g, '&lt;')}</pre>
    <a href="#" onclick="event.preventDefault(); this.insertAdjacentHTML('afterend','<textarea data-reply-to=&quot;${c.id}&quot; placeholder=&quot;Write a reply...&quot;></textarea>')">Reply${(c.children ?? []).length ? ` (${c.children.length})` : ''}</a>
    ${(c.children ?? []).map((ch) => commentHtml(ch, depth + 1)).join('')}
  </div>`
const page = `<!doctype html><meta charset="utf-8"><title>On Marginalia — Fixture</title>
<link rel="preconnect" href="https://substackcdn.com">
<style>body{font:17px/1.7 Georgia,serif;max-width:40rem;margin:3rem auto;padding:0 1.5rem;color:#222}</style>
<article>${article}</article>
<section id="comments"><h2>Comments</h2>${comments.map((c) => commentHtml(c)).join('')}</section>`
// The permalink page: the comment arrives after a moment, as on the real page,
// with its own Reply link; the box at the top is NOT a reply to it.
const permalinkPage = (id) => `<!doctype html><meta charset="utf-8"><title>Comment ${id}</title>
<link rel="preconnect" href="https://substackcdn.com">
<textarea placeholder="Write a comment..." data-top-level></textarea>
<div id="thread"></div>
<script>setTimeout(() => { document.getElementById('thread').innerHTML = ${JSON.stringify(commentHtml({ id: Number(id), name: 'Someone', body: 'the comment', children: [] }))} }, 300)</script>`

const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }
  const html = (h) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(h) }
  if (u.pathname === '/p/on-marginalia') return html(page)
  if (u.pathname.startsWith('/p/on-marginalia/comment/')) return html(permalinkPage(u.pathname.split('/').pop()))
  if (u.pathname === '/api/v1/posts/on-marginalia') return json({ id: 42, slug: 'on-marginalia' })
  if (u.pathname === '/api/v1/post/42/comments') return json({ comments })
  if (u.pathname === '/a figure.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(readFileSync(join(root, 'demo/a figure.png'))) }
  res.writeHead(404); res.end()
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

// No vsync: headless Chrome on macOS can wait forever for a display frame (no
// requestAnimationFrame, no screenshots), and hover throttling rides on rAF.
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-frame-rate-limit', '--disable-gpu-vsync'] })
const pg = await browser.newPage()
await pg.setViewport({ width: 1400, height: 900, deviceScaleFactor: process.env.MG_SHOT ? 2 : 1 })
const errs = []
pg.on('pageerror', (e) => errs.push(String(e)))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const click = async (sel) => {
  const h = await pg.$(sel); if (!h) throw new Error('no element for ' + sel)
  await h.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  const b = await h.boundingBox(); await pg.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await wait(150)
}

await pg.goto(`${origin}/p/on-marginalia`, { waitUntil: 'load' })
await pg.evaluate(bundle)
await wait(600)

// --- the picker ---------------------------------------------------------------
const options = await pg.$$eval('.mg-bar [data-view] option', (os) => os.map((o) => o.textContent))
ok('the picker lists the threads that quote the page', JSON.stringify(options) === JSON.stringify(['Your notes', 'Maria · 5', 'Ann · 1']), JSON.stringify(options))
ok('...and is shown', await pg.$eval('.mg-bar [data-view]', (e) => !e.hidden))

// a note of our own first, to check it is parked and restored
await pg.evaluate(() => {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n
  while ((n = w.nextNode())) { const i = n.data.indexOf('The point is not the'); if (i < 0) continue
    const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 20)
    const s = getSelection(); s.removeAllRanges(); s.addRange(r)
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); return }
})
await wait(200)
await pg.$eval('.mg-compose textarea', (e) => e.focus())
await pg.keyboard.type('my own note')
await click('.mg-compose [data-act="save"]')
await wait(300)
ok('own note made', (await pg.evaluate(() => window.__marginer.markdown())).includes('my own note'))

// --- Maria's thread ---------------------------------------------------------
await pg.select('.mg-bar [data-view]', '101')
await wait(500)
ok('three passages are highlighted (two of hers, one Maria added in a reply)', await pg.evaluate(() => CSS.highlights.get('marginer')?.size) === 3)
if (process.env.MG_SHOT) { await pg.evaluate(() => window.scrollTo(0, 0)); await wait(300); await pg.screenshot({ path: process.env.MG_SHOT }) }
const cards = await pg.$$eval('.mg-beside .mg-card.mg-foreign', (cs) => cs.map((c) => ({
  quote: c.querySelector('.mg-quote').textContent.trim(),
  entries: [...c.querySelectorAll('.mg-entry')].map((e) => ({ who: e.querySelector('.mg-who b').textContent, text: e.querySelector('.mg-md')?.textContent.trim() ?? '', emoji: e.querySelector('.mg-entry-emoji')?.textContent ?? '', indent: e.style.marginLeft })),
})))
const honest = cards.find((c) => c.quote.startsWith('only honest'))
ok('the passage Tom and Maria argued over carries all three entries, in thread order',
  honest && honest.entries.map((e) => e.who).join(',') === 'Maria,Tom,Maria', JSON.stringify(honest))
ok('replies are indented under what they answer', honest && honest.entries.map((e) => e.indent).join(',') === '0px,12px,24px')
ok('a reaction shows as a reaction, not as prose', honest && honest.entries[0].emoji === '🔥' && !honest.entries[0].text.includes('🔥'))
ok('the passage Maria quoted afresh in her reply is its own card', cards.some((c) => c.quote === 'Markdown travels' && c.entries[0].who === 'Maria' && c.entries[0].text === 'Agreed here too.'))
ok('cards are read-only: no ✕, no editor', await pg.$('.mg-beside .mg-cardx') === null && await pg.$('.mg-beside textarea') === null)
ok('the pane is an empty reply draft while a thread is up', await pg.$eval('.mg-pane', (e) => !e.readOnly && e.value === '' && e.placeholder.startsWith('Reply to Maria')))
ok('own notes are parked, not shown', await pg.evaluate(() => !document.body.textContent.includes('my own note') || !document.querySelector('.mg-beside .mg-card:not(.mg-foreign)')))
ok('nothing of the thread was saved as ours', !(await pg.evaluate(() => localStorage.getItem('marginer:' + location.href.replace(/#.*/, '')) ?? '')).includes('Overstated'))

// --- replies accumulate into a draft per comment ------------------------------
const paneVal = () => pg.$eval('.mg-pane', (e) => e.value)
await click('.mg-beside .mg-card.mg-foreign [data-reply="1"]')   // Tom's entry
await wait(300)
ok('Reply opens the pane as a draft to that comment', await pg.$eval('.mg-sidebar', (e) => e.style.display === '') && await pg.$eval('.mg-pane', (e) => document.activeElement === e && !e.readOnly))
ok('...with the article quote nested under Tom\'s note, caret beneath', (await paneVal()) === '> > only honest reading anyone ever gives a text\n> Not overstated at all — that narrower thing is exactly what he meant.\n\n')
ok('...and Send named for him', await pg.$eval('.mg-sidebar [data-act="send"]', (b) => !b.hidden && b.textContent === 'Send reply to Tom'))
await pg.keyboard.type('Then we agree more than we thought.')
await wait(200)
// now Maria, twice: her note on this passage, and her note on another
await click('.mg-sidebar [data-act="mode"]')      // back to view mode to reach the cards
await wait(300)
await click('.mg-beside .mg-card.mg-foreign [data-reply="0"]')
await wait(300)
ok('a reply to a different comment starts its own draft', (await paneVal()).startsWith('> > only honest reading anyone ever gives a text\n> Overstated, but I like it.\n\n'))
await pg.keyboard.type('Also this.')
await click('.mg-sidebar [data-act="mode"]')
await wait(300)
const second = await pg.$$('.mg-beside .mg-card.mg-foreign')
await second[1].evaluate((el) => el.scrollIntoView({ block: 'center' }))
await click('.mg-beside .mg-card.mg-foreign:nth-child(2) [data-reply="0"]')
await wait(300)
ok('a second reply to the same comment accumulates in that draft', /^> > only honest[\s\S]*Also this\.\n\n\n> > argument in miniature\n> This is the thesis\.\n\n$/.test(await paneVal()), JSON.stringify(await paneVal()))
await pg.keyboard.type('And this.')
await wait(200)
ok('both drafts are offered', await pg.$$eval('.mg-sidebar [data-draft] option', (os) => os.map((o) => o.textContent).join('|')) === 'Maria|Tom (draft)')
if (process.env.MG_SHOT2) { await pg.screenshot({ path: process.env.MG_SHOT2 }) }

// send Maria's
await pg.evaluate(() => { navigator.clipboard.writeText = async () => {} })
await click('.mg-sidebar [data-act="send"]')
await wait(1500)
const toMaria = await pg.$eval('textarea[data-reply-to="101"]', (e) => e.value).catch(() => null)
ok('Send opens Maria\'s own reply box (not a child\'s) and fills it', !!toMaria, 'no reply box under comment 101')
ok('...with both blocks, replies beneath each, and the attribution line', !!toMaria && /^> > only honest reading anyone ever gives a text\n> Overstated, but I like it\.\n\nAlso this\.\n\n\n> > argument in miniature\n> This is the thesis\.\n\nAnd this\.\n\n✍️ marginer\.app/.test(toMaria), JSON.stringify(toMaria))
ok('Tom\'s draft is now the one up', await pg.$eval('.mg-sidebar [data-act="send"]', (b) => b.textContent === 'Send reply to Tom') && (await paneVal()).includes('Then we agree'))
await click('.mg-sidebar [data-act="send"]')
await wait(1500)
const toTom = await pg.$eval('textarea[data-reply-to="102"]', (e) => e.value).catch(() => null)
ok('...and sends to Tom\'s box', !!toTom && toTom.startsWith('> > only honest reading anyone ever gives a text\n> Not overstated at all') && toTom.includes('\n\nThen we agree more than we thought.\n'))
ok('nothing was posted or stored as ours', !(await pg.evaluate(() => window.__marginer.markdown())).includes('agree more'))

// --- a fresh quote while viewing a thread goes into the root's draft ---------
await click('.mg-sidebar [data-act="mode"]')
await wait(200)
await pg.evaluate(() => {
  const w = document.createTreeWalker(document.querySelector('article'), NodeFilter.SHOW_TEXT); let n
  while ((n = w.nextNode())) { const i = n.data.indexOf('Coleridge filled'); if (i < 0) continue
    const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 16)
    const s = getSelection(); s.removeAllRanges(); s.addRange(r)
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); return }
})
await wait(300)
ok('a selection quotes into a reply to Maria\'s comment, not a note of our own', (await paneVal()) === '> Coleridge filled\n\n' && await pg.$eval('.mg-sidebar [data-act="send"]', (b) => b.textContent === 'Send reply to Maria') && await pg.$('.mg-compose') === null)
await pg.keyboard.type('draft that should survive a reload')
await wait(300)

// --- drafts persist ------------------------------------------------------------
await pg.reload({ waitUntil: 'load' })
await pg.evaluate(bundle)
await wait(700)
await pg.select('.mg-bar [data-view]', '101')
await wait(400)
ok('the draft is still there after a reload', (await paneVal()).includes('draft that should survive a reload'))
await pg.$eval('.mg-pane', (e) => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })) })
await wait(200)

// --- back to our own ------------------------------------------------------------
await pg.select('.mg-bar [data-view]', 'mine')
await wait(400)
ok('own notes come back intact', (await pg.evaluate(() => window.__marginer.markdown())).includes('my own note') && await pg.evaluate(() => CSS.highlights.get('marginer')?.size) === 1)
ok('the pane shows our document again', (await paneVal()).includes('my own note') && await pg.$eval('.mg-sidebar [data-act="send"]', (b) => b.hidden))

// --- the permalink fallback: no comment on the page -> userscript fills the box --
await pg.evaluate(() => localStorage.setItem('marginer:pending-reply', JSON.stringify({ url: location.origin + '/p/on-marginalia/comment/102', id: '102', text: 'a reply that travelled' })))
await pg.goto(`${origin}/p/on-marginalia/comment/102`, { waitUntil: 'load' })
await pg.evaluate(user)
await wait(1500)
ok('the userscript opens THAT comment\'s reply box on the permalink page and fills it', await pg.$eval('textarea[data-reply-to="102"]', (e) => e.value).catch(() => null) === 'a reply that travelled')
ok('...and leaves the top-level box alone', await pg.$eval('textarea[data-top-level]', (e) => e.value) === '')
ok('...and forgets the pending reply', await pg.evaluate(() => localStorage.getItem('marginer:pending-reply')) === null)

ok('no page errors', errs.length === 0, errs.join(' | '))
await browser.close()
server.close()
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nThread checks passed.')
process.exit(fails.length ? 1 : 0)
