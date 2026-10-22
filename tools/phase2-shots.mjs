// Phase 2 screenshots: test-harness reports + the app rendering real backend output.
// Usage: node tools/phase2-shots.mjs  -> design/screenshots/phase2/*.png
import { createRequire } from 'module';
import { createServer } from 'http';
import { readFile, mkdir } from 'fs/promises';
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'design', 'screenshots', 'phase2');
await mkdir(out, { recursive: true });

const run = (script, ...args) => spawnSync(process.execPath, [join(root, script), ...args], { encoding: 'utf8' }).stdout;
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const term = (title, text) => `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;background:#0e0e10;color:#d8d8dc;font:12.5px/1.5 ui-monospace,Menlo,monospace;padding:20px 24px}
  h1{font:600 15px -apple-system,system-ui,sans-serif;color:#fff;margin:0 0 12px}
  pre{margin:0;white-space:pre} .ok{color:#9fd4a8} .bad{color:#ff6b6b} .dim{color:#77777f}
</style><h1>${title}</h1><pre>${esc(text).replace(/^✓/gm, '<span class="ok">✓</span>').replace(/^✗.*$/gm, (m) => `<span class="bad">${m}</span>`).replace(/\(([^)]*)\)$/gm, '<span class="dim">($1)</span>')}</pre>`;

const browser = await chromium.launch();

// 1-2: test reports (desktop width; they're wide tables)
const desk = await browser.newPage({ viewport: { width: 1180, height: 800 }, deviceScaleFactor: 2 });
await desk.setContent(term('Rules engine: sample emails → section / category / deadline   (node tests/run-rules.mjs)', run('tests/run-rules.mjs')));
await desk.screenshot({ path: join(out, '1-rules-test-harness.png'), fullPage: true });
const dumpPath = join(tmpdir(), 'eh-payload.json');
await desk.setContent(term('Backend end-to-end with fake Gmail + Sheets   (node tests/run-backend.mjs)', run('tests/run-backend.mjs', '--dump=' + dumpPath)));
await desk.screenshot({ path: join(out, '2-backend-tests.png'), fullPage: true });
console.log('shot test reports');

// 3: the phone app showing exactly what the backend returned for the sample inbox
const payload = JSON.parse(readFileSync(dumpPath, 'utf8'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  try { res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(await readFile(join(root, 'app', p))); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: 'dark', timezoneId: 'America/Chicago', serviceWorkers: 'block' });
await ctx.addInitScript(({ emails, now }) => {
  localStorage.setItem('eh.settings', JSON.stringify({ scriptUrl: 'https://script.google.com/macros/s/x/exec', token: 't', gmail: '', openIn: 'app', demo: false }));
  localStorage.setItem('eh.cache', JSON.stringify({ emails, refreshedAt: now - 60e3 }));
}, payload);
const page = await ctx.newPage();
await page.clock.setFixedTime(new Date(payload.now));
await page.goto(`http://localhost:${server.address().port}/`);
await page.waitForSelector('.item');
await page.waitForTimeout(400);
await page.screenshot({ path: join(out, '3-app-showing-backend-output.png') });
await page.screenshot({ path: join(out, '3-app-showing-backend-output-full.png'), fullPage: true });
console.log('shot app');
await browser.close();
server.close();
