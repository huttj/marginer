// The userscript's contract is mostly about what it does NOT do: on a page with
// no notes it must inject nothing at all. These checks pin that down, then the
// indicator path, then the keyboard summon.
import puppeteer from 'puppeteer-core'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const base = `${process.env.HOME}/.cache/puppeteer/chrome`
const rel = 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
const CHROME = readdirSync(base).sort().map((b) => join(base, b, rel)).filter(existsSync).pop()

const core = readFileSync(join(root, 'dist/marginer.js'), 'utf8')
const user = readFileSync(join(root, 'dist/marginer.user.js'), 'utf8')
const fails = []
const ok = (n, c, x = '') => { console.log(`${c ? '  ok  ' : ' FAIL '} ${n}${c ? '' : '  ← ' + x}`); if (!c) fails.push(n) }

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 900 })
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
const demo = 'file://' + join(root, 'demo/index.html')

ok('metadata block is first in the file', user.startsWith('// ==UserScript=='))
ok('runs in the page context (@grant none)', /^\/\/ @grant\s+none$/m.test(user))
ok('stays out of iframes', /^\/\/ @noframes$/m.test(user))

// --- a page with no notes: the userscript must be inert ---------------------
await page.goto(demo, { waitUntil: 'load' })
await page.evaluate(user)
await new Promise((r) => setTimeout(r, 400))
ok('injects nothing on an unannotated page', await page.evaluate(() => document.querySelectorAll('[data-mg-ui]').length) === 0)
ok('adds no stylesheet either', await page.evaluate(() => !!document.querySelector('style[data-mg-ui]')) === false)
ok('leaves no global behind', await page.evaluate(() => window.__marginer === undefined))

// --- ⌘⇧U summons it anyway ---------------------------------------------------
await page.keyboard.down('Meta'); await page.keyboard.down('Shift')
await page.keyboard.press('KeyU')
await page.keyboard.up('Shift'); await page.keyboard.up('Meta')
await new Promise((r) => setTimeout(r, 400))
ok('⌘⇧U summons the full sidebar', await page.$('.mg-sidebar') !== null && await page.$eval('.mg-sidebar', (e) => e.style.display) === '')

// --- leave a note, so the next visit has something to indicate --------------
const click = async (sel) => {
  const b = await (await page.$(sel)).boundingBox()
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
  await new Promise((r) => setTimeout(r, 150))
}
await page.evaluate(() => {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n
  while ((n = w.nextNode())) { const i = n.data.indexOf('argument in miniature'); if (i < 0) continue
    const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 21)
    const s = getSelection(); s.removeAllRanges(); s.addRange(r)
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); return }
})
await new Promise((r) => setTimeout(r, 200))
await page.$eval('.mg-compose textarea', (e) => e.focus())
await page.keyboard.type('Left for the next visit.')
await click('.mg-compose [data-act="save"]')
await new Promise((r) => setTimeout(r, 300))

// --- revisit: the indicator appears on its own -------------------------------
await page.reload({ waitUntil: 'load' })
await page.evaluate(user)
await new Promise((r) => setTimeout(r, 500))
ok('pill appears on a page that has notes', await page.$('.mg-fab') !== null)
ok('pill shows the note count', (await page.$eval('.mg-fab', (e) => e.textContent)).trim().endsWith('1'))
ok('pill names the count in its tooltip', (await page.$eval('.mg-fab', (e) => e.title)) === '1 note on this page — click to open')
ok('sidebar stays closed until asked', await page.$eval('.mg-sidebar', (e) => e.style.display) === 'none')
ok('highlights are restored', await page.evaluate(() => CSS.highlights.get('marginer')?.size === 1))
await click('.mg-fab')
ok('clicking the pill opens the sidebar', await page.$eval('.mg-sidebar', (e) => e.style.display) === '')
ok('the restored note is there', (await page.$$('.mg-card')).length === 1)

// --- the bookmarklet and the userscript share one store ----------------------
await page.reload({ waitUntil: 'load' })
await page.evaluate(core) // the bookmarklet/extension bundle
await new Promise((r) => setTimeout(r, 400))
ok('bookmarklet sees the userscript’s notes', (await page.$$('.mg-card')).length === 1)
ok('...and exports them', (await page.evaluate(() => window.__marginer.markdown())).includes('Left for the next visit.'))

ok('no page errors', errs.length === 0, errs.join(' | '))
await browser.close()
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nUserscript checks passed.')
process.exit(fails.length ? 1 : 0)
