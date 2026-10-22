// End-to-end test of the Apps Script backend with fake Gmail / Sheets / Properties.
// Runs every .gs file exactly as Apps Script would (one shared global scope).
// Usage: node tests/run-backend.mjs   (exits 1 on failure)
import { readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash, randomUUID } from 'crypto';
import vm from 'vm';

if (process.env.TZ !== 'America/Chicago') {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, TZ: 'America/Chicago' } });
  process.exit(r.status ?? 1);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps-script');
const ME = 'kasen.test@gmail.com';
let failures = 0;
const check = (ok, msg) => { console.log((ok ? '✓ ' : '✗ ') + msg); if (!ok) failures++; };

// ---------- fakes ----------
const clock = { t: 0 };
const props = new Map();
const sheets = new Map(); // ssId -> Map(name -> rows[][])
const gmailThreads = new Map(); // id -> thread resource

function fakeSheet(ss, name) {
  return {
    getLastRow: () => (ss.get(name) || []).length,
    getLastColumn: () => Math.max(1, ...(ss.get(name) || [[]]).map((r) => r.length)),
    getRange: (r, c, nr, nc) => ({
      getValues: () => (ss.get(name) || []).slice(r - 1, r - 1 + nr).map((row) => row.slice(c - 1, c - 1 + nc)),
      setValues: (rows) => { if (rows.length !== nr || rows.some((x) => x.length !== nc)) throw new Error('setValues size mismatch'); ss.set(name, rows.map((x) => x.map((v) => (typeof v === 'string' && v.length > 50000 ? (() => { throw new Error('cell > 50k chars'); })() : v)))); },
    }),
    clearContents: () => ss.set(name, []),
    setName: (n) => { ss.set(n, ss.get(name) || []); ss.delete(name); name = n; },
  };
}
function fakeSpreadsheet(id) {
  const ss = sheets.get(id);
  return {
    getId: () => id,
    getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id,
    getSheets: () => [...ss.keys()].map((n) => fakeSheet(ss, n)),
    getSheetByName: (n) => (ss.has(n) ? fakeSheet(ss, n) : null),
    insertSheet: (n) => { ss.set(n, []); return fakeSheet(ss, n); },
  };
}

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url');
const ctx = vm.createContext({
  console: { log() {}, warn() {}, error: console.error },
  Logger: { log: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, String(v)), deleteProperty: (k) => props.delete(k) }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ content: s, setMimeType() { return this; } }) },
  Utilities: {
    DigestAlgorithm: { MD5: 'md5' },
    computeDigest: (alg, s) => [...createHash(alg).update(s).digest()].map((b) => (b > 127 ? b - 256 : b)),
    getUuid: () => randomUUID(),
    base64DecodeWebSafe: (s) => [...Buffer.from(s, 'base64url')],
    newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }),
  },
  SpreadsheetApp: {
    create: () => { const id = 'ss' + sheets.size; sheets.set(id, new Map([['Sheet1', []]])); return fakeSpreadsheet(id); },
    openById: (id) => { if (!sheets.has(id)) throw new Error('not found'); return fakeSpreadsheet(id); },
  },
  Gmail: {
    Users: {
      getProfile: () => ({ emailAddress: ME }),
      Threads: {
        list: () => ({ threads: [...gmailThreads.values()].map((t) => ({ id: t.id, historyId: t.historyId })) }),
        get: (_, id) => { clock.t += 1000; const t = gmailThreads.get(id); if (!t) throw new Error('Not Found'); return JSON.parse(JSON.stringify(t)); },
      },
      Messages: {
        get: (_, mid) => {
          for (const t of gmailThreads.values()) for (const m of t.messages) if (m.id === mid) return { payload: { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b64url(m._body || '') } }] } };
          throw new Error('msg not found');
        },
      },
    },
  },
});
// Test exactly what gets pasted into Apps Script: the bundle + the config.
for (const f of ['Config.example.gs', 'dist/EmailHelper.gs']) {
  vm.runInContext(readFileSync(join(dir, f), 'utf8'), ctx, { filename: f });
}
// Pin time: TEST_NOW, advanced by fake Gmail calls.
clock.t = vm.runInContext('TEST_NOW', ctx);
ctx.__clock = clock;
vm.runInContext('Date.now = function () { return __clock.t; };', ctx);
// Use the test config (fake family/counselor) and small chunks so the scan spans several calls.
vm.runInContext('CONFIG = testConfig_(); CONFIG.CHUNK_SECONDS = 8;', ctx);

