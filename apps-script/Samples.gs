/**
 * TEST HARNESS — fake sample emails (modeled on real inbox patterns, no real people)
 * and what the rules should do with each.
 *
 * Run in Apps Script: select `testRules` in the toolbar and click Run, then View > Logs.
 * Run locally:        node tests/run-rules.mjs
 */

// Pinned "now" for tests: Thu Oct 22 2026, 4:40 PM (script time zone = Central).
var TEST_NOW = new Date(2026, 9, 22, 16, 40).getTime();

// Test config = the example config with a few fake personal entries filled in.
function testConfig_() {
  var c = JSON.parse(JSON.stringify(CONFIG));
  c.FAMILY = ['parent1@example.com', 'parent.two@vanderbilt.edu'];
  c.COUNSELOR_DOMAINS = ['example-counselor.com'];
  c.COUNSELOR_NAMES = ['Jane Counselor'];
  c.SCHOOL_DOMAINS = c.SCHOOL_DOMAINS.concat(['example-district.edu']);
  return c;
}

/** "2026-10-22 09:14" -> ms in script time zone */
function at_(s) {
  var m = s.match(/(\d+)-(\d+)-(\d+) (\d+):(\d+)/);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
}

var ME = 'kasen.test@gmail.com';

/** Build a sample email with sensible defaults. */
function mail_(o) {
  return {
    id: o.id, from: o.from, fromEmail: o.fromEmail, subject: o.subject || '', snippet: o.snippet || o.body || '',
    body: o.body || '', date: at_(o.date), labels: o.labels || ['INBOX'], unread: o.unread !== false,
    replied: !!o.replied, toMe: o.toMe !== false, listUnsubscribe: !!o.bulk, bulk: !!o.bulk,
  };
}

