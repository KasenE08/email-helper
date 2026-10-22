// A fake Google Apps Script environment (Gmail, Sheets, Properties, Lock, ContentService)
// running the REAL bundled backend (apps-script/dist/EmailHelper.gs) with sample emails.
// Used by tests/run-backend.mjs and tools/e2e.mjs. Needs TZ=America/Chicago.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash, randomUUID } from 'crypto';
import vm from 'vm';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps-script');

export function createFakeScript({ chunkSeconds = 8, me = 'kasen.test@gmail.com' } = {}) {
  const ME = me;
  const writes = { n: 0 };
  const quota = { failNext: 0 };
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
      clearContents: () => { writes.n++; ss.set(name, []); },
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
      sleep: (ms) => { clock.t += ms; },
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
          get: (_, id, opts = {}) => {
            clock.t += 1000;
            if (quota.failNext > 0) { quota.failNext--; throw new Error("API call to gmail.users.threads.get failed with error: Quota exceeded for quota metric 'Total Query Cost'"); }
            const t = gmailThreads.get(id);
            if (!t) throw new Error('Not Found');
            const copy = JSON.parse(JSON.stringify(t));
            if (opts.format === 'full') copy.messages.forEach((m) => { m.payload.mimeType = 'multipart/alternative'; m.payload.parts = m._html ? [{ mimeType: 'text/html', body: { data: b64url(m._html) } }] : [{ mimeType: 'text/plain', body: { data: b64url(m._body || '') } }]; });
            return copy;
          },
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
  vm.runInContext('CONFIG = testConfig_(); CONFIG.CHUNK_SECONDS = ' + chunkSeconds + ';', ctx);

  // ---------- build fake Gmail from the samples ----------
  let hist = 100;
  function addThread(e, extra = {}) {
    const labels = [...(e.labels || ['INBOX'])];
    if (e.unread) labels.push('UNREAD');
    const headers = [
      { name: 'From', value: `${e.from} <${e.fromEmail}>` },
      { name: 'To', value: e.toMe ? `Kasen <${ME}>` : 'Parent <parent1@example.com>' },
      { name: 'Subject', value: e.subject },
      { name: 'Message-ID', value: `<${e.id}@mail.example.com>` },
    ];
    if (e.listUnsubscribe) headers.push({ name: 'List-Unsubscribe', value: '<mailto:u@x.com>' });
    const messages = [{ id: e.id + 'm1', labelIds: labels, snippet: e.snippet, internalDate: String(e.date), payload: { headers }, _body: e.body, _html: e.html }];
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
    const nextHist = () => String(hist++);
    return { ctx, call, gmailThreads, props, clock, addThread, at, samples, ME, nextHist, sheetWrites: () => writes.n, quota };
}
