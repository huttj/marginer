// End-to-end smoke test: drive a real Chrome, annotate the demo page, and check
// the highlights, the sidebar, and the markdown export.
import puppeteer from 'puppeteer-core'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const base = `${process.env.HOME}/.cache/puppeteer/chrome`
const rel = 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
const CHROME = readdirSync(base).sort().map((b) => join(base, b, rel)).filter(existsSync).pop()
if (!CHROME) throw new Error('No Chrome for Testing found under ' + base)

const bundle = readFileSync(join(root, 'dist/marginer.js'), 'utf8')
const fails = []
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${cond ? '' : '  ← ' + extra}`)
  if (!cond) fails.push(name)
}

// No vsync: headless Chrome on macOS can wait forever for a display frame (no
// requestAnimationFrame, no screenshots), and hover throttling rides on rAF.
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-frame-rate-limit', '--disable-gpu-vsync'] })
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 900 })
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })


// Real synthesized mouse clicks at the element's centre. (puppeteer's own
// page.click() hangs in its actionability wait against our absolutely-positioned
// overlay layer; clicking the coordinates exercises the same hit-testing.)
const type = async (sel, text) => {
  await page.$eval(sel, (el) => el.focus())
  await page.keyboard.type(text)
}
// Notes on the page, by state: a reaction-only note has no card (its chip is
// the note), so cards are not a count of notes.
const notes = () => page.evaluate(() => window.__marginer.blocks.length)
const click = async (sel) => {
  const h = await page.$(sel)
  if (!h) throw new Error('no element for ' + sel)
  await h.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  const b = await h.boundingBox()
  if (!b) throw new Error('no box for ' + sel)
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
  await new Promise((r) => setTimeout(r, 150))
}

await page.goto('file://' + join(root, 'demo/index.html'), { waitUntil: 'load' })
await page.evaluate(bundle)
await new Promise((r) => setTimeout(r, 200))

ok('boots into view mode: notes on the page, sidebar hidden', await page.$eval('.mg-bar', (e) => e.style.display) === '' && await page.$eval('.mg-sidebar', (e) => e.style.display) === 'none')
await click('.mg-bar [data-act="mode"]')
ok('the pill bar opens the sidebar', await page.$eval('.mg-sidebar', (e) => e.style.display) === '')
ok('the sidebar is a text pane, empty for now', await page.$eval('.mg-pane', (e) => e.value) === '')
ok('page is squeezed by the sidebar width', await page.evaluate(() =>
  parseInt(document.documentElement.style.marginRight) === document.querySelector('.mg-sidebar').offsetWidth))
// The rest of the popover/card checks run in view mode: cards beside the text,
// the pane closed (an open pane takes selections itself -- tested at the end).
await click('.mg-sidebar [data-act="mode"]')
await new Promise((r) => setTimeout(r, 300))
ok('view mode hides the sidebar', await page.$eval('.mg-sidebar', (e) => e.style.display) === 'none')
ok('...and releases the squeeze on a page with a gutter', await page.evaluate(() => !document.documentElement.style.margin))

// --- select a phrase and annotate it ---------------------------------------
const selectPhrase = (phrase) => page.evaluate((phrase) => {
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let n
  while ((n = walk.nextNode())) {
    // Match across source line breaks: a phrase in the markup is often wrapped,
    // so every run of whitespace has to match every other.
    const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
    const m = re.exec(n.data)
    if (!m) continue
    const r = document.createRange()
    r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length)
    const s = getSelection(); s.removeAllRanges(); s.addRange(r)
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    return true
  }
  return false
}, phrase)

ok('found phrase 1', await selectPhrase('argument in miniature'))
await new Promise((r) => setTimeout(r, 120))
ok('selecting opens the panel directly', await page.$('.mg-compose') !== null)
ok('compose shows the quote', (await page.$eval('.mg-compose .mg-quote', (e) => e.textContent)).includes('argument in miniature'))

await type('.mg-compose textarea', 'This is the whole thesis.')
await click('.mg-compose .mg-emojibar button[data-e="🔥"]')
await click('.mg-compose [data-act="save"]')
await new Promise((r) => setTimeout(r, 200))

ok('compose closed', await page.$('.mg-compose') === null)
ok('one card beside the text', (await page.$$('.mg-beside .mg-card')).length === 1)
ok('highlight registered', await page.evaluate(() => CSS.highlights.get('marginer')?.size === 1))
ok('margin emoji chip drawn', (await page.$$('.mg-emote-stack')).length === 1)
ok('card shows the emoji', (await page.$eval('.mg-card', (e) => e.textContent)).includes('🔥'))

// --- second annotation, emoji only -----------------------------------------
ok('found phrase 2', await selectPhrase('Markdown travels'))
await new Promise((r) => setTimeout(r, 120))
await new Promise((r) => setTimeout(r, 120))
await click('.mg-compose .mg-emojibar button[data-e="👍"]')
await click('.mg-compose [data-act="save"]')
await new Promise((r) => setTimeout(r, 200))
ok('two notes (the reaction-only one has no card, just its chip)', await notes() === 2 && (await page.$$('.mg-beside .mg-card')).length === 1)

// --- an ignored panel must leave nothing behind -----------------------------
const before = await notes()
ok('found phrase for the throwaway selection', await selectPhrase('Coleridge filled the margins'))
await new Promise((r) => setTimeout(r, 150))
ok('panel opened on a casual selection', await page.$('.mg-compose') !== null)
await page.mouse.click(30, 400) // click away without typing anything
await new Promise((r) => setTimeout(r, 250))
ok('empty panel closes on click-away', await page.$('.mg-compose') === null)
ok('...and creates no note', await notes() === before)
ok('...and no stray highlight', await page.evaluate(() => CSS.highlights.get('marginer')?.size ?? 0) === before)

// Escape discards a panel you HAD typed into, click-away keeps it.
ok('found phrase for the kept selection', await selectPhrase('parasitic on someone'))
await new Promise((r) => setTimeout(r, 150))
await type('.mg-compose textarea', 'kept on click-away')
await page.mouse.click(30, 400)
await new Promise((r) => setTimeout(r, 250))
ok('a typed panel survives click-away', await notes() === before + 1)
await click('.mg-card')            // open it
await click('.mg-card.focused .mg-cardx')
await new Promise((r) => setTimeout(r, 250))
ok('...and can be deleted again', await notes() === before)

// Selecting inside a form field is someone writing, not reading.
await page.evaluate(() => {
  const ta = document.createElement('textarea')
  ta.id = 'mg-field'; ta.value = 'a comment box on the host page'
  document.body.appendChild(ta)
  ta.focus(); ta.setSelectionRange(0, 9)
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
})
await new Promise((r) => setTimeout(r, 200))
ok('no panel for a selection inside a form field', await page.$('.mg-compose') === null)
await page.evaluate(() => document.getElementById('mg-field').remove())

// --- a reaction commits the moment you click it ------------------------------
const n0 = await notes()
ok('found phrase for the instant reaction', await selectPhrase('with such vigour'))
await new Promise((r) => setTimeout(r, 150))
await click('.mg-compose .mg-emojibar button[data-e="❤️"]')
ok('the note lands without pressing Save', await notes() === n0 + 1)
ok('margin chip appears too', (await page.$$('.mg-emote-stack')).length >= 1)
ok('panel stays open so you can keep writing', await page.$('.mg-compose') !== null)
ok('highlight is live, not a draft', await page.evaluate(() => CSS.highlights.get('marginer')?.size === 3))
await click('.mg-compose .mg-emojibar button[data-e="❤️"]')  // un-react
ok('un-reacting takes the note straight back out', await notes() === n0)
await page.keyboard.press('Escape')
await new Promise((r) => setTimeout(r, 200))

// --- an emoji you TYPE is an emoji you picked --------------------------------
const chips0 = (await page.$$('.mg-emote-stack')).length
ok('found phrase for the typed emoji', await selectPhrase('one reader, one app'))
await new Promise((r) => setTimeout(r, 150))
await page.$eval('.mg-compose textarea', (e) => e.focus())
await page.keyboard.sendCharacter('🎯')
await page.keyboard.type(' typed, not picked')
await new Promise((r) => setTimeout(r, 250))
ok('typing an emoji at the front adds a margin chip', (await page.$$('.mg-emote-stack')).length === chips0 + 1)
ok('the picker marks it selected', await page.$eval('.mg-compose .mg-emojibar button[data-e="🎯"]', (b) => b.classList.contains('selected')))
await click('.mg-compose [data-act="save"]')
await new Promise((r) => setTimeout(r, 250))
const typedMd = await page.evaluate(() => window.__marginer.markdown())
ok('it is stored at the head of the note, Penumbra-style', typedMd.includes('🎯 typed, not picked'))
ok('the card shows it as a reaction, not as prose', await page.evaluate(() => {
  const card = [...document.querySelectorAll('.mg-card')].find((c) => c.textContent.includes('typed, not picked'))
  return !!card && !card.querySelector('.mg-md').textContent.includes('🎯') && card.querySelector('.mg-card-emoji').textContent.includes('🎯')
}))
// Clicking the same emoji in the picker takes it back out of the note text.
const typedAt = await page.evaluate(() =>
  [...document.querySelectorAll('.mg-beside .mg-card')].findIndex((c) => c.textContent.includes('typed, not picked')) + 1)
ok('found the card we just made', typedAt > 0)
await click(`.mg-beside .mg-card:nth-child(${typedAt})`)
await new Promise((r) => setTimeout(r, 250))
await click('.mg-card.focused .mg-emojibar button[data-e="🎯"]')
await new Promise((r) => setTimeout(r, 250))
ok('un-picking it edits the note text itself', await page.$eval('.mg-card.focused textarea', (t) => t.value) === 'typed, not picked')
await click('.mg-card.focused .mg-cardx')
await new Promise((r) => setTimeout(r, 300))
ok('the typed-emoji note is gone again', !(await page.evaluate(() => window.__marginer.markdown())).includes('typed, not picked'))

// --- a note can carry as many reactions as you like --------------------------
ok('found phrase for the emoji pile', await selectPhrase('good code review comment'))
await new Promise((r) => setTimeout(r, 150))
for (const e of ['👍', '❤️', '🔥', '🤔', '🎯', '😄']) {
  await click(`.mg-compose .mg-emojibar button[data-e="${e}"]`)
}
ok('all six stay visible in the bar', await page.evaluate(() =>
  ['👍', '❤️', '🔥', '🤔', '🎯', '😄'].every((e) =>
    document.querySelector(`.mg-compose .mg-emojibar button[data-e="${e}"]`)?.classList.contains('selected'))))
ok('the bar wrapped instead of hiding any', await page.evaluate(() => {
  const bar = document.querySelector('.mg-compose .mg-emojibar')
  return [...bar.querySelectorAll('button')].every((b) => b.offsetWidth > 0 && b.offsetHeight > 0)
}))
await click('.mg-compose [data-act="save"]')
await new Promise((r) => setTimeout(r, 300))
const pileMd = await page.evaluate(() => window.__marginer.markdown())
ok('all six are stored at the head of the note', /> good code review comment\n\n👍❤️🔥🤔🎯😄/u.test(pileMd))
ok('and all six show in the margin cluster', await page.evaluate(() =>
  [...document.querySelectorAll('.mg-emote-stack')].some((s) => s.children.length === 6)))
// reaction-only, so no card: open it from its highlight and delete it there
const pileHl = await page.evaluate(() => {
  const b = window.__marginer.blocks.find((x) => x.quotes[0] === 'good code review comment')
  b.ranges[0].startContainer.parentElement.scrollIntoView({ block: 'center' })
  const r = [...b.ranges[0].getClientRects()].find((r) => r.width)
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})
ok('a reaction-only note shows no card', await page.evaluate(() => ![...document.querySelectorAll('.mg-beside .mg-card')].some((c) => c.textContent.includes('good code review'))))
await page.mouse.click(pileHl.x, pileHl.y)
await new Promise((r) => setTimeout(r, 250))
ok('...until its highlight is clicked', await page.evaluate(() => document.querySelector('.mg-beside .mg-card.focused')?.textContent.includes('good code review')))
await click('.mg-beside .mg-card.focused .mg-cardx')
await new Promise((r) => setTimeout(r, 300))

// --- cards are not squashed by the flex column -------------------------------
ok('every card renders at its natural height', await page.evaluate(() => {
  // (the reactions deliberately hang off the bottom edge, so measure the rest)
  const cards = [...document.querySelectorAll('.mg-card')]
  return cards.length > 0 && cards.every((c) => [...c.children].filter((el) => !el.classList.contains('mg-card-emoji'))
    .every((el) => el.getBoundingClientRect().bottom <= c.getBoundingClientRect().bottom + 1))
}))
ok('reactions hang off the bottom edge of the card', await page.evaluate(() => {
  const c = document.querySelector('.mg-card'), e = c.querySelector('.mg-card-emoji')
  return !!e && e.getBoundingClientRect().bottom > c.getBoundingClientRect().bottom && parseFloat(getComputedStyle(e).fontSize) <= 13
}))

// --- the searchable grid behind "＋" ----------------------------------------
ok('found phrase 3', await selectPhrase('Coleridge'))
await new Promise((r) => setTimeout(r, 120))
await click('.mg-compose .mg-emoji-more')
ok('emoji grid opens', await page.$('.mg-compose .mg-emojigrid button') !== null)
ok('the grid renders a full page of the set', (await page.$$('.mg-compose .mg-emojigrid button')).length >= 400)
ok('and says how many more there are', await page.$eval('.mg-emojinote', (e) => !e.hidden && /more/.test(e.textContent)))

const searchFor = async (q) => {
  await page.$eval('.mg-compose .mg-emoji-search', (e, q) => {
    e.value = q; e.dispatchEvent(new Event('input', { bubbles: true }))
  }, q)
  await new Promise((r) => setTimeout(r, 120))
  return page.$$eval('.mg-compose .mg-emojigrid button', (bs) => bs.map((b) => b.dataset.e))
}
// Three things the old 60-emoji list could not do.
ok('search finds an ordinary object', (await searchFor('burrito')).includes('🌯'))
ok('country flags are in there', (await searchFor('flag: japan')).includes('🇯🇵'))
ok('so are ZWJ sequences', (await searchFor('shrug')).some((e) => e === '🤷\u200d♀️'))
ok('and the emojilib keywords still work', (await searchFor('lol')).includes('🤣'))

await searchFor('bookmark')
await click('.mg-compose .mg-emojigrid button[data-e="🔖"]')
await click('.mg-compose [data-act="save"]')
await new Promise((r) => setTimeout(r, 200))
ok('grid pick lands on the note', (await page.evaluate(() => window.__marginer.markdown())).includes('🔖'))
// take it back out so the rest of the assertions see the original two notes
// (reaction-only, so: open it from its highlight, then ✕)
const bmHl = await page.evaluate(() => {
  const b = window.__marginer.blocks.find((x) => x.note.includes('🔖'))
  b.ranges[0].startContainer.parentElement.scrollIntoView({ block: 'center' })
  const r = [...b.ranges[0].getClientRects()].find((r) => r.width)
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})
await page.mouse.click(bmHl.x, bmHl.y)
await new Promise((r) => setTimeout(r, 250))
await click('.mg-beside .mg-card.focused .mg-cardx')
await new Promise((r) => setTimeout(r, 250))
ok('deleting a card removes it', await notes() === 2)

// --- markdown export --------------------------------------------------------
const md = await page.evaluate(() => window.__marginer.markdown())
console.log('\n--- exported markdown ---\n' + md + '-------------------------\n')
ok('export carries no title line, just the blocks', md.startsWith('> '))
ok('export quotes phrase 1', md.includes('> argument in miniature'))
ok('export carries the note', md.includes('🔥 This is the whole thesis.'))
ok('export quotes phrase 2', md.includes('> Markdown travels'))
ok('emoji-only note exports', /> Markdown travels\n\n👍/.test(md))
ok('cards are in document order', md.indexOf('argument in miniature') < md.indexOf('Markdown travels'))

// --- a quote that spans a line break in the HTML source ----------------------
// The stored quote is one flat markdown line; the page wraps where its markup
// wraps. These have to still find each other after a reload.
ok('found a phrase that wraps in the source', await selectPhrase('good code review comment'))
await new Promise((r) => setTimeout(r, 150))
await type('.mg-compose textarea', 'spans a line break')
await click('.mg-compose [data-act="save"]')
await new Promise((r) => setTimeout(r, 300))
const wrapCount = await notes()
ok('it anchors when made', await page.evaluate(() => CSS.highlights.get('marginer')?.size) === wrapCount)
await page.reload({ waitUntil: 'load' })
await page.evaluate(bundle)
await new Promise((r) => setTimeout(r, 400))
ok('notes show on the page straight after a reload', await page.evaluate(() => !!document.querySelector('.mg-beside .mg-card')))
ok('and re-anchors after a reload', await page.evaluate(() => CSS.highlights.get('marginer')?.size) === wrapCount)
const wrapAt = await page.evaluate(() =>
  [...document.querySelectorAll('.mg-beside .mg-card')].findIndex((c) => c.textContent.includes('spans a line break')) + 1)
ok('its card is not orphaned', await page.$eval(`.mg-beside .mg-card:nth-child(${wrapAt})`, (c) => !c.classList.contains('orphan')))
await click(`.mg-beside .mg-card:nth-child(${wrapAt}) .mg-cardx`)
await new Promise((r) => setTimeout(r, 300))

// --- persistence: reload and re-anchor from the stored markdown -------------
await page.reload({ waitUntil: 'load' })
await page.evaluate(bundle)
await new Promise((r) => setTimeout(r, 300))
ok('notes survive a reload', await notes() === 2)
ok('re-anchored to live text', await page.evaluate(() => CSS.highlights.get('marginer')?.size === 2))
const md2 = await page.evaluate(() => window.__marginer.markdown())
ok('markdown round-trips unchanged', md2 === md, JSON.stringify(md2.slice(0, 120)))

// --- image annotation -------------------------------------------------------
await page.evaluate(() => {
  const img = document.querySelector('img')
  const r = document.createRange(); r.selectNode(img)
  const s = getSelection(); s.removeAllRanges(); s.addRange(r)
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
})
await new Promise((r) => setTimeout(r, 150))
if (await page.$('.mg-compose')) {
    await new Promise((r) => setTimeout(r, 120))
  await type('.mg-compose textarea', 'Nice figure.')
  await click('.mg-compose [data-act="save"]')
  await new Promise((r) => setTimeout(r, 200))
  ok('image overlay box drawn', (await page.$$('.mg-imghl')).length >= 1)
  ok('image exports as a markdown embed', (await page.evaluate(() => window.__marginer.markdown())).includes('!['))
} else {
  ok('image selection offers a note', false, 'selecting an image opened no panel')
}

// --- alt-click an image ------------------------------------------------------
await page.evaluate(() => { getSelection().removeAllRanges(); window.__marginer.markdown() })
const imgBox = await (await page.$('img')).boundingBox()
await page.keyboard.down('Alt')
await page.mouse.click(imgBox.x + imgBox.width / 2, imgBox.y + imgBox.height / 2)
await page.keyboard.up('Alt')
await new Promise((r) => setTimeout(r, 200))
ok('⌥-click on an image opens compose', await page.$('.mg-compose') !== null)
await page.keyboard.press('Escape')
await new Promise((r) => setTimeout(r, 150))

// --- toggle off / on --------------------------------------------------------
await page.evaluate(bundle) // second injection = collapse
await new Promise((r) => setTimeout(r, 120))
ok('re-injecting collapses to the pill', await page.$('.mg-fab') !== null && await page.evaluate(() => !window.__marginer.open))
ok('collapsed, the notes leave the page', await page.$eval('.mg-beside:not(.mg-peek)', (e) => e.style.display === 'none'))

// --- collapsed: hover peeks a note, click opens the pane on it ---------------
const peekAt = await page.evaluate(() => {
  const b = window.__marginer.blocks.find((x) => x.ranges.length && x.text.trim())
  b.ranges[0].startContainer.parentElement.scrollIntoView({ block: 'center' })
  const r = [...b.ranges[0].getClientRects()].find((r) => r.width)
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, note: b.note, id: b.id }
})
await page.mouse.move(peekAt.x, peekAt.y)
await new Promise((r) => setTimeout(r, 200))
ok('hovering a highlight peeks its note', await page.evaluate((n) => document.querySelector('.mg-peek .mg-card')?.textContent.includes(n.replace(/^\p{Extended_Pictographic}+\s*/u, '')), peekAt.note))
await page.mouse.move(peekAt.x, peekAt.y - 200)
await new Promise((r) => setTimeout(r, 200))
ok('...and it goes when the mouse leaves', await page.$('.mg-peek .mg-card') === null)
await page.mouse.click(peekAt.x, peekAt.y)
await new Promise((r) => setTimeout(r, 300))
ok('clicking a highlight while collapsed brings view mode back with that note open', await page.evaluate((p) => {
  const c = document.querySelector('.mg-beside:not(.mg-peek) .mg-card.focused')
  return window.__marginer.open && document.querySelector('.mg-sidebar').style.display === 'none' && c?.dataset.blockId === p.id && !!c.querySelector('textarea')
}, peekAt))
await page.keyboard.press('Escape')
await new Promise((r) => setTimeout(r, 200))

// --- deleting from a card, and taking it back --------------------------------
ok('no delete-everything button in the header', await page.$('.mg-sidebar [data-act="clear"]') === null)
ok('open cards carry no Delete/Done row', await page.$('.mg-cardfoot') === null)
const n1 = await notes()
ok('there are notes to delete', n1 > 0)
await click('.mg-card .mg-cardx')     // the ✕ on an unopened card
ok('the card is gone', await notes() === n1 - 1)
ok('an undo is offered', await page.$('.mg-toast-act') !== null)
await click('.mg-toast-act')
await new Promise((r) => setTimeout(r, 250))
ok('undo brings the note back', await notes() === n1)
ok('...with its highlight', await page.evaluate(() => CSS.highlights.get('marginer')?.size) === n1)

// --- a click on a highlight reopens its note ---------------------------------
await page.keyboard.press('Escape')
await new Promise((r) => setTimeout(r, 150))
const hl = await page.evaluate(() => {
  const range = window.__marginer.blocks.find((b) => b.ranges.length).ranges[0]
  range.startContainer.parentElement.scrollIntoView({ block: 'center' })
  const r = [...range.getClientRects()].find((r) => r.width) // the first rect can be a zero-width one
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})
await page.mouse.click(hl.x, hl.y)
await new Promise((r) => setTimeout(r, 250))
ok('clicking a highlight opens its card for editing', await page.$('.mg-card.focused textarea') !== null)
ok('...pinned level with the highlight', await page.evaluate(() => {
  const c = document.querySelector('.mg-card.focused')
  const b = window.__marginer.blocks.find((x) => x.id === c.dataset.blockId)
  const line = [...b.ranges[0].getClientRects()].find((r) => r.width)
  return Math.abs(c.getBoundingClientRect().top - line.top) < 8
}))
await page.keyboard.press('Escape')
await new Promise((r) => setTimeout(r, 150))

// --- reaction chips are centered on the line they belong to -------------------
ok('chips sit centered on the whole highlight', await page.evaluate(() => {
  const stacks = [...document.querySelectorAll('.mg-emote-stack')]
  return stacks.length > 0 && stacks.every((s) => {
    const b = window.__marginer.blocks.find((x) => x.id === s.dataset.blockId)
    const rects = [...b.ranges[0].getClientRects()].filter((r) => r.width)
    const top = Math.min(...rects.map((r) => r.top)), bottom = Math.max(...rects.map((r) => r.bottom))
    const r = s.getBoundingClientRect()
    return Math.abs((r.top + r.height / 2) - (top + bottom) / 2) < 3
  })
}))

// --- the text pane: the document, edited as text ------------------------------
await click('.mg-bar [data-act="mode"]')
await new Promise((r) => setTimeout(r, 300))
ok('back to the sidebar', await page.$eval('.mg-sidebar', (e) => e.style.display) === '')
const paneVal = () => page.$eval('.mg-pane', (e) => e.value)
ok('the pane holds the whole document', (await paneVal()).trimEnd() === (await page.evaluate(() => window.__marginer.markdown())).trimEnd())
ok('no cards in the sidebar -- it is one text', await page.$('.mg-sidebar .mg-card') === null)

// a selection lands in the pane as a quote, caret on the reply line
const hlBefore = await page.evaluate(() => CSS.highlights.get('marginer')?.size ?? 0)
ok('found phrase for the pane', await selectPhrase('what you can paste afterwards'))
await new Promise((r) => setTimeout(r, 200))
ok('no popover while the pane is open', await page.$('.mg-compose') === null)
ok('the quote is appended to the document', /> what you can paste afterwards\n\n$/.test(await paneVal()))
ok('the pane has focus, caret on the reply line', await page.evaluate(() => {
  const ta = document.querySelector('.mg-pane')
  return document.activeElement === ta && ta.selectionStart === ta.value.length
}))
ok('the quote is highlighted at once', await page.evaluate(() => CSS.highlights.get('marginer')?.size) === hlBefore + 1)
await page.keyboard.type('typed straight into the pane')
await new Promise((r) => setTimeout(r, 350))
ok('the reply is in the document', (await page.evaluate(() => window.__marginer.markdown())).includes('> what you can paste afterwards\n\ntyped straight into the pane'))
ok('the caret block is the active highlight', await page.evaluate(() => CSS.highlights.get('marginer-active')?.size === 1))

// clicking a highlight moves the caret to its reply
const first = await page.evaluate(() => {
  const range = window.__marginer.blocks[0].ranges[0]
  range.startContainer.parentElement.scrollIntoView({ block: 'center' })
  const r = [...range.getClientRects()].find((r) => r.width)
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, id: window.__marginer.blocks[0].id, note: window.__marginer.blocks[0].note }
})
await page.mouse.click(first.x, first.y)
await new Promise((r) => setTimeout(r, 250))
ok('clicking a highlight puts the caret at the end of its reply', await page.evaluate((first) => {
  const ta = document.querySelector('.mg-pane')
  return document.activeElement === ta && window.__marginer.blockAtCaret()?.id === first.id && ta.value.slice(0, ta.selectionStart).endsWith(first.note)
}, first))
ok('anchored quote lines are tinted behind the text', await page.evaluate(() =>
  document.querySelectorAll('.mg-paneback .mg-q:not(.orphan)').length === window.__marginer.blocks.filter((b) => b.ranges.length).length))
ok('the caret block\'s quote is the active one', await page.evaluate((first) => {
  const a = document.querySelectorAll('.mg-paneback .mg-q.active')
  return a.length === 1 && a[0].dataset.blockId === first.id
}, first))
ok('the textarea never scrolls itself (the wrapper does)', await page.evaluate(() => {
  const ta = document.querySelector('.mg-pane')
  return ta.scrollHeight <= ta.offsetHeight + 1 && getComputedStyle(ta).overflowY === 'hidden'
}))

// editing the text re-anchors: strip a quote's '>' and its highlight goes
const hlN = await page.evaluate(() => CSS.highlights.get('marginer')?.size ?? 0)
await page.$eval('.mg-pane', (ta) => {
  ta.value = ta.value.replace('> what you can paste afterwards', 'what you can paste afterwards')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
})
await new Promise((r) => setTimeout(r, 400))
ok('un-quoting a line removes its highlight', await page.evaluate(() => CSS.highlights.get('marginer')?.size ?? 0) === hlN - 1)
ok('the pane text is kept verbatim', (await paneVal()).includes('\nwhat you can paste afterwards'))
// a quote the page doesn't contain is marked as such, not tinted
await page.$eval('.mg-pane', (ta) => {
  ta.value = ta.value + '\n\n> nothing on this page says this\n'
  ta.dispatchEvent(new Event('input', { bubbles: true }))
})
await new Promise((r) => setTimeout(r, 400))
ok('a quote that is not on the page is not tinted', await page.$$eval('.mg-paneback .mg-q.orphan', (q) => q.length === 1 && q[0].textContent.includes('nothing on this page')))
// typing at the end of a long document keeps the caret in view: the wrapper scrolls
await page.$eval('.mg-pane', (ta) => {
  ta.value = ta.value + '\n\n' + Array.from({ length: 40 }, (_, i) => `filler line ${i}`).join('\n')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length)
})
await page.keyboard.type(' tail')
await new Promise((r) => setTimeout(r, 300))
ok('the pane scrolls to keep the caret in view', await page.evaluate(() => {
  const wrap = document.querySelector('.mg-panewrap')
  // the last line (above the 40px bottom padding) is inside the viewport
  return wrap.scrollTop > 0 && wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 40 - 24
}))
await page.$eval('.mg-pane', (ta) => {
  ta.value = ta.value.replace(/\n\n> nothing on this page says this\n[\s\S]*$/, '\n')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
})
await new Promise((r) => setTimeout(r, 400))

// a quote nobody wrote under is dropped on click-away, like an empty popover
await page.mouse.click(30, 400)
await new Promise((r) => setTimeout(r, 150))
const mdBefore = await page.evaluate(() => window.__marginer.markdown())
ok('found phrase for the throwaway quote', await selectPhrase('output format matters'))
await new Promise((r) => setTimeout(r, 200))
ok('it lands as a quote', (await paneVal()).includes('> output format matters'))
await page.mouse.click(30, 400)
await new Promise((r) => setTimeout(r, 250))
ok('...and leaves no trace when nothing is written under it', await page.evaluate(() => window.__marginer.markdown()) === mdBefore)

// back to view mode to clear the page from the cards
await click('.mg-sidebar [data-act="mode"]')
await new Promise((r) => setTimeout(r, 300))
let nEnd = (await page.$$('.mg-beside .mg-card')).length
for (let i = nEnd; i > 0; i--) { await click('.mg-beside .mg-card .mg-cardx'); await new Promise((r) => setTimeout(r, 120)) }
await new Promise((r) => setTimeout(r, 250))
ok('deleting each card in turn leaves only the reaction-only notes', await page.evaluate(() => window.__marginer.blocks.every((b) => !b.text.trim())))
// those have no card: open one from its highlight and delete it there
while (await notes() > 0) {
  const at = await page.evaluate(() => {
    const b = window.__marginer.blocks[0]
    b.ranges[0].startContainer.parentElement.scrollIntoView({ block: 'center' })
    const r = [...b.ranges[0].getClientRects()].find((r) => r.width)
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await page.mouse.click(at.x, at.y)
  await new Promise((r) => setTimeout(r, 250))
  await click('.mg-beside .mg-card.focused .mg-cardx')
  await new Promise((r) => setTimeout(r, 250))
}
ok('...and a click on the highlight opens each of those to delete', (await page.$$('.mg-card')).length === 0 && await notes() === 0)
ok('highlights removed', await page.evaluate(() => !CSS.highlights.get('marginer')))

// --- a selection across a <br> keeps the line break as a space ----------------
await page.goto('data:text/html;charset=utf-8,' + encodeURIComponent('<article><p>Alone I would <b>quadruple my efforts</b><br>I wondered why no one would take up arms<br>alongside me</p><p>A <span>span</span> inline and <em>em</em> text.</p></article>'), { waitUntil: 'load' })
await page.evaluate(bundle)
await new Promise((r) => setTimeout(r, 200))
await page.evaluate(() => {
  const texts = [...document.querySelector('p').childNodes].filter((n) => n.nodeType === 3)
  const r = document.createRange(); r.setStart(texts[1], 0); r.setEnd(texts[2], texts[2].length)
  const s = getSelection(); s.removeAllRanges(); s.addRange(r)
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
})
await new Promise((r) => setTimeout(r, 200))
await type('.mg-compose textarea', 'x')
await click('.mg-compose [data-act="save"]')
await new Promise((r) => setTimeout(r, 250))
ok('a quote across a <br> keeps the break as a space', (await page.evaluate(() => window.__marginer.markdown())).startsWith('> I wondered why no one would take up arms alongside me'))
await page.evaluate(() => { const p = document.querySelectorAll('p')[1]; const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })) })
await new Promise((r) => setTimeout(r, 200))
ok('inline elements add no breaks', await page.$eval('.mg-compose .mg-quote', (e) => e.textContent) === 'A span inline and em text.')
await page.keyboard.press('Escape')

// --- theme follows the page, not the OS -------------------------------------
ok('light page -> light panel', await page.evaluate(() => document.documentElement.getAttribute('data-mg-theme')) === 'light')
await page.goto('file://' + join(root, 'demo/dark.html'), { waitUntil: 'load' })
await page.evaluate(bundle)
await new Promise((r) => setTimeout(r, 200))
ok('dark page -> dark panel', await page.evaluate(() => document.documentElement.getAttribute('data-mg-theme')) === 'dark')

// --- the bookmarklet build actually runs ------------------------------------
// Clicking a javascript: link is the real install path, so test that, not just
// the bundle: it catches URL-encoding bugs the eval() path would never see.
const bookmarklet = readFileSync(join(root, 'dist/bookmarklet.txt'), 'utf8')
await page.goto('file://' + join(root, 'demo/index.html'), { waitUntil: 'load' })
await page.evaluate((href) => {
  const a = document.createElement('a')
  a.id = 'mg-bm-test'; a.href = href; a.textContent = 'run'
  document.body.appendChild(a)
}, bookmarklet)
await click('#mg-bm-test')
await new Promise((r) => setTimeout(r, 400))
ok('bookmarklet boots from a javascript: link', await page.$('.mg-bar') !== null)
ok('bookmarklet did not navigate away', page.url().endsWith('demo/index.html'))

ok('no page errors', errs.length === 0, errs.join(' | '))

await browser.close()
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nAll checks passed.')
process.exit(fails.length ? 1 : 0)
