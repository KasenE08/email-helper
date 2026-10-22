// END-TO-END: the real app (Chromium, iPhone size) talking to a local fake "Apps Script"
// that runs the real bundled backend over HTTP, on a different origin (like Google's).
// Checks the whole flow + error states and saves screenshots to design/screenshots/phase3/.
// Usage: node tools/e2e.mjs   (exits 1 on failure)
import { createRequire } from 'module';
import { createServer } from 'http';
import { readFile, mkdir } from 'fs/promises';
import { spawnSync } from 'child_process';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { createFakeScript } from '../tests/fake-apps-script.mjs';

if (process.env.TZ !== 'America/Chicago') {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { stdio: 'inherit', env: { ...process.env, TZ: 'America/Chicago' } });
  process.exit(r.status ?? 1);
}

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'design', 'screenshots', 'phase3');
await mkdir(out, { recursive: true });
let failures = 0;
const check = (ok, msg) => { console.log((ok ? '✓ ' : '✗ ') + msg); if (!ok) failures++; };

// ---------- fake Apps Script over HTTP ----------
const fake = createFakeScript({ chunkSeconds: 8 });
fake.ctx.setup();
const TOKEN = fake.props.get('TOKEN');
const TEST_NOW = fake.ctx.TEST_NOW;
let mode = 'normal'; // normal | html | slow
const log = [];
const scriptServer = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const params = Object.fromEntries(url.searchParams);
  log.push(params.action);
  if (mode === 'html') { res.writeHead(200, { 'content-type': 'text/html', 'access-control-allow-origin': '*' }); res.end('<html><body>Sign in - Google Accounts</body></html>'); return; }
  if (mode === 'slow') await new Promise((r) => setTimeout(r, 4000));
  if (params.action === 'refresh') await new Promise((r) => setTimeout(r, 700)); // feel like Google
  const body = JSON.stringify(fake.call(params));
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(body);
}).listen(0);
const SCRIPT_URL = `http://127.0.0.1:${scriptServer.address().port}/macros/s/FAKE/exec`;

