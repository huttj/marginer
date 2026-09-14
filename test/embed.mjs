// The embeddable build: boots from Marginer.init() with a custom storage
// adapter and a read-only author layer, on the demo page for it.
import puppeteer from 'puppeteer-core'
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const base = `${process.env.HOME}/.cache/puppeteer/chrome`
const rel = 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
const CHROME = readdirSync(base).sort().map((b) => join(base, b, rel)).filter(existsSync).pop()
if (!CHROME) throw new Error('No Chrome for Testing found under ' + base)

const fails = []
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${cond ? '' : '  ← ' + extra}`)
  if (!cond) fails.push(name)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-frame-rate-limit', '--disable-gpu-vsync'] })
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 900 })
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })
const click = async (sel) => {
  const h = await page.$(sel); if (!h) throw new Error('no element for ' + sel)
  await h.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  const b = await h.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await wait(150)
}
const select = (text) => page.evaluate((text) => {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n
  while ((n = w.nextNode())) { const i = n.data.indexOf(text); if (i < 0) continue
    const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + text.length)
    const s = getSelection(); s.removeAllRanges(); s.addRange(r)
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); return true }
  return false
}, text)

await page.goto('file://' + join(root, 'demo/embed.html'), { waitUntil: 'load' })
await wait(400)

ok('Marginer.init is the global the classic script exposes', await page.evaluate(() => typeof Marginer.init === 'function' && !!window.__marginer))
ok('boots into view mode', await page.$eval('.mg-bar', (e) => e.style.display) === '')
ok('the author layer paints in its own highlight', await page.evaluate(() => CSS.highlights.get('marginer-layer')?.size) === 2)
ok('...and nothing is painted as the reader\'s own yet', await page.evaluate(() => !CSS.highlights.get('marginer')))
const cards = await page.$$eval('.mg-beside .mg-card.mg-layer', (cs) => cs.map((c) => ({
  quote: c.querySelector('.mg-quote').textContent.trim(),
  who: c.querySelector('.mg-who b').textContent,
  text: c.querySelector('.mg-md')?.textContent.trim() ?? '',
  emoji: c.querySelector('.mg-entry-emoji')?.textContent ?? '',
  reply: !!c.querySelector('[data-reply]'), x: !!c.querySelector('.mg-cardx'), link: !!c.querySelector('.mg-who a'),
})))
ok('the layer\'s notes are cards in the gutter, labelled', cards.length === 2 && cards.every((c) => c.who === 'Author'), JSON.stringify(cards))
ok('a reaction shows as a reaction', cards.some((c) => c.quote.startsWith('only honest') && c.emoji === '🔥' && c.text.startsWith('An author note')), JSON.stringify(cards))
ok('layer cards are read-only: no Reply, no ✕, no permalink', cards.every((c) => !c.reply && !c.x && !c.link), JSON.stringify(cards))
ok('the count is the reader\'s notes, not the layer\'s', await page.$eval('.mg-bar [data-count]', (e) => e.textContent) === '')
ok('the picker stays hidden (no site threads)', await page.$eval('.mg-bar [data-view]', (e) => e.hidden))

// The reader annotates on top of the layer.
ok('a passage was selected', await select('argument in miniature'))
await wait(200)
await page.$eval('.mg-compose textarea', (e) => e.focus())
await page.keyboard.type('a visitor note')
await click('.mg-compose [data-act="save"]')
await wait(700) // saveQuiet is debounced 500ms
ok('the note went through the custom adapter', (await page.evaluate(() => [...window.demoStorage.memory.values()].join('\n'))).includes('a visitor note'))
ok('the layer was NOT written into the reader\'s document', !(await page.evaluate(() => [...window.demoStorage.memory.values()].join('\n'))).includes('author note'))
ok('markdown() is the reader\'s own', (await page.evaluate(() => window.__marginer.markdown())).trim() === '> argument in miniature\n\na visitor note')
ok('both paint at once', await page.evaluate(() => CSS.highlights.get('marginer')?.size === 1 && CSS.highlights.get('marginer-layer')?.size === 2))
ok('the count is now 1', await page.$eval('.mg-bar [data-count]', (e) => e.textContent) === '1')

// Cards only (pane: false): the list is never offered, and the reader's own
// card carries its delete button.
ok('pane: false hides the list button', await page.$eval('.mg-bar [data-act="mode"]', (e) => e.hidden))
ok('the sidebar stays hidden', await page.$eval('.mg-sidebar', (e) => e.style.display) === 'none')
ok('the reader\'s own card has a delete button', await page.$$eval('.mg-beside .mg-card:not(.mg-layer) .mg-cardx', (n) => n.length) === 1)
await click('.mg-bar [data-act="collapse"]')
ok('collapsed: the pill shows, highlights stay painted', !!(await page.$('.mg-fab')) && await page.evaluate(() => CSS.highlights.get('marginer')?.size === 1))
ok('a passage can still be selected while collapsed', await select('portable'))
await wait(200)
ok('...and the compose popover opens', !!(await page.$('.mg-compose')))
await page.keyboard.press('Escape')
await click('.mg-fab')
// (.mg-peek is a second .mg-beside, so count the real cards apart from the hover peek.)
const nCards = (extra = '') => page.$$eval(`.mg-beside:not(.mg-peek) .mg-card${extra}`, (n) => n.length)
const peeks = () => page.$$eval('.mg-peek .mg-card', (n) => n.length)
ok('the pill reopens the cards', await page.$eval('.mg-bar', (e) => e.style.display) === '' && await nCards() === 3)

// Narrow: no gutter, so cards go under the text -- one at a time, on a tap.
await page.setViewport({ width: 400, height: 800 })
await wait(300)
ok('narrow with pane: false still shows the bar, never the sidebar', await page.$eval('.mg-bar', (e) => e.style.display) === '' && await page.$eval('.mg-sidebar', (e) => e.style.display) === 'none')
ok('no cards until one is asked for', await nCards() === 0)
ok('nothing is reserved in the page margin', await page.evaluate(() => !document.documentElement.style.margin))
let pt = null // where the last tap landed
const tapHighlight = async (text) => {
  pt = await page.evaluate((text) => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n
    while ((n = w.nextNode())) { const i = n.data.indexOf(text); if (i < 0) continue
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + text.length)
      const rc = r.getClientRects()[0]; return { x: rc.left + 4, y: rc.top + rc.height / 2 } }
    return null
  }, text)
  await page.mouse.move(pt.x, pt.y); await wait(60)
  await page.mouse.click(pt.x, pt.y); await wait(250)
}
await tapHighlight('argument in miniature')
const inline = await page.evaluate(() => {
  const card = document.querySelector('.mg-beside:not(.mg-peek) .mg-card')
  if (!card) return null
  const m = window.__marginer
  const blk = m.blocks.find((b) => b.id === card.dataset.blockId)
  const rects = [...blk.ranges[0].getClientRects()].filter((r) => r.width)
  const last = rects.reduce((a, r) => (r.bottom > a.bottom ? r : a))
  const col = blk.ranges[0].startContainer.parentElement.closest('p').getBoundingClientRect()
  const cr = card.getBoundingClientRect()
  return { own: !card.classList.contains('mg-layer'), inline: card.classList.contains('mg-inline'), x: !!card.querySelector('.mg-cardx'),
    editor: !!card.querySelector('textarea'), belowLast: cr.top >= last.bottom, gap: cr.top - last.bottom,
    leftOk: Math.abs(cr.left - col.left) < 2, widthOk: Math.abs(cr.width - col.width) < 2, peeks: document.querySelectorAll('.mg-peek .mg-card').length }
})
ok('tapping a highlight shows its card alone, under the highlight\'s last line, the width of the column', !!inline && inline.own && inline.inline && inline.belowLast && inline.gap < 12 && inline.leftOk && inline.widthOk, JSON.stringify(inline))
ok('...as a read view with a delete button (no keyboard raised)', !!inline && inline.x && !inline.editor && inline.peeks === 0, JSON.stringify(inline))
ok('only one card shows', await nCards() === 1)
await click('.mg-beside .mg-card .mg-note')
ok('tapping the card opens the editor', !!(await page.$('.mg-beside .mg-card textarea')))
await tapHighlight('argument in miniature')
ok('tapping the highlight again puts the card away (and the hover does not peek it straight back)', await nCards() === 0 && await peeks() === 0)
await tapHighlight('Markdown travels')
ok('a layer\'s card shows the same way', await nCards('.mg-layer.mg-inline') === 1)
await page.mouse.click(30, 30); await wait(250)
ok('tapping elsewhere puts it away', await nCards() === 0)
await page.mouse.move(pt.x, pt.y); await wait(150)
ok('hovering a highlight peeks its card under the text', await peeks() === 1 && await page.$eval('.mg-peek .mg-card', (c) => c.classList.contains('mg-inline')))
await page.mouse.move(5, 5); await wait(150)
ok('the compose popover still works narrow', await select('diary') && (await wait(200), !!(await page.$('.mg-compose'))))
await page.keyboard.press('Escape')
await page.setViewport({ width: 1280, height: 900 })
await wait(300)
ok('widening brings every card back to the gutter', await nCards(':not(.mg-inline)') === 3 && await nCards() === 3)

// The pane, when it IS wanted (mode: 'list'): the reader's document alone; the layer stays on the page.
await page.evaluate(() => { Marginer.init({ storage, mode: 'list', layers: window.demoLayers }) })
await wait(300)
ok('mode: \'list\' boots into the sidebar', await page.$eval('.mg-sidebar', (e) => e.style.display) === '')
ok('the pane holds the reader\'s document alone', await page.$eval('.mg-pane', (e) => e.value.trim()) === '> argument in miniature\n\na visitor note')
ok('the layer still paints with the sidebar open', await page.evaluate(() => CSS.highlights.get('marginer-layer')?.size) === 2)

// A second init replaces the first; destroy() leaves nothing behind.
await page.evaluate(() => { Marginer.init({ storage: { loadDoc: () => null, saveDoc: () => {} } }); })
await wait(300)
ok('a second init() replaces the first (one bar, no layer)', await page.$$eval('.mg-bar', (b) => b.length) === 1 && await page.evaluate(() => !CSS.highlights.get('marginer-layer')))
await page.evaluate(() => window.__marginer.destroy())
ok('destroy() removes every node', await page.$$eval('[data-mg-ui]', (n) => n.length) === 0)

ok('no page errors', errs.length === 0, errs.join(' | '))
await browser.close()
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1) }
console.log('\nall passed')
