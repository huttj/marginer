// Loads the unpacked extension in a real Chrome and drives its toolbar action:
// proves the manifest parses, the service worker registers, and the injection
// path (chrome.scripting.executeScript) actually mounts the UI on a page.
import puppeteer from 'puppeteer-core'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const base = `${process.env.HOME}/.cache/puppeteer/chrome`
const rel = 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
const CHROME = readdirSync(base).sort().map((b) => join(base, b, rel)).filter(existsSync).pop()
const shipped = join(root, 'extension')

const fails = []
const ok = (n, c, x = '') => { console.log(`${c ? '  ok  ' : ' FAIL '} ${n}${c ? '' : '  ← ' + x}`); if (!c) fails.push(n) }

// The shipped extension asks for `activeTab`, so a page is only ever touched
// when the user clicks the toolbar button -- which is the point, but it also
// means a test can't drive executeScript itself. Run the behaviour checks from a
// copy that adds host permissions, and assert separately that the REAL manifest
// stays narrow.
const manifest = JSON.parse(readFileSync(join(shipped, 'manifest.json'), 'utf8'))
ok('manifest asks for activeTab, not broad host access',
  manifest.permissions.includes('activeTab') && !manifest.host_permissions && !manifest.content_scripts,
  JSON.stringify({ permissions: manifest.permissions, host_permissions: manifest.host_permissions }))
ok('nothing runs until the user clicks', !manifest.content_scripts)

const ext = mkdtempSync(join(tmpdir(), 'marginer-ext-'))
cpSync(shipped, ext, { recursive: true })
writeFileSync(join(ext, 'manifest.json'), JSON.stringify({ ...manifest, host_permissions: ['<all_urls>'] }, null, 2))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox'],
})
const worker = await browser.waitForTarget((t) => t.type() === 'service_worker', { timeout: 15000 })
ok('service worker registered', !!worker)
const extId = new URL(worker.url()).host
ok('extension id resolved', /^[a-p]{32}$/.test(extId), extId)

const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 900 })
await page.goto('file://' + join(root, 'demo/index.html'), { waitUntil: 'load' })

// Fire the toolbar action from inside the service worker (there is no UI to click).
const sw = await worker.worker()
const tabId = await sw.evaluate(async () => {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true })
  return t?.id ?? null
})
ok('found the active tab', tabId !== null)
// Exactly what background.js does when the toolbar button is clicked.
await sw.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ['marginer.js'] }), tabId)
await new Promise((r) => setTimeout(r, 400))
ok('sidebar injected into the page', await page.$('.mg-sidebar') !== null)

// chrome.storage is the extension's persistence path -- exercise it end to end.
await page.evaluate(() => {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n
  while ((n = w.nextNode())) { const i = n.data.indexOf('Markdown travels'); if (i < 0) continue
    const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 16)
    const s = getSelection(); s.removeAllRanges(); s.addRange(r)
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); return }
})
await new Promise((r) => setTimeout(r, 200))
await page.$eval('.mg-compose textarea', (e) => e.focus())
await page.keyboard.type('Saved through chrome.storage.')
const sb = await (await page.$('.mg-compose [data-act="save"]')).boundingBox()
await page.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2)
await new Promise((r) => setTimeout(r, 400))

const keys = await sw.evaluate(() => chrome.storage.local.get(null).then((o) => Object.keys(o)))
ok('note written to chrome.storage.local', keys.some((k) => k.startsWith('marginer:')), JSON.stringify(keys))

await page.reload({ waitUntil: 'load' })
await sw.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ['marginer.js'] }), tabId)
await new Promise((r) => setTimeout(r, 500))
ok('note restored after reload', await page.$eval('.mg-fab [data-fabcount]', (e) => e.textContent) === '1')

await browser.close()
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nExtension checks passed.')
process.exit(fails.length ? 1 : 0)
