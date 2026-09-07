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
const dark = process.argv.includes('--dark')

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }])
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 })
await page.goto('file://' + join(root, process.env.MG_PAGE || 'demo/index.html'), { waitUntil: 'load' })
await page.evaluate(bundle)
await new Promise((r) => setTimeout(r, 200))

const click = async (sel) => { const b = await (await page.$(sel)).boundingBox(); await page.mouse.click(b.x + b.width/2, b.y + b.height/2); await new Promise((r) => setTimeout(r, 180)) }
const annotate = async (phrase, note, emoji) => {
  const found = await page.evaluate((phrase) => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n
    while ((n = w.nextNode())) {
      // Match across source line breaks -- markup wraps mid-phrase all the time.
      const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
      const m = re.exec(n.data); if (!m) continue
      const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length)
      const s = getSelection(); s.removeAllRanges(); s.addRange(r)
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); return getSelection().toString() }
    return null
  }, phrase)
  await new Promise((r) => setTimeout(r, 150))
  if (!(await page.$('.mg-compose'))) throw new Error(`no panel for ${JSON.stringify(phrase)} (selection=${JSON.stringify(found)})`)
  if (note) { await page.$eval('.mg-compose textarea', (e) => e.focus()); await page.keyboard.type(note) }
  for (const em of emoji ?? []) await click(`.mg-compose .mg-emojibar button[data-e="${em}"]`)
  await click('.mg-compose [data-act="save"]')
}

await annotate('only honest reading anyone ever gives a text', 'Overstated, but I like it — Coleridge is doing something narrower here, and the essay never quite says which. Compare his marginalia on Kant.', ['🔥'])
await annotate('argument in miniature', 'This is the thesis — put it in the opening paragraph.', ['🎯', '🤔'])
await annotate('Marginalia that can', '', ['👍'])
await annotate('The point is not the', 'Good closing line. Consider moving it up: it is the only sentence that tells a reader what the piece is for, and it currently arrives after they have stopped caring.', [])
await annotate('digital reading was never', 'Is this true? Kindle highlights, Instapaper, Readwise — the annotating never stopped.', ['🤔'])

const shot = async (name) => { await page.screenshot({ path: join(root, `test/.shots/${name}.png`) }) }
await page.evaluate(() => window.scrollTo(0, 0))
await new Promise((r) => setTimeout(r, 350))
await shot(dark ? 'overview-dark' : 'overview')

// view mode: cards beside the text, one pinned to its highlight
await click('.mg-sidebar [data-act="mode"]')
await new Promise((r) => setTimeout(r, 400))
await click('.mg-beside .mg-card:nth-child(4)')
await new Promise((r) => setTimeout(r, 400))
await shot(dark ? 'beside-dark' : 'beside')
await page.keyboard.press('Escape')
await click('.mg-bar [data-act="mode"]')
await new Promise((r) => setTimeout(r, 300))

// focused (editing) card
await click('.mg-card:nth-child(2)')
await new Promise((r) => setTimeout(r, 300))
await shot(dark ? 'focused-dark' : 'focused')

// compose popover
await page.keyboard.press('Escape')
await annotateOpen()
async function annotateOpen() {
  await page.evaluate(() => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n
    while ((n = w.nextNode())) { const i = n.data.indexOf('Markdown travels'); if (i < 0) continue
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 16)
      const s = getSelection(); s.removeAllRanges(); s.addRange(r)
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); return }
  })
  await new Promise((r) => setTimeout(r, 150))
  await page.$eval('.mg-compose textarea', (e) => e.focus())
  await page.keyboard.type('This is the whole point of the tool.')
  await new Promise((r) => setTimeout(r, 200))
}
await shot(dark ? 'compose-dark' : 'compose')
await browser.close()
console.log('shots written')
