// Screenshots every design page at iPhone size (390x844 @3x).
// Usage: node design/shoot.mjs [filter]
import { createRequire } from 'module';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');
const here = dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || '';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: 'dark', timezoneId: 'America/Chicago' });
const page = await ctx.newPage();
const pages = readdirSync(join(here, 'concepts')).filter((f) => f.endsWith('.html') && f.includes(filter));
for (const f of pages) {
  await page.goto('file://' + join(here, 'concepts', f), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const name = f.replace('.html', '');
  await page.screenshot({ path: join(here, 'screenshots', `${name}.png`) });
  await page.screenshot({ path: join(here, 'screenshots', `${name}-full.png`), fullPage: true });
  console.log('shot', name);
}
await browser.close();
