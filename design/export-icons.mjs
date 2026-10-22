// Exports each design/icons/*.svg to PNG at the iOS / PWA sizes.
// Usage: node design/export-icons.mjs
import { createRequire } from 'module';
import { readdirSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');
const here = dirname(fileURLToPath(import.meta.url));
const SIZES = [1024, 512, 192, 180, 167, 152, 120];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const f of readdirSync(join(here, 'icons')).filter((f) => f.endsWith('.svg'))) {
  const name = f.replace('.svg', '');
  mkdirSync(join(here, 'icons', 'png', name), { recursive: true });
  for (const s of SIZES) {
    await page.setViewportSize({ width: s, height: s });
    // Inline the SVG (an <img src="file://…"> is blocked on about:blank and renders as a broken image).
    const svg = readFileSync(join(here, 'icons', f), 'utf8');
    await page.setContent(`<style>*{margin:0}svg{display:block;width:${s}px;height:${s}px}</style>${svg}`);
    await page.screenshot({ path: join(here, 'icons', 'png', name, `${name}-${s}.png`) });
  }
  console.log('exported', name);
}
await browser.close();
