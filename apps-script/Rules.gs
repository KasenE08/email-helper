/**
 * RULES ENGINE — decides each email's section, category and deadline.
 *
 * Plain JavaScript with no Apps Script calls, so it also runs in Node
 * (tests/run-rules.mjs) for testing.
 *
 * Two steps:
 *   analyze(email, cfg)        -> "features". Slow part (reads text). Cached per thread.
 *   decide(features, now, cfg) -> section / kind / deadline. Fast. Re-run on every refresh,
 *                                 because "urgent" depends on the current time.
 *   classify(email, cfg, now)  -> both, for tests.
 *
 * Section priority (highest wins): action > urgent > important > fyi > junk.
 * Tweak behavior with the lists in Config.gs; tweak logic with the regexes below.
 */

var RULES_VERSION = 6; // bump to force every cached thread to be re-analyzed

// ======================================================================
// Patterns
// ======================================================================

// Senders that can't be a real person.
var NOREPLY_RE = /(^|[._+-])(no-?reply|do-?not-?reply|donotreply|notifications?|alerts?|mailer|bounce|news(letter)?|updates?|info|hello|admin|support|team|marketing|accounts?|security(services)?|orders?|receipts?|jobs)([._+-]|@)/i;

// Verification codes / magic links / login alerts -> Urgent for 15 min, then Junk.
var CODE_RE = /\b(verification|confirmation|security|access|login|log-in|sign-in|one[- ]time|2fa|two[- ]factor|authentication)\s+code\b|\bpass ?code\b|\botp\b|magic link|sign[- ]in link|log[- ]?in link|verify (your )?e-?mail|confirm (your )?e-?mail/i;
var LOGIN_ALERT_RE = /\bnew (sign[- ]?in|log[- ]?in|device)\b|successful(ly)? log(ged)?[- ]?in|security alert|sign[- ]in attempt|log[- ]?in attempt/i;

// Junk by subject (only for automated senders).
var RECEIPT_RE = /\breceipt\b|order confirmation|confirmation for .* order|thanks for your order|your order\b|order (is|has been) (confirmed|placed|cancelled|canceled|on its way|delivered|ready)|\bdelivery from\b|no-contact delivery|item unavailable|family (cart|order)|check in for your order/i;
var PROMO_RE = /\d+\s?% off|\bsale\b|\bdeals?\b|\bdiscount|\bpromo\b|free shipping|last chance|limited[- ]time|\bpoints\b|rewards|\bsave \$?\d|\boffer\b|black friday|cyber monday/i;
var NOTICE_RE = /terms of (service|use)|privacy (policy|notice)|shared some google account data|updated you to a meta account|your .{0,20}username|settings changes|account (update|changes)|job alert|is popular in your network|you may know|appeared in \d+ searches/i;

