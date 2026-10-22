// Runs the Apps Script rules engine locally against the sample emails.
// Usage: node tests/run-rules.mjs   (exits 1 if any check fails)
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

// Rules use the script time zone (Central). Re-run under that TZ if needed.
if (process.env.TZ !== 'America/Chicago') {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, TZ: 'America/Chicago' } });
  process.exit(r.status ?? 1);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps-script');
const ctx = vm.createContext({ Logger: { log: console.log }, console });
for (const f of ['Config.example.gs', 'Rules.gs', 'Samples.gs']) {
  vm.runInContext(readFileSync(join(dir, f), 'utf8'), ctx, { filename: f });
}
const { lines, failures } = vm.runInContext('runRuleTests()', ctx);
console.log(lines.join('\n'));
process.exit(failures ? 1 : 0);
