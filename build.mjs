import esbuild from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs'

const watch = process.argv.includes('--watch')
const { version, description } = JSON.parse(readFileSync('package.json', 'utf8'))
mkdirSync('dist', { recursive: true })

// `@grant none` puts the script in the PAGE's context, which is the point: it then
// shares localStorage with the bookmarklet, so notes taken with either are visible
// to the other. @noframes keeps it out of ad iframes.
const USERSCRIPT_HEADER = `// ==UserScript==
// @name         Marginer
// @namespace    https://marginer.app
// @version      ${version}
// @description  ${description}
// @author       Joshua Hutt
// @homepageURL  https://marginer.app
// @updateURL    https://marginer.app/marginer.user.js
// @downloadURL  https://marginer.app/marginer.user.js
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
        // dist/ doubles as the website (marginer.app): site/ is its front door,
        // with the bookmarklet's href filled in, plus its images.
        const page = readFileSync('site/index.html', 'utf8').replaceAll('__BM__', bm.replace(/&/g, '&amp;').replace(/"/g, '&quot;'))
        writeFileSync('dist/index.html', page)
        for (const f of readdirSync('site')) if (f !== 'index.html') copyFileSync(`site/${f}`, `dist/${f}`)
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


if (watch) {
  for (const opts of [core, userscript]) { const ctx = await esbuild.context(opts); await ctx.watch() }
  console.log('watching…')
} else {
  for (const opts of [core, userscript]) await esbuild.build(opts)
}
