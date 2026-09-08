// Does the bookmarklet survive a strict Content-Security-Policy? That's the whole
// question for "use it while you read Substack/GitHub/news sites", so it gets a
// real server sending a real CSP header rather than an assumption.
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

const bookmarklet = readFileSync(join(root, 'dist/bookmarklet.txt'), 'utf8')
const bundle = readFileSync(join(root, 'dist/marginer.js'), 'utf8')
const fails = []
const ok = (n, c, x = '') => { console.log(`${c ? '  ok  ' : ' FAIL '} ${n}${c ? '' : '  ← ' + x}`); if (!c) fails.push(n) }

// A matrix, because the answer is policy-dependent and worth knowing precisely.
const POLICIES = [
  ['no CSP at all', null, true],
  ["script-src 'self' 'unsafe-inline'", "default-src 'self'; script-src 'self' 'unsafe-inline'", true],
  ["script-src 'self'", "default-src 'self'; script-src 'self'", false],
  ["default-src 'self' (no script-src)", "default-src 'self'", false],
]
const PAGE = `<!doctype html><meta charset="utf-8"><title>Policy test</title>
<body><article><p id="p">A paragraph on a page that may forbid every script it did not serve itself.
Highlighting this sentence is the thing we are testing.</p></article>
<a id="bm" href="__BM__">install</a></body>`

let policy = null
const server = createServer((req, res) => {
  const h = { 'Content-Type': 'text/html; charset=utf-8' }
  if (policy) h['Content-Security-Policy'] = policy
  res.writeHead(200, h)
  res.end(PAGE.replace('__BM__', bookmarklet.replace(/"/g, '&quot;')))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${server.address().port}/`

// No vsync: headless Chrome on macOS can wait forever for a display frame (no
// requestAnimationFrame, no screenshots), and hover throttling rides on rAF.
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-frame-rate-limit', '--disable-gpu-vsync'] })

for (const [label, csp, expected] of POLICIES) {
  policy = csp
  const page = await browser.newPage()
  await page.setViewport({ width: 1100, height: 760 })
  await page.goto(url, { waitUntil: 'load' })
  // A coordinate click, as in smoke.mjs: page.click() waits on an intersection
  // check that can stall indefinitely in headless Chrome.
  const bm = await (await page.$('#bm')).boundingBox()
  await page.mouse.click(bm.x + bm.width / 2, bm.y + bm.height / 2)
  await new Promise((r) => setTimeout(r, 500))
  const ran = await page.$('.mg-sidebar') !== null
  ok(`${expected ? 'runs' : 'blocked'} under: ${label}`, ran === expected, `actually ${ran ? 'ran' : 'blocked'}`)
  if (ran) {
    // Prove the whole loop works there, not just the mount.
    await page.evaluate(() => {
      const t = document.getElementById('p').firstChild
      const r = document.createRange(); r.setStart(t, 2); r.setEnd(t, 30)
      const s = getSelection(); s.removeAllRanges(); s.addRange(r)
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    await new Promise((r) => setTimeout(r, 250))
    await page.$eval('.mg-compose textarea', (e) => e.focus())
    await page.keyboard.type('works here')
    const sb = await (await page.$('.mg-compose [data-act="save"]')).boundingBox()
    await page.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2)
    await new Promise((r) => setTimeout(r, 350))
    ok(`  ...and the full note/export loop works there`,
       (await page.evaluate(() => window.__marginer.markdown())).includes('works here'))
  }
  await page.close()
}

// The extension injects through chrome.scripting, which CSP does not govern --
// that is the fallback for pages where the bookmarklet is refused.
{
  policy = "default-src 'self'; script-src 'self'"
  const page = await browser.newPage()
  await page.setViewport({ width: 1100, height: 760 })
  await page.goto(url, { waitUntil: 'load' })
  await page.evaluate(bundle) // stands in for chrome.scripting.executeScript
  await new Promise((r) => setTimeout(r, 400))
  ok('an injected content script is unaffected by the same CSP', await page.$('.mg-sidebar') !== null)
  await page.close()
}

await browser.close()
server.close()
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nCSP checks passed.')
process.exit(fails.length ? 1 : 0)
