// Capture README screenshots of a running PowMon dashboard with system Chrome.
//
//   node shots.mjs [BASE_URL] [OUT_DIR]
//
// Defaults: https://powmon.jesuso.me  ->  ../docs/img
// Uses playwright-core + the system Google Chrome (no bundled browser download).
// SSE-safe: waits on selectors + a settle delay, never networkidle.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { frameImage, GALLERY } from './frame.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'https://powmon.jesuso.me';
const OUT = resolve(__dirname, process.argv[3] || '../docs/img');
const CHROME = process.env.CHROME_BIN || '/usr/bin/google-chrome';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Click a theme button by its icon glyph (☀ light, ☾ dark, ◐ system).
async function setTheme(page, glyph) {
  await page.evaluate((g) => {
    const b = [...document.querySelectorAll('.theme button')].find((x) => x.textContent.includes(g));
    if (b) b.click();
  }, glyph);
  await sleep(400);
}

async function waitReady(page) {
  await page.waitForSelector('.side .group-card', { timeout: 30000 });
  await page.waitForSelector('.charts .card svg', { timeout: 30000 });
  await sleep(3500); // let SSE land + visx draw/animate in
}

// Step the day navigator back one day so charts show a COMPLETE 00–24h day
// (today is only filled up to "now"). The ‹ prev-day button is the first
// .daynav-step (day mode is the default range, so the nav is present).
async function gotoYesterday(page) {
  const prev = page.locator('.daynav-step').first();
  if (await prev.count()) {
    await prev.click();
    await sleep(2800); // history refetch for the past day + redraw
  }
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--hide-scrollbars'] });

  // 1. Hero — wide layout: the left rail appears at ≥1500px (CSS breakpoint is
  //    max-width:1499px), giving "sidebar + 2×2 charts" in one frame.
  const heroCtx = await browser.newContext({
    viewport: { width: 1500, height: 1000 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  });
  const hero = await heroCtx.newPage();
  console.log('loading', BASE);
  await hero.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await waitReady(hero);
  await setTheme(hero, '☀');
  await sleep(500);
  await gotoYesterday(hero); // full-day charts
  await hero.screenshot({ path: `${OUT}/dashboard-light.png` });
  console.log('✓ dashboard-light.png (sidebar + charts @1500)');
  await heroCtx.close();

  // ---- desktop narrow (<1500): stat cards lay out in a row, so money.png gets
  //      Daily + This-Period side by side (wider, gallery-friendly). ----
  const desk = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  });
  const page = await desk.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await waitReady(page);
  await setTheme(page, '☀');
  await sleep(500);

  await gotoYesterday(page); // battery + compare get a full day; money tiles are live (unaffected)

  // 2. Money — clip the first two sidebar cards (daily money rows + period spent/saved)
  const moneyClip = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.side .group-card')].slice(0, 2);
    if (!cards.length) return null;
    const rs = cards.map((c) => c.getBoundingClientRect());
    const x = Math.min(...rs.map((r) => r.left));
    const y = Math.min(...rs.map((r) => r.top));
    const right = Math.max(...rs.map((r) => r.right));
    const bottom = Math.max(...rs.map((r) => r.bottom));
    const pad = 10;
    return { x: Math.max(0, x - pad), y: Math.max(0, y - pad), width: right - x + pad * 2, height: bottom - y + pad * 2 };
  });
  if (moneyClip) {
    await page.screenshot({ path: `${OUT}/money.png`, clip: moneyClip });
    console.log('✓ money.png');
  } else {
    console.log('! money clip not found — skipped');
  }

  // 3. Battery chart (3rd visible panel: power, energy, battery, temps) + its setpoint refs
  const battery = page.locator('.charts .card').nth(2);
  await battery.scrollIntoViewIfNeeded();
  await sleep(600);
  await battery.screenshot({ path: `${OUT}/battery.png` });
  console.log('✓ battery.png');

  // 4. Compare — toggle today-vs-yesterday overlay, shoot the chart column
  const cmp = page.locator('.daynav-cmp');
  if (await cmp.count()) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await cmp.first().click();
    await sleep(2500); // second-day fetch + redraw
    await page.locator('.maincol').screenshot({ path: `${OUT}/compare.png` });
    console.log('✓ compare.png');
  } else {
    console.log('! compare button not found — skipped');
  }
  await desk.close();

  // ---- mobile (dark, Spanish) ----
  const mob = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    colorScheme: 'dark',
  });
  const mpage = await mob.newPage();
  await mpage.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await mpage.waitForSelector('.side .group-card', { timeout: 30000 });
  await sleep(2500);
  await setTheme(mpage, '☾');
  await mpage.selectOption('.langsel', 'es').catch(() => {});
  await sleep(1200);
  await mpage.screenshot({ path: `${OUT}/mobile-dark-es.png` });
  console.log('✓ mobile-dark-es.png');
  await mob.close();

  // Frame the gallery shots onto a uniform 16:10 canvas so the README grid is
  // even (the hero stays full-bleed). See frame.mjs.
  for (const name of GALLERY) {
    await frameImage(browser, `${OUT}/${name}.png`);
    console.log('▢ framed', name);
  }

  await browser.close();
  console.log('done ->', OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
