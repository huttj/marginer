import esbuild from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'

const watch = process.argv.includes('--watch')
const { version, description } = JSON.parse(readFileSync('package.json', 'utf8'))
mkdirSync('dist', { recursive: true })

// `@grant none` puts the script in the PAGE's context, which is the point: it then
// shares localStorage with the bookmarklet, so notes taken with either are visible
// to the other. @noframes keeps it out of ad iframes.
const USERSCRIPT_HEADER = `// ==UserScript==
// @name         Marginer
// @namespace    https://github.com/marginer
// @version      ${version}
// @description  ${description}
// @author       you
// @match        *://*/*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==
`

const common = {
  bundle: true,
  format: 'iife',
  target: 'es2021',
  sourcemap: watch,
  minify: !watch,
  legalComments: 'none',
  logLevel: 'info',
}

const kb = (n) => (n / 1024).toFixed(1) + ' KB'

// 1. The on-demand bundle: shared by the extension and the bookmarklet.
const core = {
  ...common,
  entryPoints: ['src/main.ts'],
  outfile: 'dist/marginer.js',
  plugins: [{
    name: 'shells',
    setup(build) {
      build.onEnd((r) => {
        if (r.errors.length) return
        const js = readFileSync('dist/marginer.js', 'utf8')
        // The extension loads the bundle as a file, so it just needs a copy.
        copyFileSync('dist/marginer.js', 'extension/marginer.js')
        // The bookmarklet has to carry the whole thing inline: a loader that
        // fetches remote script is blocked by CSP on most interesting sites.
        // Wrapped in a void IIFE so the href never replaces the document.
        const bm = 'javascript:' + encodeURIComponent(`(function(){${js}})();void 0`)
        writeFileSync('dist/bookmarklet.txt', bm)
        // dist/ doubles as the website: this page is its front door.
        writeFileSync('dist/index.html', installPage(bm))
        console.log(`→ extension/marginer.js    ${kb(js.length)}`)
        console.log(`→ dist/bookmarklet.txt     ${kb(bm.length)}`)
        console.log(`→ dist/index.html          install page`)
      })
    },
  }],
}

// 2. The userscript: same modules, a shell that stays dormant until a page it
//    knows about shows up.
const userscript = {
  ...common,
  entryPoints: ['src/userscript.ts'],
  outfile: 'dist/marginer.user.js',
  banner: { js: USERSCRIPT_HEADER },
  plugins: [{
    name: 'report',
    setup(build) {
      build.onEnd((r) => {
        if (r.errors.length) return
        console.log(`→ dist/marginer.user.js    ${kb(readFileSync('dist/marginer.user.js', 'utf8').length)}`)
      })
    },
  }],
}

const installPage = (bm) => `<!doctype html>
<meta charset="utf-8"><title>Marginer — install</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         max-width: 46rem; margin: 3.5rem auto; padding: 0 1.5rem; }
  h1 { font-size: 1.6rem; margin-bottom: .25rem; }
  h2 { font-size: 1.1rem; margin: 2.4rem 0 .4rem; }
  p.sub { color: #6b7280; margin-top: 0; }
  a.bm { display: inline-block; background: #b9770a; color: #fff; text-decoration: none;
         font-weight: 700; padding: .7rem 1.3rem; border-radius: .6rem; cursor: grab; }
  ol { padding-left: 1.2rem; } li { margin: .4rem 0; }
  code { background: rgba(128,128,128,.18); padding: .1rem .35rem; border-radius: .25rem; }
  table { border-collapse: collapse; margin-top: .8rem; font-size: .93rem; }
  td, th { border: 1px solid rgba(128,128,128,.3); padding: .4rem .7rem; text-align: left; }
</style>
<h1>Marginer</h1>
<p class="sub">Highlight any page, add notes and emoji, export as markdown.</p>

<h2>Bookmarklet</h2>
<ol>
  <li>Show your bookmarks bar (<code>⌘⇧B</code> / <code>Ctrl+Shift+B</code>).</li>
  <li>Drag this button onto it: <a class="bm" href="${bm.replace(/"/g, '&quot;')}">✍️ Marginer</a></li>
  <li>Open any page and click the bookmark. Click it again to collapse.</li>
</ol>

<h2>Userscript — adds the "this page has notes" indicator</h2>
<p>A bookmarklet can't tell you a page is already annotated: nothing of it runs
until you click it. With <a href="https://www.tampermonkey.net/">Tampermonkey</a>
or Violentmonkey installed, <a class="bm" href="marginer.user.js">Install the userscript</a>
and revisiting an annotated page brings your highlights back on its own, with a
small pill in the corner showing the count. Press <code>⌘⇧U</code> /
<code>Ctrl+Shift+U</code> to open it anywhere else.</p>
<p>It reads the same storage as the bookmarklet, so you can install both.</p>

<h2>Which one?</h2>
<table>
  <tr><th></th><th>Bookmarklet</th><th>Userscript</th><th>Extension</th></tr>
  <tr><td>Install</td><td>drag a link</td><td>needs Tampermonkey</td><td>load unpacked</td></tr>
  <tr><td>Shows a page has notes</td><td>no</td><td>yes</td><td>on click</td></tr>
  <tr><td>Works on strict-CSP sites</td><td>often not</td><td>yes</td><td>yes</td></tr>
  <tr><td>Notes stored in</td><td>site localStorage</td><td>site localStorage</td><td>chrome.storage</td></tr>
</table>
<p style="color:#6b7280">Notes are keyed by URL and never leave your browser.</p>
`

if (watch) {
  for (const opts of [core, userscript]) { const ctx = await esbuild.context(opts); await ctx.watch() }
  console.log('watching…')
} else {
  for (const opts of [core, userscript]) await esbuild.build(opts)
}
