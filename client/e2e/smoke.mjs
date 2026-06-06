// Playwright E2E: two browser contexts (two identities) join the same meeting
// and we verify live video frames flow BETWEEN them through SpacetimeDB.
import { chromium } from 'playwright';

const URL = 'http://localhost:5173/';
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const log = (...a) => console.log('[e2e]', ...a);
const errors = [];
const shot = (p, n) => p.screenshot({ path: `e2e/${n}.png` });

async function newClient(label) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`${label}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  await page.goto(URL, { waitUntil: 'networkidle' });
  return page;
}

// Count remote tiles that have actually received a JPEG frame (blob: src, visible).
async function framesReceived(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('img.tile-media')].filter(
      (img) => img.src.startsWith('blob:') && getComputedStyle(img).opacity === '1'
    ).length
  );
}

try {
  const A = await newClient('A');
  await A.waitForTimeout(2500);
  await shot(A, '01-prejoin');
  await A.fill('input', 'Alice');
  await A.click('button:has-text("Create & join")');
  await A.waitForTimeout(2000);
  await shot(A, '02-A-meeting-solo');
  const aTiles = await A.locator('.tile').count();
  log('A in meeting, tiles:', aTiles);

  const B = await newClient('B');
  await B.waitForTimeout(2500);
  await B.fill('input', 'Bob');
  const joinBtn = B.locator('button:text-is("Join")').first();
  await joinBtn.waitFor({ timeout: 5000 });
  await joinBtn.click();
  await B.waitForTimeout(1500);

  // Let frames relay through the DB.
  await A.waitForTimeout(4000);
  await shot(A, '03-A-sees-Bob');
  await shot(B, '04-B-sees-Alice');

  const aTiles2 = await A.locator('.tile').count();
  const bTiles = await B.locator('.tile').count();
  const aFrames = await framesReceived(A); // A receiving Bob's video
  const bFrames = await framesReceived(B); // B receiving Alice's video

  log('---- RESULT ----');
  log('A tiles (expect 2):', aTiles2);
  log('B tiles (expect 2):', bTiles);
  log('A receiving remote video frames:', aFrames, aFrames >= 1 ? 'PASS' : 'FAIL');
  log('B receiving remote video frames:', bFrames, bFrames >= 1 ? 'PASS' : 'FAIL');
  log('console errors:', errors.length);
  errors.slice(0, 8).forEach((e) => log('  ERR', e));
} catch (e) {
  log('EXCEPTION', e.message);
  errors.push(String(e));
} finally {
  await browser.close();
}
