// Composite a screenshot onto a uniform 1280×800 (16:10) canvas with a soft
// backdrop, rounded corners, and a shadow — so the README gallery is an even
// grid regardless of each shot's native aspect ratio. Overwrites in place.
//
//   node frame.mjs            # frames the 4 gallery images in ../docs/img
//   import { frameImage }     # used by shots.mjs as a final step
import { chromium } from 'playwright-core';
import { writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';

const CHROME = process.env.CHROME_BIN || '/usr/bin/google-chrome';
export const GALLERY = ['money', 'battery', 'compare', 'mobile-dark-es'];

export async function frameImage(browser, file) {
  const dir = dirname(file);
  const html = `<!doctype html><html><body style="margin:0">
    <div style="width:1280px;height:800px;display:flex;align-items:center;justify-content:center;
        background:linear-gradient(155deg,#f4f6f9 0%,#e6eaf1 100%)">
      <img src="${basename(file)}" style="max-width:90%;max-height:86%;object-fit:contain;
        border-radius:16px;box-shadow:0 12px 34px rgba(15,23,42,.20)">
    </div></body></html>`;
  const tmpHtml = resolve(dir, '_frame.html');
  const tmpPng = `${file}.tmp.png`;
  writeFileSync(tmpHtml, html);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const pg = await ctx.newPage();
  await pg.goto(`file://${tmpHtml}`, { waitUntil: 'load' });
  await pg.waitForTimeout(250);
  await pg.screenshot({ path: tmpPng });
  await ctx.close();
  unlinkSync(tmpHtml);
  renameSync(tmpPng, file); // overwrite original with the framed version
}

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const OUT = resolve(__dirname, '../docs/img');
  const browser = await chromium.launch({ executablePath: CHROME });
  for (const name of GALLERY) {
    await frameImage(browser, resolve(OUT, `${name}.png`));
    console.log('✓ framed', name);
  }
  await browser.close();
  console.log('done');
}

// run directly (not when imported)
if (process.argv[1] && process.argv[1].endsWith('frame.mjs')) await main();
