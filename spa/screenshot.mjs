#!/usr/bin/env node
import { chromium } from 'playwright';

const SERVER = 'http://localhost:8765';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

page.on('pageerror', err => console.error('PAGE ERROR:', err.message));
page.on('console', msg => { if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text()); });

await page.goto(SERVER + '/index.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.screenshot({ path: 'screenshot_main.png', fullPage: false });
console.log('main shot saved');

const firstRow = await page.locator('#reit-rows tr').first();
if (await firstRow.count()) {
  await firstRow.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'screenshot_drawer.png', fullPage: false });
  console.log('drawer shot saved');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

// Scrolled view (verify sticky headers + Name column + hbar)
await page.evaluate(() => { const s = document.querySelector('#table-scroll'); if (s) s.scrollTop = 200; });
await page.waitForTimeout(300);
await page.screenshot({ path: 'screenshot_scrolled.png', fullPage: false });
console.log('scrolled shot saved');
await page.evaluate(() => { const s = document.querySelector('#table-scroll'); if (s) s.scrollTop = 0; });
await page.waitForTimeout(150);
await page.locator('#help-btn').click();
await page.waitForTimeout(400);
await page.screenshot({ path: 'screenshot_help.png', fullPage: false });
console.log('help shot saved');
await page.keyboard.press('Escape');

// Columns modal
await page.waitForTimeout(200);
await page.locator('#columns-btn').click();
await page.waitForTimeout(300);
await page.screenshot({ path: 'screenshot_columns.png', fullPage: false });
console.log('columns shot saved');
await page.keyboard.press('Escape');

// Mobile viewport
const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const pageM = await ctxM.newPage();
await pageM.goto(SERVER + '/index.html', { waitUntil: 'networkidle' });
await pageM.waitForTimeout(600);
await pageM.screenshot({ path: 'screenshot_mobile.png', fullPage: false });
console.log('mobile shot saved');
await pageM.locator('#rail-toggle').click();
await pageM.waitForTimeout(250);
await pageM.screenshot({ path: 'screenshot_mobile_rail.png', fullPage: false });
console.log('mobile-rail shot saved');

await browser.close();
