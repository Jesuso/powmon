// Render README.md ~ as GitHub shows it, to eyeball layout (esp. image sizing).
import { chromium } from 'playwright-core';
import { marked } from 'marked';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const css = readFileSync(resolve(ROOT, 'dev-tools/node_modules/github-markdown-css/github-markdown-light.css'), 'utf8');
let md = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
md = md.replace(/```mermaid[\s\S]*?```/g, '\n> _[ mermaid diagram renders here on GitHub ]_\n');
const body = marked.parse(md);

const html = `<!doctype html><html><head><meta charset="utf8">
<base href="file://${ROOT}/">
<style>${css}
  body{margin:0;background:#fff}
  .markdown-body{box-sizing:border-box;max-width:830px;margin:0 auto;padding:32px 16px}
</style></head>
<body><article class="markdown-body">${body}</article></body></html>`;

const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await b.newContext({ viewport: { width: 900, height: 1400 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
// Write into repo root and load via file:// so relative img paths resolve with
// a file origin (setContent blocks file:// subresources).
const tmp = resolve(ROOT, '_preview.html');
writeFileSync(tmp, html);
await p.goto(`file://${tmp}`, { waitUntil: 'load' });
await p.waitForTimeout(1500);
const OUT = resolve(ROOT, 'dev-tools');
// audit every image: natural size, rendered size, aspect
const audit = await p.$$eval('img', (imgs) => imgs.map((i) => ({
  src: i.getAttribute('src'),
  nat: `${i.naturalWidth}x${i.naturalHeight}`,
  shown: `${Math.round(i.getBoundingClientRect().width)}x${Math.round(i.getBoundingClientRect().height)}`,
  aspect: i.naturalWidth ? (i.naturalWidth / i.naturalHeight).toFixed(2) : 'BROKEN',
})));
console.log(JSON.stringify(audit, null, 2));
// gallery = the screenshots table (2nd table; 1st is the component table)
const tables = p.locator('table');
const gallery = tables.nth((await tables.count()) > 1 ? 1 : 0);
await gallery.screenshot({ path: `${OUT}/_preview-gallery.png` });
const heroImg = p.locator('img[alt*="PowMon dashboard"]').first();
if (await heroImg.count()) await heroImg.screenshot({ path: `${OUT}/_preview-hero.png` });
console.log('rendered');
await b.close();
unlinkSync(tmp);