// Needs action / reply.
var ACTION_RE = /\b(complete your|please complete|finish your|additional information (is )?needed|information (is )?needed|action (is )?required|please verify|verify your (identity|account|address)|schedule (your|a|an)\b|would like to schedule|register (now|for|by|today)|consent|submit (your|by)|sign (and return|the|your)|fill out|missing (items?|information|documents?)|respond by|rsvp|upload (your|the))/i;
var QUESTION_RE = /\?|let me know|can you\b|could you\b|would you\b|will you\b|please (confirm|reply|respond|send|advise|call|text|let)|\brsvp\b|are you (free|available|able)|get back to me|what do you think/i;
var INVITE_RE = /^(updated )?invitation:/i;
// A later email like this from the same sender means an earlier action was done.
var DONE_RE = /thank you for completing|thanks for completing|we('ve| have) received your|has been received|successfully (submitted|completed)|completed (the|your) (assessment|form)|\bis confirmed\b|\bconfirmed!/i;
// Automated "got it" notes: useful to know, not important -> FYI.
var ACK_RE = /^indeed application:|thank(s| you) for (your )?(application|applying|interest)|application (update|received)|we('ve| have) received your (application|information)|watch .{0,30}videos?|employment update/i;

var TASK_WORDS_RE = /\b(assessment|forms?|application|interview|survey|document|transcript|verification|onboarding)\b/g;

var WORK_WORDS_RE = /\b(interview|application|assessment|position|hiring|job offer|onboarding|shift|employment)\b/i;

// ======================================================================
// Text helpers
// ======================================================================

var ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', reg: '®', copy: '©', trade: '™' };

/** Decode HTML entities, drop invisible padding characters, collapse whitespace. */
function cleanText(s) {
  if (!s) return '';
  return String(s)
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, function (m, e) {
      if (e[0] === '#') {
        var code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isNaN(code) ? m : String.fromCodePoint(code);
      }
      var v = ENTITIES[e.toLowerCase()];
      return v === undefined ? m : v;
    })
    .replace(/[͏​-‏⁠﻿­᠎]/g, '')
    .replace(/[   ]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** Very small HTML -> text converter (good enough for deadline/question scanning). */
function htmlToText(html) {
  return cleanText(String(html || '')
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '));
}

/**
 * Text for the in-app reader: keeps paragraphs, and keeps links as ⟦url|text⟧ markers
 * (the app turns those into tappable links). Never returns HTML.
 */
function htmlToReadable(html) {
  var s = String(html || '')
    .replace(/<(style|script|head|title)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, function (m, url, inner) {
      url = url.replace(/&amp;/g, '&').trim();
      if (!/^(https?:|mailto:)/i.test(url)) return inner;
      var text = inner.replace(/<[^>]+>/g, ' ').replace(/[\[\]|⟦⟧]/g, ' ').replace(/\s+/g, ' ').trim();
      return '⟦' + url.replace(/[|⟧\s]/g, encodeURIComponent) + '|' + (text || 'link') + '⟧';
    })
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return textToReadable(s);
}

/** Clean plain text for the reader without losing paragraph breaks. */
function textToReadable(text) {
  var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map(function (l) { return cleanText(l); });
  var out = [], blank = 0;
  lines.forEach(function (l) {
    if (!l) { blank++; return; }
    if (out.length && blank) out.push('');
    blank = 0;
    out.push(l);
  });
  return out.join('\n');
}

/** Cut quoted replies ("On Mon, X wrote:") so old text doesn't count. Forwards are kept. */
function stripQuoted(body) {
  var cut = String(body || '').search(/\n\s*On .{0,160}wrote:|\n-{2,}\s*Original Message|\nFrom: .*\nSent: /i);
  return cut > 0 ? body.slice(0, cut) : String(body || '');
}

function domainOf(email) { return (String(email || '').split('@')[1] || '').toLowerCase(); }

/** 'vt.edu' matches 'vt.edu' and 'admit.vt.edu'. */
function matchesDomain(domain, list) {
  if (!domain || !list) return false;
  for (var i = 0; i < list.length; i++) {
    var d = String(list[i]).toLowerCase();
    if (domain === d || domain.slice(-d.length - 1) === '.' + d) return true;
  }
  return false;
}

/** Gmail ignores dots and +tags: first.last+x@gmail.com == firstlast@gmail.com */
function normEmail(e) {
  e = String(e || '').toLowerCase().trim();
  var parts = e.split('@');
  if (parts.length !== 2) return e;
  var local = parts[0].split('+')[0];
  if (parts[1] === 'gmail.com' || parts[1] === 'googlemail.com') local = local.replace(/\./g, '');
  return local + '@' + parts[1];
}

function inList(email, list) {
  var n = normEmail(email);
  for (var i = 0; i < (list || []).length; i++) if (normEmail(list[i]) === n) return true;
  return false;
}

// ======================================================================
// AI hook
// ======================================================================

/**
 * Short summary shown on the card. Today: cleaned Gmail snippet (or start of the body).
 * Later: swap the body for an AI call (see README "Plugging in AI summaries").
 * Must return a string; keep it ~200 chars.
 */
function summarize(email) {
  var s = cleanText(email.snippet);
  if (s.replace(/\s/g, '').length < 25) s = cleanText(stripQuoted(email.body)).slice(0, 300);
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > 200 ? s.slice(0, 197).replace(/\s+\S*$/, '') + '…' : s;
}

/**
 * Which summary the card shows. If you add an AI.gs file that defines aiSummarize_(email)
 * and set CONFIG.AI_SUMMARIES = true, it's used (falls back to summarize() on any error).
 * Runs only when a thread is new or changed (results are cached), so API use stays small.
 */
function cardSummary_(email, cfg) {
  if (cfg.AI_SUMMARIES && typeof aiSummarize_ === 'function') {
    try {
      var s = aiSummarize_(email);
      if (s && String(s).trim()) return String(s).trim().slice(0, 300);
    } catch (e) { if (typeof console !== 'undefined') console.warn('AI summary failed: ' + e); }
  }
  return summarize(email);
}

// ======================================================================
// Step 1: analyze (cached)
// ======================================================================

/**
 * email: {
 *   id, from (display name), fromEmail, to: [], cc: [], subject, snippet, body (plain text),
 *   date (ms), labels: [], unread, replied (I sent the latest message), listUnsubscribe, bulk
 * }
 */
function analyze(email, cfg) {
  var fromEmail = String(email.fromEmail || '').toLowerCase();
  var domain = domainOf(fromEmail);
  var subject = cleanText(email.subject);
  var body = cleanText(stripQuoted(email.body || ''));
  var head = (body || cleanText(email.snippet)).slice(0, 1500);
  var labels = email.labels || [];
  var reasons = [];

  var f = {
    v: RULES_VERSION,
    id: email.id,
    from: cleanText(email.from) || fromEmail,
    fromEmail: fromEmail,
    domain: domain,
    subject: subject,
    snippet: cardSummary_(email, cfg),
    date: email.date,
    unread: !!email.unread,
    replied: !!email.replied,
    toMe: email.toMe !== false,
    msgId: email.messageId || '',
    promoLabel: labels.indexOf('CATEGORY_PROMOTIONS') >= 0 || labels.indexOf('CATEGORY_SOCIAL') >= 0,
  };

  // Who sent it
  f.isFamily = inList(fromEmail, cfg.FAMILY) || matchesDomain(domain, cfg.FAMILY_DOMAINS);
  f.isCounselor = !f.isFamily && (matchesDomain(domain, cfg.COUNSELOR_DOMAINS) || inList(fromEmail, cfg.COUNSELOR_EMAILS) ||
    (cfg.COUNSELOR_NAMES || []).some(function (n) { return n && (subject + ' ' + head.slice(0, 400)).toLowerCase().indexOf(n.toLowerCase()) >= 0; }));
  f.automated = NOREPLY_RE.test(fromEmail) || !!email.listUnsubscribe || !!email.bulk || matchesDomain(domain, cfg.AUTOMATED_DOMAINS);
  f.isPerson = !f.automated;
  if (f.isFamily) reasons.push('family');
  if (f.isCounselor) reasons.push('counselor');

  // College?
  var schoolDomain = matchesDomain(domain, cfg.SCHOOL_DOMAINS);
  if (!f.isFamily && !f.isCounselor && !schoolDomain) {
    if (matchesDomain(domain, cfg.COLLEGE_WHITELIST)) f.college = 'whitelist';
    else if (/\.edu$/.test(domain) || /\b(university|college|admissions?)\b/i.test(f.from)) f.college = 'other';
  }

  // Category
  if (f.isFamily) f.cat = 'family';
  else if (f.isCounselor || schoolDomain || f.college) f.cat = 'school';
  else if (matchesDomain(domain, cfg.WORK_DOMAINS)) f.cat = 'work';
  else if (matchesDomain(domain, cfg.OTHER_DOMAINS)) f.cat = 'other';
  else if (WORK_WORDS_RE.test(subject) && !matchesDomain(domain, cfg.JUNK_DOMAINS)) f.cat = 'work';
  else f.cat = 'other';
  f.knownDomain = schoolDomain || f.isCounselor || matchesDomain(domain, cfg.WORK_DOMAINS);

  // Verification code / magic link / login alert (automated senders only)
  var codeText = subject + '\n' + cleanText(email.snippet).slice(0, 300);
  if (f.automated && (CODE_RE.test(codeText) || LOGIN_ALERT_RE.test(subject))) {
    f.code = findCode(codeText) || true;
    reasons.push(f.code === true ? 'login alert / link' : 'code ' + f.code);
  }

  // Junk
  f.junk = null;
  if (!f.isFamily && !f.isCounselor) {
    if (inList(fromEmail, cfg.JUNK_SENDERS) || matchesDomain(domain, cfg.JUNK_DOMAINS)) f.junk = 'junk sender';
    else if (f.automated && RECEIPT_RE.test(subject)) f.junk = 'receipt';
    else if (f.automated && NOTICE_RE.test(subject)) f.junk = 'account notice';
    else if (f.college === 'other') f.junk = 'college not on whitelist';
    else if (f.automated && !f.knownDomain && f.college !== 'whitelist' && PROMO_RE.test(subject)) f.junk = 'promo';
    else if (f.promoLabel && f.college !== 'whitelist' && !f.knownDomain) f.junk = 'Gmail promo/social';
  }
  if (f.junk) reasons.push('junk: ' + f.junk);

  // Needs reply / action
  var collegeMail = f.college === 'whitelist';
  f.invite = INVITE_RE.test(subject);
  // Calendar invites: drop the "Invitation:" prefix and the "(you@gmail.com)" suffix for display.
  if (f.invite) f.subject = subject.replace(INVITE_RE, '').replace(/\s*\([^()]*@[^()]*\)\s*$/, '').trim();
  f.actionHit = !f.junk && !f.code && (ACTION_RE.test(subject) || (!collegeMail && !f.promoLabel && ACTION_RE.test(head.slice(0, 600))));
  f.questionHit = (f.isPerson || f.isFamily) && QUESTION_RE.test(head.slice(0, 1200));
  // "Thanks for completing your assessment" -> remember which kind of task it closes.
  var doneText = subject + ' ' + head.slice(0, 400);
  f.doneWords = DONE_RE.test(doneText) ? (doneText.toLowerCase().match(TASK_WORDS_RE) || []) : [];
  f.taskWords = subject.toLowerCase().match(TASK_WORDS_RE) || [];
  f.ack = ACK_RE.test(subject + ' ' + head.slice(0, 300));

  // Deadlines (not for codes: "expires in 10 minutes" isn't a deadline)
  f.deadlines = f.code ? [] : extractDeadlines(subject + '\n' + head, email.date);
  f.reasons = reasons;
  return f;
}

/** Pull a 4-8 digit code from text, skipping years. */
function findCode(text) {
  var m = text.match(/code(?: is)?[:\s#-]*(\d{4,8})\b/i) || text.match(/^\s*(\d{4,8})\s*[-–:]/);
  if (m) return m[1];
  var all = text.match(/\b\d{4,8}\b/g) || [];
  for (var i = 0; i < all.length; i++) if (!/^(19|20)\d\d$/.test(all[i])) return all[i];
  return null;
}

// ======================================================================
// Step 2: decide (every refresh)
// ======================================================================

var CODE_URGENT_MS = 15 * 60 * 1000;
var OVERDUE_GRACE_MS = 24 * 3600 * 1000;

/**
 * Your sender rules (set from the app's reader). Keys: an address ('a@b.com') or a domain ('@b.com',
 * which also matches subdomains). Values: { section: 'important'|'fyi'|'junk'|'', cat: 'school'|… |'' }.
 */
function senderRule(f, rules) {
  if (!rules) return null;
  if (rules[f.fromEmail]) return rules[f.fromEmail];
  var parts = (f.domain || '').split('.');
  for (var i = 0; i < parts.length - 1; i++) {
    var r = rules['@' + parts.slice(i).join('.')];
    if (r) return r;
  }
  return null;
}

function decide(f, now, cfg, rules) {
  var r = { section: 'fyi', kind: null, deadline: null, deadlineHasTime: false, moreDeadlines: 0, why: '', cat: f.cat, rule: null };

  // Your sender rule's category applies first ("Family" also means: never junk, replies count).
  var rule = senderRule(f, rules);
  if (rule && rule.cat) {
    f = Object.assign({}, f, { cat: rule.cat });
    if (rule.cat === 'family') { f.isFamily = true; f.junk = null; }
    r.cat = rule.cat;
  }

  // Nearest deadline that isn't more than 24 h overdue
  var live = (f.deadlines || []).filter(function (d) { return d.t > now - OVERDUE_GRACE_MS; });
  if (live.length) { r.deadline = live[0].t; r.deadlineHasTime = live[0].hasTime; r.moreDeadlines = live.length - 1; }

  var schoolWork = f.cat === 'school' || f.cat === 'work';
  var urgentHours = cfg.URGENT_HOURS || 48;

  if (f.code) {
    r.section = now - f.date <= CODE_URGENT_MS ? 'urgent' : 'junk';
    r.why = 'code';
  } else if (f.junk) {
    r.section = 'junk'; r.why = f.junk;
  } else if (f.invite) {
    r.section = 'action'; r.kind = 'action'; r.why = 'calendar invite (RSVP)';
  } else if (f.questionHit && f.toMe && !f.replied) {
    r.section = 'action'; r.kind = 'reply'; r.why = 'question from a person';
  } else if (f.actionHit) {
    r.section = 'action'; r.kind = 'action'; r.why = 'action phrase';
  } else if (schoolWork && f.college !== 'whitelist' && r.deadline && r.deadline - now <= urgentHours * 3600e3) {
    r.section = 'urgent'; r.why = 'deadline within ' + urgentHours + 'h';
  } else if (f.automated && f.ack) {
    r.section = 'fyi'; r.why = 'automated acknowledgement';
  } else if (f.isFamily || f.isCounselor || f.isPerson || (schoolWork && f.knownDomain)) {
    r.section = 'important'; r.why = f.isFamily ? 'family' : f.isCounselor ? 'counselor' : f.isPerson ? 'real person' : 'school/work';
  } else {
    r.section = 'fyi'; r.why = f.college === 'whitelist' ? 'whitelisted college' : 'default';
  }

  // Your sender rule's section: Junk always wins; Important/FYI never bury a needed action or urgent item.
  if (rule && rule.section && !f.code) {
    if (rule.section === 'junk') { r.section = 'junk'; r.kind = null; r.why = 'your rule'; }
    else if (r.section !== 'action' && r.section !== 'urgent') { r.section = rule.section; r.why = 'your rule'; }
  }
  if (rule) r.rule = rule;
  return r;
}

function classify(email, cfg, now) {
  var f = analyze(email, cfg);
  var d = decide(f, now, cfg);
  return { features: f, decision: d };
}

/**
 * Is this card still worth showing? (Phone also applies its own hide/tap state.)
 *  - Needs Reply/Action: stays until tapped in the app; reply-type also clears once you replied.
 *    Exception: read + older than ACTION_MAX_AGE_DAYS + no deadline -> dropped (stale).
 *  - Has a deadline: stays until 24 h after it.
 *  - Everything else: only while unread.
 */
function isLive(f, d, now, cfg) {
  if (d.kind === 'reply' && f.replied) return false;
  if (d.deadline) return true;
  if (d.section === 'action') {
    var maxAge = (cfg.ACTION_MAX_AGE_DAYS || 14) * 86400e3;
    return f.unread || now - f.date < maxAge;
  }
  return f.unread;
}

// ======================================================================
// Deadline extraction
// ======================================================================

var MONTHS_RE = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
var WEEKDAYS_RE = 'sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?';
var NUM_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, 'forty-eight': 48, 'twenty-four': 24 };
// Hours to add to convert a time in that zone to Central (script time zone).
var ZONE_SHIFT = { e: -1, c: 0, m: 1, p: 2 };

function monthIndex(s) { return ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(s.slice(0, 3).toLowerCase()); }
function weekdayIndex(s) { return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(s.slice(0, 3).toLowerCase()); }
function numWord(s) { return /^\d+$/.test(s) ? parseInt(s, 10) : NUM_WORDS[s.toLowerCase()]; }
function dayStartOf(ms) { var d = new Date(ms); d.setHours(0, 0, 0, 0); return d; }

/**
 * Find dates/times in text and resolve them against the email's sent time.
 * Returns [{ t: ms, hasTime: bool }] sorted, de-duplicated, only on/after the sent time.
 * Handles: "Nov 1", "November 1st, 2026", "1 Nov", "10/28", "10/28/26", "Thursday, October 22",
 * "Oct 21 Wed", "today", "tonight", "tomorrow", "by Monday at 5pm", "next Tuesday",
 * "in one hour", "within 48 hours", "3:30pm", "7:00 PM ET".
 */
function extractDeadlines(text, sentMs) {
  text = String(text || '');
  var sent = new Date(sentMs);
  var dates = [], times = [], out = [], m, re;

  function inferYear(mon, day) {
    var y = sent.getFullYear();
    var cand = new Date(y, mon, day);
    if (cand.getTime() < sentMs - 60 * 86400e3) y += 1; // "Jan 5" seen in December = next year
    return y;
  }
  function addDate(idx, end, y, mon, day, rel) {
    if (mon < 0 || day < 1 || day > 31) return;
    var probe = new Date(y, mon, day);
    if (probe.getMonth() !== mon) return; // Feb 30 etc.
    dates.push({ idx: idx, end: end, y: y, m: mon, d: day, rel: rel || null });
  }

  // "Nov 1", "November 1st, 2026", "Oct. 21"
  re = new RegExp('\\b(' + MONTHS_RE + ')\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!:)(?:,?\\s*(\\d{4}))?', 'gi');
  while ((m = re.exec(text))) {
    if (/^may$/i.test(m[1]) && !/^May/.test(m[1])) continue; // "you may 3..." -> require capital May
    var mon = monthIndex(m[1]), day = parseInt(m[2], 10);
    addDate(m.index, m.index + m[0].length, m[3] ? parseInt(m[3], 10) : inferYear(mon, day), mon, day);
  }
  // "1 November", "22nd of October"
  re = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(' + MONTHS_RE + ')\\b\\.?(?:,?\\s*(\\d{4}))?', 'gi');
  while ((m = re.exec(text))) {
    if (/^may$/i.test(m[2]) && !/^May/.test(m[2])) continue;
    var mon2 = monthIndex(m[2]), day2 = parseInt(m[1], 10);
    addDate(m.index, m.index + m[0].length, m[3] ? parseInt(m[3], 10) : inferYear(mon2, day2), mon2, day2);
  }
  // "10/28", "10/28/26", "10/28/2026" (US order)
  re = /(?<![\d/.$#:-])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/%])/g;
  while ((m = re.exec(text))) {
    var mon3 = parseInt(m[1], 10) - 1, day3 = parseInt(m[2], 10);
    var y3 = m[3] ? (m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10)) : inferYear(mon3, day3);
    addDate(m.index, m.index + m[0].length, y3, mon3, day3);
  }
  // today / tonight / tomorrow
  re = /\b(today|tonight|tomorrow|tmrw)\b/gi;
  while ((m = re.exec(text))) {
    var base = dayStartOf(sentMs);
    if (/^(tomorrow|tmrw)$/i.test(m[1])) base.setDate(base.getDate() + 1);
    addDate(m.index, m.index + m[0].length, base.getFullYear(), base.getMonth(), base.getDate(), m[1].toLowerCase());
  }
  // "by Monday", "next Tuesday", "this Friday", "on Wed" — plain weekday names are ignored
  // unless qualified or followed by a time ("Monday at 5pm").
  re = new RegExp('\\b(?:(by|on|due|until|before|this|next|this coming|closes|ends|starts)\\s+)?(' + WEEKDAYS_RE + ')\\b\\.?(?=(,?\\s+(?:at\\s+)?\\d{1,2}(?::\\d{2})?\\s*[ap]\\.?m)?)', 'gi');
  while ((m = re.exec(text))) {
    if (!m[1] && !m[3]) continue;
    // Skip if this weekday sits right next to an explicit date ("Thursday, October 22", "Oct 21 Wed").
    var near = text.slice(Math.max(0, m.index - 12), m.index + m[0].length + 16);
    if (new RegExp('(' + MONTHS_RE + ')\\.?\\s+\\d|\\d{1,2}/\\d{1,2}', 'i').test(near)) continue;
    var wd = weekdayIndex(m[2]);
    var b = dayStartOf(sentMs);
    var diff = (wd - b.getDay() + 7) % 7;
    if (diff === 0 && /next/i.test(m[1] || '')) diff = 7;
    b.setDate(b.getDate() + diff);
    addDate(m.index, m.index + m[0].length, b.getFullYear(), b.getMonth(), b.getDate(), 'weekday');
  }
  // "in one hour", "in 30 minutes", "in 2 days", "within 48 hours"
  re = /\b(in|within)\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty|twenty-four|forty-eight|\d{1,3})\s+(minutes?|mins?|hours?|hrs?|days?|weeks?)\b/gi;
  while ((m = re.exec(text))) {
    var n = numWord(m[2]);
    if (!n) continue;
    var unit = m[3].toLowerCase();
    var ms = unit[0] === 'm' ? 60e3 : unit[0] === 'h' ? 3600e3 : unit[0] === 'd' ? 86400e3 : 7 * 86400e3;
    var t = sentMs + n * ms;
    out.push({ t: t, hasTime: !/^d|^w/.test(unit) });
  }
  // Times: "3:30pm", "5 PM", "11:59 p.m.", "7:00 PM ET", "03:30pm (Central Time)", "noon"
  re = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\.?\b(?:\s*\(?\s*(e|c|m|p)(?:s|d)?t\b|\s*\(?\s*(eastern|central|mountain|pacific))?|\b(noon|midnight)\b/gi;
  while ((m = re.exec(text))) {
    var h, mi = 0;
    if (m[6]) { h = m[6].toLowerCase() === 'noon' ? 12 : 23; mi = m[6].toLowerCase() === 'noon' ? 0 : 59; }
    else {
      h = parseInt(m[1], 10); mi = m[2] ? parseInt(m[2], 10) : 0;
      if (h < 1 || h > 12 || mi > 59) continue;
      if (m[3].toLowerCase() === 'p' && h !== 12) h += 12;
      if (m[3].toLowerCase() === 'a' && h === 12) h = 0;
      var zone = (m[4] || (m[5] || '')[0] || 'c').toLowerCase();
      h += ZONE_SHIFT[zone] || 0;
    }
    times.push({ idx: m.index, end: m.index + m[0].length, h: h, mi: mi, used: false });
  }

  // Attach the closest time (within 60 chars before / 45 after) to each date.
  dates.forEach(function (dt) {
    var best = null, bestDist = 1e9;
    times.forEach(function (tm) {
      var dist = tm.idx >= dt.end ? tm.idx - dt.end : dt.idx - tm.end;
      var ok = tm.idx >= dt.end ? dist <= 45 : dist <= 60 && dist >= 0;
      if (ok && dist < bestDist) { best = tm; bestDist = dist; }
    });
    var t, hasTime = !!best;
    if (best) { best.used = true; t = new Date(dt.y, dt.m, dt.d, best.h, best.mi).getTime(); }
    else {
      t = new Date(dt.y, dt.m, dt.d, 23, 59).getTime();
      // A bare date equal to the sent day is usually a timestamp ("Order 10/21/2026"), not a deadline.
      if (!dt.rel && dayStartOf(t).getTime() === dayStartOf(sentMs).getTime()) return;
    }
    out.push({ t: t, hasTime: hasTime });
  });
  // A lone time with no date anywhere ("closes at 11:59 PM") means the sent day.
  if (!dates.length) {
    times.forEach(function (tm) {
      if (tm.used) return;
      var d = dayStartOf(sentMs); d.setHours(tm.h, tm.mi);
      out.push({ t: d.getTime(), hasTime: true });
    });
  }

  // Keep only future-of-sent, plausible deadlines; sort; de-dup.
  var seen = {};
  return out
    .filter(function (d) { return d.t >= sentMs - 3600e3 && d.t <= sentMs + 400 * 86400e3; })
    .sort(function (a, b) { return a.t - b.t; })
    .filter(function (d) { if (seen[d.t]) return false; seen[d.t] = true; return true; });
}

// Node export for tests (ignored inside Apps Script).
if (typeof module !== 'undefined') {
  module.exports = { analyze: analyze, decide: decide, classify: classify, isLive: isLive, extractDeadlines: extractDeadlines, cleanText: cleanText, htmlToText: htmlToText, htmlToReadable: htmlToReadable, summarize: summarize, normEmail: normEmail };
}
