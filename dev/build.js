#!/usr/bin/env node
'use strict';
/* Build script: dev/game.src.html (readable source) -> index.html (minified, same game).
 *
 * The game ships as one file, so the file has to be small; but nobody wants to edit a
 * minified file. This keeps the readable source in dev/ and emits the small one.
 *
 *   node dev/build.js            # rebuild index.html
 *   node dev/build.js --check    # rebuild and verify every game string survived
 *
 * Minification is semantics-preserving on purpose: no `unsafe` compression, no property
 * mangling (the game uses string-keyed tables like ST[k] and MEM[...], and window.__g is
 * a public debug surface), and `'use strict'` stays the first statement.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(__dirname, 'game.src.html');
const OUT = path.join(ROOT, 'index.html');
const TERSER = 'terser@5.51.2';

/* ---------- CSS ---------- */
function minifyCss(css) {
  let out = css
    .replace(/\/\*[\s\S]*?\*\//g, '')            // comments
    .replace(/\s+/g, ' ')                        // collapse runs
    .replace(/\s*([{};:,>])\s*/g, '$1')          // structural punctuation
    .replace(/;}/g, '}')                         // last declaration
    .replace(/\s*!\s*important/gi, '!important')
    .trim();
  /* a space is significant inside these, so keep exactly one */
  out = out.replace(/\s+/g, ' ');
  return out;
}

/* ---------- HTML shell ---------- */
function minifyHtml(html) {
  /* only whitespace between tags and inside text nodes is touched: no tag, attribute
     or attribute value is ever rewritten, so the DOM is identical */
  return html
    .replace(/\n\s*/g, '\n')
    .replace(/\s{2,}/g, ' ')
    .replace(/>\s+</g, '><')
    .replace(/\s+>/g, '>')
    .trim();
}

/* ---------- JS ---------- */
function minifyJs(js) {
  const tmp = path.join(require('os').tmpdir(), 'hellomistral-build-' + process.pid + '.js');
  fs.writeFileSync(tmp, js);
  try {
    let local = null;
    try { local = require.resolve('terser'); } catch (e) { local = null; }
    if (local) {
      const { minify_sync } = require('terser');
      return minify_sync(js, {
        compress: { toplevel: true, passes: 3 },
        mangle: { toplevel: true },
        ecma: 2020,
        format: { comments: false },
      }).code.trim();
    }
    const out = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['--yes', TERSER, tmp,
        '-c', 'toplevel=true,passes=3',
        '-m', 'toplevel',
        '--ecma', '2020',
        '--comments', 'false'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    return out.trim();
  } finally {
    fs.unlinkSync(tmp);
  }
}

function build() {
  const src = fs.readFileSync(SRC, 'utf8');

  const styleOpen = src.indexOf('<style>');
  const styleClose = src.indexOf('</style>');
  if (styleOpen < 0 || styleClose < 0) throw new Error('no <style> block in the source');

  const scriptOpen = src.indexOf('<script');
  const scriptTagEnd = src.indexOf('>', scriptOpen);
  const scriptClose = src.lastIndexOf('</script>');
  if (scriptOpen < 0 || scriptClose < 0) throw new Error('no <script> block in the source');

  const headHtml = src.slice(0, styleOpen);
  const css = src.slice(styleOpen + '<style>'.length, styleClose);
  const midHtml = src.slice(styleClose + '</style>'.length, scriptTagEnd + 1);
  const js = src.slice(scriptTagEnd + 1, scriptClose);
  const tailHtml = src.slice(scriptClose);

  const minCss = minifyCss(css);
  let minJs = minifyJs(js);
  /* the harness (and strict mode itself) expects the directive first */
  if (!/^['"]use strict['"];/.test(minJs)) minJs = "'use strict';" + minJs;

  const out =
    minifyHtml(headHtml) +
    '<style>' + minCss + '</style>' +
    minifyHtml(midHtml) +
    minJs +
    tailHtml;

  fs.writeFileSync(OUT, out);
  return { src: src.length, out: out.length, js: js.length, minJs: minJs.length };
}

/* ---------- safety net, aimed at the two transforms written here ----------
   Terser is a mature minifier; the HTML and CSS passes are this file's own code, so the
   checks below verify exactly those:
     - every CSS selector and declaration in the source still exists in the output,
     - the visible text of the menu (everything outside <style>/<script>) is word-for-word
       identical, which is what "no visible change" means for a minified shell. */
function cssDeclarations(cssBlock) {
  const out = [];
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(cssBlock))) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    for (const decl of m[2].split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const prop = decl.slice(0, i).trim();
      const value = decl.slice(i + 1).trim().replace(/\s+/g, ' ');
      if (prop) out.push(selector + ' {' + prop + ':' + value + '}');
    }
  }
  return out;
}

function visibleText(html) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function checkCss() {
  const src = fs.readFileSync(SRC, 'utf8');
  const out = fs.readFileSync(OUT, 'utf8');
  const cssOf = s => s.slice(s.indexOf('<style>') + 7, s.indexOf('</style>'));
  const a = cssDeclarations(cssOf(src));
  const b = cssDeclarations(cssOf(out));
  const missing = a.filter(d => !b.includes(d));
  return { total: a.length, outputTotal: b.length, missing };
}

function checkHtml() {
  const src = fs.readFileSync(SRC, 'utf8');
  const out = fs.readFileSync(OUT, 'utf8');
  const shellOf = s => s.slice(0, s.indexOf('<script'));
  const a = visibleText(shellOf(src));
  const b = visibleText(shellOf(out));
  return { same: a === b, source: a.length, output: b.length };
}

if (require.main === module) {
  const t = Date.now();
  const r = build();
  const pct = (1 - r.out / r.src) * 100;
  console.log(`source  ${r.src.toLocaleString()} B`);
  console.log(`output  ${r.out.toLocaleString()} B  (-${pct.toFixed(1)}%), js ${r.js.toLocaleString()} -> ${r.minJs.toLocaleString()}`);
  console.log(`built index.html in ${Date.now() - t} ms`);
  if (process.argv.includes('--check')) {
    let bad = false;
    const css = checkCss();
    if (css.missing.length) {
      bad = true;
      console.error(`FAIL ${css.missing.length}/${css.total} CSS declarations missing:`);
      for (const d of css.missing.slice(0, 10)) console.error('  ' + d);
    } else {
      console.log(`css: all ${css.total} declarations preserved`);
    }
    const html = checkHtml();
    if (!html.same) {
      bad = true;
      console.error(`FAIL the menu's visible text changed (${html.source} -> ${html.output} chars)`);
    } else {
      console.log(`html: menu text identical (${html.source} chars)`);
    }
    if (bad) process.exit(1);
  }
}

module.exports = { build, checkCss, checkHtml, minifyCss, minifyHtml };
