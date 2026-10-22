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

// AI summary hook: used only when AI_SUMMARIES is on, falls back on errors
let hookFail = 0;
const sample = 'SAMPLES[0].e';
const plain = vm.runInContext(`analyze(${sample}, testConfig_()).snippet`, ctx);
vm.runInContext("function aiSummarize_(e) { return 'AI: ' + e.subject; }", ctx);
const off = vm.runInContext(`analyze(${sample}, testConfig_()).snippet`, ctx);
const on = vm.runInContext(`(function(){ var c = testConfig_(); c.AI_SUMMARIES = true; return analyze(${sample}, c).snippet; })()`, ctx);
vm.runInContext("aiSummarize_ = function () { throw new Error('quota'); };", ctx);
const broken = vm.runInContext(`(function(){ var c = testConfig_(); c.AI_SUMMARIES = true; return analyze(${sample}, c).snippet; })()`, ctx);
const ok = off === plain && on === 'AI: Brag sheet + rec letters' && broken === plain;
console.log((ok ? '✓' : '✗') + ' AI summary hook: off by default, used when on, falls back on errors');
if (!ok) hookFail = 1;
process.exit(failures || hookFail ? 1 : 0);