// ---------- the app ----------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const appServer = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  try { res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(await readFile(join(root, 'app', p))); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const APP = `http://localhost:${appServer.address().port}/`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: 'dark', timezoneId: 'America/Chicago', serviceWorkers: 'block', hasTouch: false });
await ctx.addInitScript(() => { window.__EH_TIMEOUT_MS = 2500; });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.clock.setFixedTime(new Date(TEST_NOW));
const shot = async (name, full = false) => { await page.waitForTimeout(300); await page.screenshot({ path: join(out, name + '.png'), fullPage: full }); };
const bannerText = () => page.locator('#banner').innerText();
const center = async (sel) => { const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded(); await page.waitForTimeout(150); const b = await l.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const longPress = async (sel) => { const c = await center(sel); await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up(); await page.waitForTimeout(400); };
const serverState = () => { const r = fake.call({ action: 'refresh', token: TOKEN }); return { ids: r.emails.map((e) => e.id), removed: r.removed.map((x) => x.id) }; };

// 1. First launch -> connect
await page.goto(APP);
check(await page.locator('#settings').isVisible(), 'first launch opens the Connect screen');
await page.fill('#f-url', SCRIPT_URL);
await page.fill('#f-token', 'wrong-token');
await page.click('#test-conn');
await page.waitForSelector('.conn-status.bad');
check((await page.locator('#conn-status').innerText()).includes('Wrong token'), 'Test connection: wrong token is explained');
await shot('1-test-connection-wrong-token');
await page.fill('#f-token', TOKEN);
await page.click('#test-conn');
await page.waitForSelector('.conn-status.ok');
check((await page.locator('#conn-status').innerText()).includes('Connected'), 'Test connection: correct token connects');
await shot('2-test-connection-ok');

// 2. Save -> first run, chunked with progress
await page.click('#settings-done');
await page.waitForFunction(() => document.querySelector('#banner')?.innerText.includes('Processing inbox'), null, { timeout: 15000 });
check(/Processing inbox… \d+\/\d+/.test(await bannerText()), 'first run shows "Processing inbox… x/y"');
await shot('3-first-run-progress');
await page.waitForFunction(() => document.querySelector('#banner').hidden && !document.querySelector('#refresh-btn').classList.contains('spinning'), null, { timeout: 30000 });
const refreshCalls = log.filter((a) => a === 'refresh').length;
check(refreshCalls > 1, `app kept calling until the scan finished (${refreshCalls} refresh calls)`);
check((await page.locator('#refreshed').innerText()).startsWith('Refreshed'), 'shows "Refreshed …" after loading');
check(await page.locator('.item').count() > 10, `cards rendered (${await page.locator('.item').count()})`);
await shot('4-loaded');

// 3. Long-press hide -> stored script-side
await longPress('section.important .item[data-id="s22"]');
check(!(await page.locator('.item[data-id="s22"]').count()), 'long-press hides the card');
await page.waitForTimeout(500);
check(serverState().removed.includes('s22'), 'hide was sent to the script');

// 4. Tap a no-deadline card -> in-app reader with the full email -> close -> fades 10 s later -> "clear" sent
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
await page.evaluate(() => { window.__opened = []; window.__ehOpen = (u) => window.__opened.push(u); });
fake.gmailThreads.get('s05').messages[0]._html = '<p>Grandma wants to know which day.</p><p>Can you check your <a href="https://example.com/schedule?a=1&amp;b=2">work schedule</a>?</p>';
const momSel = 'section.action .item[data-id="s05"]';
let c = await center(momSel);
await page.mouse.click(c.x, c.y);
await page.waitForSelector('#reader:not([hidden]) .msg-body a.btnlink', { timeout: 8000 });
check((await page.locator('#r-body').innerText()).includes('Grandma wants to know which day.'), 'tap opens the in-app reader with the full email');
check(await page.locator('#r-body a.btnlink[href="https://example.com/schedule?a=1&b=2"]').count() === 1, 'links in the email are tappable');
await shot('5-reader');
await page.click('#reader-gmail');
await page.waitForTimeout(900);
check((await page.evaluate(() => navigator.clipboard.readText())) === 'Thanksgiving plans' && (await page.evaluate(() => window.__opened))[0] === 'googlegmail://', '"Open Gmail" copies the subject and opens the Gmail app');
await shot('6-open-gmail-copied');
await page.evaluate(() => { const r = document.querySelector('#reader'); r.scrollTop = r.scrollHeight; });
await page.waitForTimeout(2600); // let the toast leave
await shot('6b-reader-sender-rules');
await page.click('#reader-back');
check(await page.locator(momSel + '.opened').count() === 1 && (await page.locator(momSel).innerText()).includes('Opened'), 'opened card is grayed out with "✓ Opened"');
await page.waitForTimeout(3000);
check(await page.locator(momSel + '.clearing').count() === 1, 'after closing the reader, the card shows the 10-second clearing line');
await shot('7-closed-reader-clearing');
await page.waitForTimeout(8000);
check(!(await page.locator(momSel).count()), 'card gone after ~10 s');
await page.waitForTimeout(300);
check(serverState().removed.includes('s05'), '"clear" was sent to the script');

// Reader "Hide" button
c = await center('section.action .item[data-id="s09"]');
await page.mouse.click(c.x, c.y);
await page.waitForSelector('#reader:not([hidden])');
await page.click('#reader-hide');
await page.waitForTimeout(500);
check(!(await page.locator('.item[data-id="s09"]').count()) && (await page.locator('#toast').innerText()).includes('Hidden'), 'Hide in the reader hides the card (with Undo)');
await page.click('#toast-undo');
await page.waitForTimeout(300);

// A deadline card stays after opening, grayed out as Opened (also after a refresh)
c = await center('section.action .item[data-id="s01"]');
await page.mouse.click(c.x, c.y);
await page.waitForSelector('#reader:not([hidden]) .msg');
await page.click('#reader-back');
await page.click('#refresh-btn');
await page.waitForFunction(() => !document.querySelector('#refresh-btn').classList.contains('spinning'));
await page.waitForTimeout(300);
check(await page.locator('.item[data-id="s01"].opened').count() === 1, 'opened deadline card stays, marked Opened, after refresh');
await page.locator('.item[data-id="s01"]').scrollIntoViewIfNeeded();
await shot('7b-opened-cards');

// Sender rule from the reader: GitHub -> Junk, then remove it in Settings
c = await center('section.fyi .item[data-id="s27"]');
await page.mouse.click(c.x, c.y);
await page.waitForSelector('#reader:not([hidden]) #r-rules .chips');
await page.click('#r-rules .chips[data-k="section"] button[data-v="junk"]');
await page.waitForFunction(() => !document.querySelector('#refresh-btn').classList.contains('spinning') && document.querySelector('section.junk .item[data-id="s27"]'), null, { timeout: 15000 });
check(true, 'sender rule "Junk" moves the card to Junk');
check(fake.call({ action: 'refresh', token: TOKEN }).rules['notifications@github.com']?.section === 'junk', 'rule stored in the script');
await page.click('#reader-back');
await page.click('#settings-btn');
check((await page.locator('#rules-list').innerText()).includes('notifications@github.com → Junk'), 'Settings lists the rule');
await page.locator('#rules-list').scrollIntoViewIfNeeded();
await shot('7c-settings-sender-rules');
await page.click('#rules-list [data-unrule="notifications@github.com"]');
await page.click('#settings-done');
await page.waitForFunction(() => !document.querySelector('#refresh-btn').classList.contains('spinning') && document.querySelector('section.fyi .item[data-id="s27"]'), null, { timeout: 15000 });
check(!fake.call({ action: 'refresh', token: TOKEN }).rules['notifications@github.com'], 'removing the rule puts it back in FYI');

// Backup path: a card opened over a minute ago that never faded is cleared on the next refresh
await page.evaluate(() => { const st = JSON.parse(localStorage.getItem('eh.state')); st.tapped.s27 = Date.now() - 40 * 60e3; localStorage.setItem('eh.state', JSON.stringify(st)); });
await page.reload();
await page.waitForTimeout(800);
check(!(await page.locator('.item[data-id="s27"]').count()) && serverState().removed.includes('s27'), 'opened-but-never-faded card is cleared on reopen (and in the script)');

// 5. Clear Safari data -> reconnect -> hidden cards stay hidden (state lives in the script)
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.fill('#f-url', SCRIPT_URL);
await page.fill('#f-token', TOKEN);
await page.click('#settings-done');
await page.waitForFunction(() => document.querySelectorAll('.item').length > 5 && !document.querySelector('#refresh-btn').classList.contains('spinning'), null, { timeout: 30000 });
check(!(await page.locator('.item[data-id="s22"]').count()) && !(await page.locator('.item[data-id="s05"]').count()), 'after clearing Safari data, hidden/cleared cards stay gone');
await page.click('#settings-btn');
const recent = await page.locator('#recent').innerText();
check(recent.includes('Credential has been previewed') && recent.includes('Thanksgiving'), '"Recently hidden" is restored from the script');
await shot('8-recently-hidden-from-script');
// Restore one
await page.click('#recent [data-restore="s22"]');
await page.click('#settings-done');
await page.waitForSelector('.item[data-id="s22"]', { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(300);
check(await page.locator('.item[data-id="s22"]').count() === 1 && !serverState().removed.includes('s22'), 'Restore brings the card back (here and in the script)');

// 7. Error states
await ctx.setOffline(true);
await page.click('#refresh-btn');
await page.waitForFunction(() => !document.querySelector('#banner').hidden);
check((await bannerText()).includes('No internet'), 'offline: friendly message, saved emails still shown');
check(await page.locator('.item').count() > 5, 'offline: cards still visible');
await shot('9-offline');
// Hide while offline -> queued -> sent when back online
await longPress('section.important .item[data-id="s22"]');
check((await page.evaluate(() => JSON.parse(localStorage.getItem('eh.pending') || '[]'))).some((p) => p.id === 's22'), 'offline hide is queued');
await ctx.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.waitForTimeout(800);
check(serverState().removed.includes('s22') && (await page.evaluate(() => JSON.parse(localStorage.getItem('eh.pending') || '[]').length)) === 0, 'queued hide is sent when back online');

mode = 'html';
await page.click('#refresh-btn');
await page.waitForFunction(() => document.querySelector('#banner').classList.contains('error'));
check((await bannerText()).includes('"Anyone"'), 'script not public: explains the "Anyone" setting');
await shot('10-not-public');

mode = 'slow';
await page.click('#refresh-btn');
await page.waitForFunction(() => (document.querySelector('#banner').innerText || '').includes('too long'), null, { timeout: 10000 });
check(true, 'script timeout: "took too long… picks up where it left off"');
await shot('11-timeout');

mode = 'normal';
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('eh.settings')); s.token = 'stale'; localStorage.setItem('eh.settings', JSON.stringify(s)); });
await page.reload();
await page.click('#refresh-btn');
await page.waitForFunction(() => document.querySelector('#banner').classList.contains('error'));
check((await bannerText()).includes('Wrong token'), 'bad token: explains how to fix');
await shot('12-bad-token');

check(!errors.length, 'no JavaScript errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
console.log(failures ? `\n${failures} FAILED` : '\nAll end-to-end checks passed');
await browser.close();
scriptServer.close();
appServer.close();
process.exit(failures ? 1 : 0);