var SAMPLES = [
  // ---- Needs Reply / Action ----
  { e: mail_({ id: 's01', from: 'Jane Counselor', fromEmail: 'jane@example-counselor.com', date: '2026-10-22 09:14', subject: 'Brag sheet + rec letters',
      body: 'Hi Kasen, before I write your letters can you send me your updated brag sheet by Monday at 5pm? Thanks!' }),
    expect: { section: 'action', cat: 'school', kind: 'reply', deadline: 'Oct 26 17:00' } },
  { e: mail_({ id: 's02', from: 'Jane Counselor', fromEmail: 'jane@example-counselor.com', date: '2026-10-21 14:00', subject: 'Essay draft notes',
      body: 'Hi! Attached are my notes on the essay. Can we talk Thursday?', toMe: false }),
    expect: { section: 'important', cat: 'school', kind: null, note: 'only cc\'d -> not a reply owed' } },
  { e: mail_({ id: 's03', from: 'Jane Counselor', fromEmail: 'jane@example-counselor.com', date: '2026-10-20 02:58',
      subject: 'Invitation: Kasen and Jane Counselor @ Thu Oct 22, 2026 3:30pm - 4:30pm (CDT) (kasen.test@gmail.com)',
      body: 'Current Seniors Only. Reply for kasen.test@gmail.com Yes No Maybe' }),
    expect: { section: 'action', cat: 'school', kind: 'action', deadline: 'Oct 22 15:30' } },
  { e: mail_({ id: 's04', from: 'Fathom', fromEmail: 'no-reply@fathom.video', date: '2026-10-21 15:30', subject: 'Jane Counselor wants to record your upcoming meeting',
      body: 'Is it okay if Jane records your meeting tomorrow? YES, I consent to being recorded', bulk: true }),
    expect: { section: 'action', cat: 'school', kind: 'action', deadline: 'Oct 22 23:59' } },
  { e: mail_({ id: 's05', from: 'Mom', fromEmail: 'parent1@example.com', date: '2026-10-22 13:05', subject: 'Thanksgiving plans',
      body: "Grandma wants to know if we're driving up Wednesday or Thursday. Can you check your work schedule and let me know?" }),
    expect: { section: 'action', cat: 'family', kind: 'reply', deadline: null } },
  { e: mail_({ id: 's06', from: 'Mom', fromEmail: 'parent1@example.com', date: '2026-10-21 10:00', subject: 'Re: dinner?',
      body: 'Are you free Friday?', replied: true }),
    expect: { section: 'important', cat: 'family', kind: null, note: 'already replied -> not owed' } },
  { e: mail_({ id: 's07', from: 'ADP', fromEmail: 'jobs@adp.com', date: '2026-10-21 17:00', subject: 'Additional Information Needed for the Position of Req # 1999-5367-P/T Service Technician',
      body: 'Dear Kasen, Further information is needed in order to proceed. Please follow the link.' }),
    expect: { section: 'action', cat: 'work', kind: 'action', deadline: null } },
  { e: mail_({ id: 's08', from: 'Valvoline Hiring', fromEmail: 'olivia.alerts@paradox.ai', date: '2026-10-19 10:11', subject: 'Please complete your assessment for Valvoline Instant Oil Change',
      body: 'Hi Kasen, Please complete your assessment for the Entry-level Lube Tech position here.', bulk: true, labels: ['INBOX', 'CATEGORY_UPDATES'] }),
    expect: { section: 'action', cat: 'work', kind: 'action' } },
  { e: mail_({ id: 's09', from: 'Valvoline Hiring', fromEmail: 'olivia.alerts@paradox.ai', date: '2026-10-19 08:53', subject: 'Valvoline Instant Oil Change would like to schedule a virtual interview with you!',
      body: "Hi Kasen! I'm Megan, the virtual scheduling assistant.", bulk: true }),
    expect: { section: 'action', cat: 'work', kind: 'action' } },
  { e: mail_({ id: 's10', from: 'University of Michigan', fromEmail: 'michigan.admissions@umich.edu', date: '2026-10-15 18:12', subject: 'U-M Early Action or Early Decision Application: Missing Items',
      body: 'Kasen, your UM application is missing a few items! Complete Your Application by Nov. 1', bulk: true, labels: ['INBOX', 'CATEGORY_UPDATES'] }),
    expect: { section: 'action', cat: 'school', kind: 'action', deadline: 'Nov 1 23:59' } },

  // ---- Urgent ----
  { e: mail_({ id: 's11', from: 'ADP', fromEmail: 'SecurityServices_NoReply@adp.com', date: '2026-10-22 16:34', subject: "Here's your verification code from ADP",
      snippet: 'Verification code 957267 This code expires in 15 minutes.' }),
    expect: { section: 'urgent', cat: 'work', code: '957267' } },
  { e: mail_({ id: 's12', from: 'Harver', fromEmail: 'noreply@harver.com', date: '2026-10-22 16:30', subject: 'Confirmation code: 8038', snippet: 'Here is your access code. Enter the code below to finish signing in. 8038' }),
    expect: { section: 'urgent', cat: 'work', code: '8038' } },
  { e: mail_({ id: 's13', from: 'Harver', fromEmail: 'noreply@harver.com', date: '2026-10-22 16:31', subject: 'Valvoline Assessment Magic Link', snippet: 'This link will expire in 1 hour and can be used only once.' }),
    expect: { section: 'urgent', cat: 'work', code: true } },
  { e: mail_({ id: 's14', from: 'Twitch', fromEmail: 'account@twitch.tv', date: '2026-10-22 16:38', subject: '328008 - Your Twitch Login Verification Code', snippet: 'Someone is trying to log in into Twitch with a new device.' }),
    expect: { section: 'urgent', cat: 'other', code: '328008' } },
  { e: mail_({ id: 's15', from: 'Google', fromEmail: 'no-reply@accounts.google.com', date: '2026-10-22 16:39', subject: 'Security alert', snippet: 'A new sign-in on Apple iPhone. If this was you, you don\'t need to do anything.' }),
    expect: { section: 'urgent', cat: 'other', code: true } },
  { e: mail_({ id: 's16', from: 'ADP', fromEmail: 'SecurityServices_NoReply@adp.com', date: '2026-10-22 16:00', subject: "Here's your verification code from ADP", snippet: 'Verification code 112233 This code expires in 15 minutes.' }),
    expect: { section: 'junk', cat: 'work', code: '112233', note: '40 min old -> Junk' } },
  { e: mail_({ id: 's17', from: 'Valvoline Hiring', fromEmail: 'olivia.alerts@paradox.ai', date: '2026-10-22 16:00', subject: 'Your virtual interview at Valvoline Instant Oil Change is in one hour!',
      body: 'Oct 22 Thu Your virtual interview at Valvoline Instant Oil Change is in one hour! Hi Kasen!', bulk: true }),
    expect: { section: 'urgent', cat: 'work', deadline: 'Oct 22 17:00' } },
  { e: mail_({ id: 's18', from: 'Calendly', fromEmail: 'notifications@calendly.com', date: '2026-10-21 15:31',
      subject: 'Reminder: Current Seniors Only with Jane Counselor at 03:30pm (Central Time - US & Canada) on Thursday, October 22, 2026', bulk: true }),
    expect: { section: 'urgent', cat: 'school', deadline: 'Oct 22 15:30', note: 'passed 70 min ago -> red' } },
  { e: mail_({ id: 's19', from: 'Edmentum', fromEmail: 'noreply@edoptionsacademy.com', date: '2026-10-22 07:00', subject: 'English 12 Unit 4 Mastery Test closes tonight',
      body: 'Reminder: the Unit 4 Mastery Test closes today at 11:59 PM.' }),
    expect: { section: 'urgent', cat: 'school', deadline: 'Oct 22 23:59' } },

  // ---- Important ----
  { e: mail_({ id: 's20', from: 'Dad', fromEmail: 'parent.two@vanderbilt.edu', date: '2026-10-21 17:17', subject: 'Fw: Welcome to class!',
      body: 'Begin forwarded message: Good evening! Class meets Saturday, October 24 at 8am. Bring your permit.' }),
    expect: { section: 'important', cat: 'family', deadline: 'Oct 24 08:00', note: 'family beats vanderbilt.edu whitelist' } },
  { e: mail_({ id: 's21', from: 'ACT', fromEmail: 'myact@act.org', date: '2026-10-15 15:14', subject: 'Your ACT scores are here!', body: 'Hi KASEN, Your Sep. 2026 ACT test multiple choice scores are here!', bulk: true }),
    expect: { section: 'important', cat: 'school', deadline: null } },
  { e: mail_({ id: 's22', from: 'Parchment', fromEmail: 'noreply@mail.parchment.com', date: '2026-10-21 15:31', subject: 'Credential has been previewed', body: 'Your requested document has been received and viewed.' }),
    expect: { section: 'important', cat: 'school' } },
  { e: mail_({ id: 's23', from: 'ADP', fromEmail: 'jobs@adp.com', date: '2026-10-21 17:15', subject: 'Employment Update - Acme Auto LLC', body: 'Dear Kasen: We have received your application for the position of P/T Service Technician.' }),
    expect: { section: 'fyi', cat: 'work', note: 'automated "we received your application"' } },
  { e: mail_({ id: 's24', from: 'Laura', fromEmail: 'laura@example-ridingschool.com', date: '2026-10-21 19:00', subject: 'Welcome to class!',
      body: 'Please read the attached waiver and bring it Saturday, October 24 at 7:30am.' }),
    expect: { section: 'important', cat: 'other', deadline: 'Oct 24 07:30' } },

  // ---- FYI ----
  { e: mail_({ id: 's25', from: 'Virginia Tech', fromEmail: 'admissions@admit.vt.edu', date: '2026-10-21 19:16', subject: 'Kasen, I want you to apply Early Action',
      body: 'We are less than a month away. Apply by Nov. 1 for Early Action. Register below for a virtual visit.', bulk: true, labels: ['INBOX', 'CATEGORY_PROMOTIONS'] }),
    expect: { section: 'fyi', cat: 'school', deadline: 'Nov 1 23:59' } },
  { e: mail_({ id: 's26', from: 'Virginia Tech', fromEmail: 'admissions@admit.vt.edu', date: '2026-10-21 18:07', subject: 'Next week! -- Ready to virtually visit Virginia Tech?',
      body: 'Register below to receive the Zoom link.', bulk: true, labels: ['INBOX', 'CATEGORY_PROMOTIONS'] }),
    expect: { section: 'fyi', cat: 'school', kind: null, note: 'whitelisted marketing: "Register" ignored' } },
  { e: mail_({ id: 's27', from: 'GitHub', fromEmail: 'notifications@github.com', date: '2026-10-21 21:16', subject: '[KasenE08/learning-piano] Run failed: Deploy to GitHub Pages - main (840211b)' }),
    expect: { section: 'fyi', cat: 'other' } },

  // ---- Junk ----
  { e: mail_({ id: 's28', from: 'Sewanee Admission', fromEmail: 'rep@sewanee.edu', date: '2026-10-21 11:23', subject: "Let's Talk about Sewanee",
      body: 'Hi Kasen, would you like to book a virtual counselor appointment?' }),
    expect: { section: 'junk', cat: 'school', note: 'looks personal, but college not on whitelist' } },
  { e: mail_({ id: 's29', from: 'Chick-fil-A', fromEmail: 'one@email.chick-fil-a.com', date: '2026-10-21 18:57', subject: 'Chick-fil-A® Mobile Ordering Receipt' }), expect: { section: 'junk' } },
  { e: mail_({ id: 's30', from: 'DoorDash', fromEmail: 'no-reply@doordash.com', date: '2026-10-20 19:22', subject: 'Order Confirmation for Kasen from Station Pizzeria' }), expect: { section: 'junk' } },
  { e: mail_({ id: 's31', from: 'LinkedIn', fromEmail: 'messages-noreply@linkedin.com', date: '2026-10-19 18:40', subject: 'Crew Member: Ruppert Landscape and Yacht StarShip are hiring' }), expect: { section: 'junk' } },
  { e: mail_({ id: 's32', from: 'Meta', fromEmail: 'noreply@email.meta.com', date: '2026-10-21 12:49', subject: 'We updated you to a Meta Account on Facebook' }), expect: { section: 'junk' } },
  { e: mail_({ id: 's33', from: 'Southwest Airlines', fromEmail: 'SouthwestAirlines@iluv.southwest.com', date: '2026-10-19 08:19', subject: 'Earn 4X Rapid Rewards® points on a Norwegian cruise!' }), expect: { section: 'junk' } },
  { e: mail_({ id: 's34', from: 'Indeed', fromEmail: 'donotreply@jobalert.indeed.com', date: '2026-10-21 16:52', subject: 'Your job alert for service technician jobs is now active' }), expect: { section: 'junk' } },
  { e: mail_({ id: 's35', from: 'Parchment', fromEmail: 'noreply@mail.parchment.com', date: '2026-10-19 19:04', subject: 'Order Confirmation', body: 'Thank you for your order! Your order was placed successfully on 10/20/2026: Total $6.25' }),
    expect: { section: 'junk', cat: 'school', note: 'school sender, but a receipt' } },
  { e: mail_({ id: 's36', from: 'Google Play', fromEmail: 'googleplay-noreply@google.com', date: '2026-10-16 07:40', subject: 'Updates to Google Play Terms of Service', body: "On November 5, 2026, we're making some changes." }), expect: { section: 'junk' } },
  { e: mail_({ id: 's37', from: 'Cash App', fromEmail: 'cash-app@messages.cash.app', date: '2026-10-16 14:39', subject: 'Come back and skip transfer fees', labels: ['INBOX', 'CATEGORY_PROMOTIONS'] }), expect: { section: 'junk' } },
];

