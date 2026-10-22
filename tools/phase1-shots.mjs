// Serves app/ locally and screenshots each Phase 1 feature at iPhone size (390x844 @3x).
// Usage: node tools/phase1-shots.mjs   -> design/screenshots/phase1/*.png
import { createRequire } from 'module';
import { createServer } from 'http';
import { readFile, mkdir } from 'fs/promises';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appDir = join(root, 'app');
const out = join(root, 'design', 'screenshots', 'phase1');
await mkdir(out, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  try { res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(await readFile(join(appDir, p))); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: 'dark', timezoneId: 'America/Chicago', serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const shot = async (name, opts = {}) => { await page.waitForTimeout(350); await page.screenshot({ path: join(out, `${name}.png`), ...opts }); console.log('shot', name); };
const center = async (sel) => { const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded(); await page.waitForTimeout(150); const b = await l.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

// 1. First launch: setup screen
await page.goto(base);
await shot('1-first-launch-setup');

// 2. Main view with demo data
await page.goto(base + '?demo');
await page.waitForSelector('.item');
await shot('2-main');
await shot('2-main-full', { fullPage: true });

// 3. Junk expanded
await page.click('button.sh[data-sec="junk"]');
await page.locator('section.junk').scrollIntoViewIfNeeded();
await shot('3-junk-expanded');
await page.click('button.sh[data-sec="junk"]');
await page.evaluate(() => window.scrollTo(0, 0));

// 4. Swipe in progress
let c = await center('section.action .item >> nth=2');
await page.mouse.move(c.x, c.y); await page.mouse.down();
for (let i = 1; i <= 8; i++) await page.mouse.move(c.x - i * 18, c.y);
await shot('4-swipe-in-progress');
await page.mouse.up(); // past 30% -> hidden
await page.waitForTimeout(400);
await shot('5-hidden-undo-toast');
await page.click('#toast-undo'); // bring it back
await page.waitForTimeout(300);

// 6. Long-press
c = await center('section.important .item >> nth=0');
await page.mouse.move(c.x, c.y); await page.mouse.down();
await page.waitForTimeout(300);
await shot('6-long-press-holding');
await page.waitForTimeout(400); await page.mouse.up();
await page.waitForTimeout(400);
await page.click('#toast-undo');
await page.waitForTimeout(2500); // let toast leave

// 7. Tap a no-deadline card -> clearing (fades after 10 s)
c = await center('section.action .item:has-text("Mom")');
await page.mouse.click(c.x, c.y);
await page.waitForSelector('#reader:not([hidden]) .msg');
await page.waitForTimeout(600);
await page.click('#reader-back'); // closing the reader starts the 10 s fade
await page.waitForTimeout(3000);
await page.locator('section.action .item:has-text("Mom")').scrollIntoViewIfNeeded();
await shot('7-tapped-clearing');
await page.waitForTimeout(8000);
await shot('8-cleared-undo-toast');

// 9. Settings
await page.evaluate(() => window.scrollTo(0, 0));
await page.click('#settings-btn');
await page.fill('#f-url', 'https://script.google.com/macros/s/AKfy…/exec');
await page.fill('#f-token', 'example-token');
await shot('9-settings');

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();
server.close();
