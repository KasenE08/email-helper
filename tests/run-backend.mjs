// End-to-end test of the Apps Script backend with fake Gmail / Sheets / Properties.
// Runs every .gs file exactly as Apps Script would (one shared global scope).
// Usage: node tests/run-backend.mjs   (exits 1 on failure)
import { writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
import { createFakeScript } from './fake-apps-script.mjs';

if (process.env.TZ !== 'America/Chicago') {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, TZ: 'America/Chicago' } });
  process.exit(r.status ?? 1);
}

let failures = 0;
const check = (ok, msg) => { console.log((ok ? '✓ ' : '✗ ') + msg); if (!ok) failures++; };

const fake = createFakeScript();
const { ctx, call, gmailThreads, props, clock, addThread, at, samples, ME, nextHist } = fake;

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
check(byId.s01?.msgId === 's01@mail.example.com', 'cards carry the Message-ID (for exact-email links)');

// Incremental: nothing changed -> nothing processed
r = call({ action: 'refresh', token: TOKEN });
check(r.ok && r.done && r.total === 0, 'second refresh with no changes processes 0 threads');

// Mark Mom's email read in Gmail -> historyId bumps -> reprocessed; reply-type card stays (needs a tap)
const mom = gmailThreads.get('s05');
mom.messages[0].labelIds = mom.messages[0].labelIds.filter((l) => l !== 'UNREAD');
mom.historyId = nextHist();
r = call({ action: 'refresh', token: TOKEN });
check(r.total === 1, 'changed thread is re-processed (1 of ' + gmailThreads.size + ')');
check(r.emails.some((e) => e.id === 's05'), 'reading a Needs Reply email in Gmail does NOT clear it');

// Reading a plain Important email clears it
const act = gmailThreads.get('s21');
act.messages[0].labelIds = act.messages[0].labelIds.filter((l) => l !== 'UNREAD');
act.historyId = nextHist();
r = call({ action: 'refresh', token: TOKEN });
check(!r.emails.some((e) => e.id === 's21'), 'reading an Important email (no deadline) clears it');

// Replying clears a reply-type card
mom.messages.push({ id: 's05m2', labelIds: ['SENT'], snippet: 'Thursday!', internalDate: String(clock.t), payload: { headers: [{ name: 'From', value: ME }] } });
mom.historyId = nextHist();
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

// In-app reader
addThread({ id: 'h01', from: 'Valvoline Hiring', fromEmail: 'olivia.alerts@paradox.ai', subject: 'Please complete your form', snippet: 'Please complete your form.',
  html: '<html><head><style>p{color:red}</style></head><body><p>Hi Kasen!</p><p>Please complete your <b>address</b> form &amp; ID check:</p><p><a href="https://oli.vi/AbC?x=1&amp;y=2">Complete form</a></p><ul><li>Takes 2 minutes</li></ul><script>alert(1)</script></body></html>',
  body: '', date: at('2026-10-22 09:00'), labels: ['INBOX'], unread: true, toMe: true, listUnsubscribe: true });
let rd = call({ action: 'read', id: 'h01', token: TOKEN });
const hb = rd.thread?.messages?.[0]?.body || '';
check(rd.ok && rd.thread.subject === 'Please complete your form', 'read returns the thread');
check(hb.includes('⟦https://oli.vi/AbC?x=1&y=2|Complete form⟧'), 'reader keeps links (as markers the app turns into buttons)');
check(hb.includes('Hi Kasen!\n') && hb.includes('• Takes 2 minutes') && hb.includes('address form & ID check'), 'reader keeps paragraphs, bullets and decodes &amp;');
check(!/<|alert\(|color:red/.test(hb), 'reader output has no HTML, scripts or styles');
const mom2 = gmailThreads.get('s05');
mom2.messages[0]._body = 'Can you check your schedule?\n\nOn Tue, Oct 20, 2026 at 9:00 AM Kasen <x@y.com> wrote:\n> old quoted text';
rd = call({ action: 'read', id: 's05', token: TOKEN });
check(rd.thread.messages.length === 2 && rd.thread.messages[1].mine, 'reader shows the whole thread, marking my replies');
check(!rd.thread.messages[0].body.includes('old quoted text'), 'reader trims quoted replies');
check(call({ action: 'read', id: '../x', token: TOKEN }).error === 'bad-id', 'read rejects a malformed id');
check(call({ action: 'read', id: 'h01' }).error === 'bad-token', 'read needs the token');

// Speed: an unchanged refresh doesn't rewrite the data sheet
r = call({ action: 'refresh', token: TOKEN }); while (!r.done) r = call({ action: 'refresh', token: TOKEN });
const writesBefore = fake.sheetWrites();
r = call({ action: 'refresh', token: TOKEN });
check(r.total === 0 && fake.sheetWrites() === writesBefore, 'unchanged refresh skips the sheet writes (faster)');

// Sender rules from the app (no re-scan needed)
check(call({ action: 'rule', key: 'notifications@github.com', section: 'junk', token: TOKEN }).ok, 'rule saved');
r = call({ action: 'refresh', token: TOKEN });
check(r.emails.find((e) => e.id === 's27')?.section === 'junk' && r.rules['notifications@github.com']?.section === 'junk', 'rule re-sorts on the next refresh and is listed');
check(call({ action: 'rule', key: '@vt.edu', cat: 'other', token: TOKEN }).ok, 'domain rule saved');
r = call({ action: 'refresh', token: TOKEN });
check(r.emails.filter((e) => e.fromEmail?.endsWith('vt.edu')).every((e) => e.cat === 'other'), 'domain rule changes category for subdomains');
call({ action: 'rule', key: 'notifications@github.com', token: TOKEN });
r = call({ action: 'refresh', token: TOKEN });
check(r.emails.find((e) => e.id === 's27')?.section === 'fyi' && !r.rules['notifications@github.com'], 'clearing a rule restores normal sorting');
check(call({ action: 'rule', key: 'not a sender', section: 'junk', token: TOKEN }).error === 'bad-key' && call({ action: 'rule', key: 'a@b.com', section: 'nope', token: TOKEN }).error === 'bad-rule', 'bad rules rejected');
call({ action: 'rule', key: '@vt.edu', token: TOKEN });

// "Opened in the app" survives on the script side
call({ action: 'tap', id: 's25', token: TOKEN });
r = call({ action: 'refresh', token: TOKEN });
check(r.emails.find((e) => e.id === 's25')?.opened === true && r.emails.find((e) => e.id === 's26')?.opened === false, 'cards carry "opened" from the script');

// Gmail rate limit: short blips are retried; a long one stops the chunk without losing threads
fake.quota.failNext = 2;
gmailThreads.get('s19').historyId = nextHist();
r = call({ action: 'refresh', token: TOKEN });
check(r.ok && r.done && !r.rateLimited && r.emails.some((e) => e.id === 's19'), 'brief Gmail rate limit is retried and the scan finishes');
fake.quota.failNext = 3;
gmailThreads.get('s19').historyId = nextHist();
r = call({ action: 'refresh', token: TOKEN });
check(r.ok && !r.done && r.rateLimited && r.processed === 0, 'long rate limit: chunk stops, thread stays queued, app is told');
r = call({ action: 'refresh', token: TOKEN });
check(r.ok && r.done && r.emails.some((e) => e.id === 's19'), 'next call picks it back up (nothing dropped)');

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