// ---------- build fake Gmail from the samples ----------
let hist = 100;
function addThread(e, extra = {}) {
  const labels = [...(e.labels || ['INBOX'])];
  if (e.unread) labels.push('UNREAD');
  const headers = [
    { name: 'From', value: `${e.from} <${e.fromEmail}>` },
    { name: 'To', value: e.toMe ? `Kasen <${ME}>` : 'Parent <parent1@example.com>' },
    { name: 'Subject', value: e.subject },
  ];
  if (e.listUnsubscribe) headers.push({ name: 'List-Unsubscribe', value: '<mailto:u@x.com>' });
  const messages = [{ id: e.id + 'm1', labelIds: labels, snippet: e.snippet, internalDate: String(e.date), payload: { headers }, _body: e.body }];
  if (e.replied) messages.push({ id: e.id + 'm2', labelIds: ['SENT'], snippet: 'ok!', internalDate: String(e.date + 60e3), payload: { headers: [{ name: 'From', value: ME }, { name: 'Subject', value: 'Re: ' + e.subject }] } });
  gmailThreads.set(e.id, { id: e.id, historyId: String(hist++), messages, ...extra });
}
const samples = vm.runInContext('SAMPLES', ctx);
samples.forEach((s) => addThread(s.e));
// A note to self (only my messages) -> skipped
gmailThreads.set('self1', { id: 'self1', historyId: '1', messages: [{ id: 'self1m', labelIds: ['SENT', 'INBOX'], snippet: 'note', internalDate: String(clock.t - 3600e3), payload: { headers: [{ name: 'From', value: ME }, { name: 'To', value: ME }, { name: 'Subject', value: 'note to self' }] } }] });
// Paradox later says the assessment is done -> s08 (assessment) should auto-clear, s09 (interview) stays
const at = (s) => vm.runInContext(`at_(${JSON.stringify(s)})`, ctx);
addThread({ id: 'd01', from: 'Valvoline Hiring', fromEmail: 'olivia.alerts@paradox.ai', subject: 'Application update for Kasen at Valvoline', snippet: 'Hi Kasen, Thank you for completing our assessment!', body: 'Hi Kasen, Thank you for completing our assessment! A member of our team will reach out.', date: at('2026-10-19 10:26'), labels: ['INBOX'], unread: false, toMe: true, listUnsubscribe: true });
// A repeat reminder of s07 -> collapsed into one card
addThread({ id: 'r07', from: 'ADP', fromEmail: 'jobs@adp.com', subject: 'Reminder: Additional Information Needed for the Position of Req # 1999-5367-P/T Service Technician', snippet: 'Reminder: further information is needed.', body: 'Reminder: further information is needed.', date: at('2026-10-22 08:00'), labels: ['INBOX'], unread: true, toMe: true });

// Two reminders about the same form, different wording -> one card (newest)
addThread({ id: 'f01', from: 'Valvoline Hiring', fromEmail: 'olivia.alerts@paradox.ai', subject: 'Complete your form at Valvoline Instant Oil Change', snippet: 'Please complete a short address verification form.', body: 'Please complete a short address verification form.', date: at('2026-10-17 18:10'), labels: ['INBOX'], unread: true, toMe: true, listUnsubscribe: true });
addThread({ id: 'f02', from: 'Valvoline Hiring', fromEmail: 'olivia.alerts@paradox.ai', subject: 'Reminder: Complete your form for the Entry-level Lube Tech position!', snippet: 'This is your first reminder to complete your address verification form.', body: 'This is your first reminder to complete your address verification form.', date: at('2026-10-19 10:07'), labels: ['INBOX'], unread: true, toMe: true, listUnsubscribe: true });

const call = (params) => JSON.parse(vm.runInContext(`doGet(${JSON.stringify({ parameter: params })}).content`, ctx));

// ---------- tests ----------
check(call({ action: 'ping', token: 'nope' }).error === 'bad-token', 'rejects a request before setup (no token yet)');
vm.runInContext('setup()', ctx);
const TOKEN = props.get('TOKEN');
check(TOKEN && TOKEN.length === 40, 'setup() creates a 40-char token');
check(call({ action: 'ping' }).error === 'bad-token', 'rejects a request with no token');
check(call({ action: 'ping', token: TOKEN.slice(0, -1) + 'x' }).error === 'bad-token', 'rejects a wrong token');
check(call({ action: 'ping', token: TOKEN }).ok === true, 'ping works with the token');

// First run: chunked
let r, calls = 0, progress = [];
do { r = call({ action: 'refresh', token: TOKEN }); calls++; progress.push(`${r.processed}/${r.total}`); } while (r.ok && !r.done && calls < 20);
check(r.ok && r.done, `first scan finishes in chunks (${calls} calls: ${progress.join(' → ')})`);
check(calls > 1, 'first scan needed more than one call (6-min limit handling)');