// Deadline extractor unit tests: [text, sent, expected deadlines ('Mon D HH:MM')]
var DEADLINE_CASES = [
  ['Apply by Nov 1', '2026-10-20 10:00', ['Nov 1 23:59']],
  ['Due 10/28', '2026-10-20 10:00', ['Oct 28 23:59']],
  ['Join us Thursday, October 22 for a visit', '2026-10-19 10:00', ['Oct 22 23:59']],
  ['Oct 21 Wed Your virtual interview', '2026-10-19 10:00', ['Oct 21 23:59']],
  ['Can you reply by tomorrow?', '2026-10-22 10:00', ['Oct 23 23:59']],
  ['Your interview is in one hour!', '2026-10-22 15:00', ['Oct 22 16:00']],
  ['Send it by Monday at 5pm', '2026-10-22 10:00', ['Oct 26 17:00']],
  ['Meeting at 3:30pm', '2026-10-22 09:00', ['Oct 22 15:30']],
  ['Info session 7:00 PM ET on Thursday, October 29', '2026-10-20 09:00', ['Oct 29 18:00']],
  ['Complete within 48 hours', '2026-10-21 18:30', ['Oct 23 18:30']],
  ['Order placed 10/21/2026', '2026-10-21 18:00', []],
  ['You may want to look at this', '2026-10-21 18:00', []],
  ["Are we driving up Wednesday or Thursday?", '2026-10-21 18:00', []],
  ['Classes resume Jan 5', '2026-12-15 09:00', ['Jan 5 23:59']],
  ['Support is available 24/7', '2026-10-21 18:00', []],
  ['Thu Oct 22, 2026 3:30pm - 4:30pm (CDT)', '2026-10-20 02:58', ['Oct 22 15:30']],
  ['BRC: October 03&04', '2026-09-28 19:00', ['Oct 3 23:59']],
];