const dump = process.argv.find((a) => a.startsWith('--dump='));
if (dump) writeFileSync(dump.slice(7), JSON.stringify({ now: vm.runInContext('TEST_NOW', ctx), emails: r.emails }));
const byId = Object.fromEntries(r.emails.map((e) => [e.id, e]));
check(!byId.self1, 'note-to-self thread skipped');
check(!byId.s08 && !!byId.s09, '"Thanks for completing our assessment" auto-clears the assessment card only');
check(!(byId.s07 && byId.r07), 'repeat reminder collapsed into one card');
check(byId.f02 && !byId.f01, 'differently-worded reminders for the same form merge into the newest');
check(byId.s16?.section === 'junk' && byId.s11?.section === 'urgent', 'fresh code in Urgent, 40-min-old code in Junk');

// Every live sample lands where Samples.gs says
let mismatch = [];
samples.forEach((s) => {
  const got = byId[s.e.id];
  if (!got || ['s08', 's07'].includes(s.e.id)) return;
  if (got.section !== s.expect.section) mismatch.push(`${s.e.id}: ${got.section} != ${s.expect.section}`);
});
check(!mismatch.length, 'payload sections match the rules harness' + (mismatch.length ? ' — ' + mismatch.join('; ') : ''));
check(r.emails.every((e) => e.id && e.from && 'section' in e && 'cat' in e && 'deadline' in e), 'every card has the fields the app needs');

// Incremental: nothing changed -> nothing processed
r = call({ action: 'refresh', token: TOKEN });
check(r.ok && r.done && r.total === 0, 'second refresh with no changes processes 0 threads');

// Mark Mom's email read in Gmail -> historyId bumps -> reprocessed; reply-type card stays (needs a tap)
const mom = gmailThreads.get('s05');
mom.messages[0].labelIds = mom.messages[0].labelIds.filter((l) => l !== 'UNREAD');
mom.historyId = String(hist++);
r = call({ action: 'refresh', token: TOKEN });
check(r.total === 1, 'changed thread is re-processed (1 of ' + gmailThreads.size + ')');
check(r.emails.some((e) => e.id === 's05'), 'reading a Needs Reply email in Gmail does NOT clear it');

// Reading a plain Important email clears it
const act = gmailThreads.get('s21');
act.messages[0].labelIds = act.messages[0].labelIds.filter((l) => l !== 'UNREAD');
act.historyId = String(hist++);
r = call({ action: 'refresh', token: TOKEN });
check(!r.emails.some((e) => e.id === 's21'), 'reading an Important email (no deadline) clears it');

// Replying clears a reply-type card
mom.messages.push({ id: 's05m2', labelIds: ['SENT'], snippet: 'Thursday!', internalDate: String(clock.t), payload: { headers: [{ name: 'From', value: ME }] } });
mom.historyId = String(hist++);
r = call({ action: 'refresh', token: TOKEN });
check(!r.emails.some((e) => e.id === 's05'), 'replying in Gmail clears the Needs Reply card');

// Hide / restore, stored script-side
check(call({ action: 'hide', id: 's09', token: TOKEN }).ok, 'hide accepted');
r = call({ action: 'refresh', token: TOKEN });
check(!r.emails.some((e) => e.id === 's09') && r.removed.some((x) => x.id === 's09' && x.subject), 'hidden card gone + listed in "removed"');
call({ action: 'restore', id: 's09', token: TOKEN });
r = call({ action: 'refresh', token: TOKEN });
check(r.emails.some((e) => e.id === 's09'), 'restore brings it back');
check(call({ action: 'hide', id: '../../etc', token: TOKEN }).error === 'bad-id', 'rejects a malformed id');

// Config change -> full re-analyze
vm.runInContext("CONFIG.URGENT_HOURS = 72;", ctx);
r = call({ action: 'refresh', token: TOKEN });
let total = r.total;
while (!r.done) r = call({ action: 'refresh', token: TOKEN });
check(total === gmailThreads.size, `editing Config re-analyzes everything (${total} threads)`);

// Thread leaves the window -> dropped, state pruned
gmailThreads.delete('s01');
r = call({ action: 'refresh', token: TOKEN });
check(!r.emails.some((e) => e.id === 's01'), 'archived/old thread drops out');

console.log(failures ? `\n${failures} FAILED` : '\nAll backend checks passed');
process.exit(failures ? 1 : 0);