var MON_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtT_(t) {
  if (!t) return null;
  var d = new Date(t);
  return MON_[d.getMonth()] + ' ' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/** Runs every sample + deadline case. Returns { lines: [...], failures: n }. */
function runRuleTests() {
  var cfg = testConfig_(), lines = [], failures = 0;
  var pad = function (s, n) { s = String(s == null ? '–' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s + ' '.repeat(n - s.length); };
  lines.push(pad('', 2) + pad('id', 5) + pad('from', 22) + pad('section', 10) + pad('cat', 7) + pad('kind', 7) + pad('deadline', 14) + pad('code', 8) + 'why');
  SAMPLES.forEach(function (s) {
    var r = classify(s.e, cfg, TEST_NOW), f = r.features, d = r.decision;
    var got = { section: d.section, cat: f.cat, kind: d.kind, deadline: fmtT_(d.deadline), code: f.code || null };
    var bad = Object.keys(s.expect).filter(function (k) { return k !== 'note' && String(s.expect[k]) !== String(got[k]); });
    if (bad.length) failures++;
    lines.push((bad.length ? '✗ ' : '✓ ') + pad(s.e.id, 5) + pad(f.from, 22) + pad(d.section, 10) + pad(f.cat, 7) + pad(d.kind, 7) +
      pad(got.deadline, 14) + pad(f.code === true ? 'link' : f.code, 8) + d.why +
      (bad.length ? '   <-- expected ' + bad.map(function (k) { return k + '=' + s.expect[k]; }).join(', ') : '') +
      (s.expect.note ? '   (' + s.expect.note + ')' : ''));
  });
  lines.push('');
  lines.push('Deadline extraction:');
  DEADLINE_CASES.forEach(function (c) {
    var got = extractDeadlines(c[0], at_(c[1])).map(function (x) { return fmtT_(x.t); });
    var ok = JSON.stringify(got) === JSON.stringify(c[2]);
    if (!ok) failures++;
    lines.push((ok ? '✓ ' : '✗ ') + pad('"' + c[0] + '"', 48) + ' -> ' + (got.join(', ') || 'none') + (ok ? '' : '   <-- expected ' + (c[2].join(', ') || 'none')));
  });
  lines.push('');
  lines.push(failures ? failures + ' FAILED' : 'All passed (' + (SAMPLES.length + DEADLINE_CASES.length) + ' checks)');
  return { lines: lines, failures: failures };
}

/** Apps Script entry point: Run > testRules, then check the execution log. */
function testRules() {
  var r = runRuleTests();
  Logger.log(r.lines.join('\n'));
}

if (typeof module !== 'undefined') module.exports = { runRuleTests: runRuleTests };
