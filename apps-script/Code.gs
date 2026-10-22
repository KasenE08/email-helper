/**
 * WEB APP — the JSON endpoint the phone app calls.
 *
 * Deploy as: Execute as "Me", Who has access "Anyone". Every request must carry
 * ?token=<your token> (created by setup(), stored in Script Properties) or it's rejected.
 * GET only, so the browser never sends a CORS preflight.
 *
 *   ?action=ping                    -> { ok, version }
 *   ?action=refresh                 -> { ok, done, processed, total, emails: [...], removed: [...] }
 *                                      done=false: first-run scan still going, call again.
 *   ?action=hide|clear|tap|restore&id=<threadId>   -> { ok }
 *   ?action=hide|clear|tap|restore&ids=<id1,id2,…>   -> { ok }   (batch, e.g. a section's "Clear all")
 *   ?action=read&id=<threadId>      -> { ok, thread: { id, subject, messages: [{ from, date, mine, body }] } }
 *   ?action=rule&key=<a@b.com|@b.com>&section=<important|fyi|junk|>&cat=<school|work|family|other|>
 *                                   -> { ok }   (both empty = delete the rule)
 *   ?action=rescan                  -> forget the cache, re-read everything on next refresh
 *
 * Errors come back as { ok: false, error: 'bad-token' | 'busy' | 'rate-limit' | 'server', message }.
 * A refresh that hit Gmail's rate limit mid-scan returns ok with rateLimited: true (progress saved).
 */

var APP_VERSION = 4;

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (!tokenOk_(p.token)) return json_({ ok: false, error: 'bad-token' });
    switch (p.action || 'ping') {
      case 'ping': return json_({ ok: true, version: APP_VERSION, rules: RULES_VERSION });
      case 'refresh': return json_(refresh_());
      case 'hide': case 'clear': case 'tap': case 'restore': return json_(setState_(p.action, p.ids ? String(p.ids).split(',') : [p.id]));
      case 'rule': return json_(setRule_(p.key, p.section || '', p.cat || ''));
      case 'read':
        if (!p.id || !/^[A-Za-z0-9_-]{2,40}$/.test(p.id)) return json_({ ok: false, error: 'bad-id' });
        return json_({ ok: true, thread: readThread_(p.id) });
      case 'rescan': resetCache_(); return json_({ ok: true });
      default: return json_({ ok: false, error: 'unknown-action' });
    }
  } catch (err) {
    console.error(err);
    if (err && err.rateLimited) return json_({ ok: false, error: 'rate-limit' });
    return json_({ ok: false, error: 'server', message: String((err && err.message) || err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function tokenOk_(t) {
  var real = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!real || !t || String(t).length !== real.length) return false;
  var diff = 0;
  for (var i = 0; i < real.length; i++) diff |= real.charCodeAt(i) ^ String(t).charCodeAt(i);
  return diff === 0;
}

/** Changes to Config or the rules version force a full re-analyze. */
function configSig_(cfg) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(cfg) + '|' + RULES_VERSION);
  return bytes.map(function (b) { return ((b + 256) % 256).toString(16); }).join('');
}

// ======================================================================
// Refresh: scan in time-boxed chunks, then build the card list
// ======================================================================

function refresh_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok: false, error: 'busy' };
  try {
    var cfg = CONFIG, started = Date.now(), budget = (cfg.CHUNK_SECONDS || 40) * 1000;
    var props = PropertiesService.getScriptProperties();
    var cache = loadThreads_();
    var queue = loadQueue_();
    var total = Number(props.getProperty('QUEUE_TOTAL') || 0);

    var dirty = queue.length > 0;
    if (!queue.length) {
      // New pass: queue threads that are new or changed (labels/read state/new replies all bump historyId).
      var sig = configSig_(cfg);
      var full = props.getProperty('SIG') !== sig;
      var inWindow = {};
      listWindowThreads_(cfg).forEach(function (t) {
        inWindow[t.id] = 1;
        var c = cache[t.id];
        if (full || !c || c.h !== t.historyId || (c.f && c.f.v !== RULES_VERSION)) queue.push(t.id);
      });
      Object.keys(cache).forEach(function (id) { if (!inWindow[id]) { delete cache[id]; dirty = true; } });
      if (queue.length) dirty = true;
      total = queue.length;
      props.setProperty('QUEUE_TOTAL', String(total));
      props.setProperty('SIG', sig);
    }

    var me = myEmail_(), rateLimited = false;
    while (queue.length && Date.now() - started < budget) {
      var id = queue[0];
      try {
        var email = loadThread_(id, me, cfg);
        cache[id] = email.skip ? { h: email.historyId, skip: true } : { h: email.historyId, f: analyze(email, cfg) };
      } catch (err) {
        if (err.rateLimited) { rateLimited = true; break; } // keep it queued; the app waits and continues
        console.warn('thread ' + id + ' failed: ' + err); // deleted or broken; next pass retries
        delete cache[id];
      }
      queue.shift();
      dirty = true;
      Utilities.sleep(PACE_MS);
    }

    // Nothing new or changed: skip the (slow) sheet writes.
    if (dirty) {
      saveThreads_(cache);
      saveQueue_(queue);
    }

    var state = loadState_();
    var rules = loadRules_();
    if (!queue.length) pruneState_(state, cache);
    var now = Date.now();
    return {
      ok: true,
      done: !queue.length,
      rateLimited: rateLimited,
      processed: total - queue.length,
      total: total,
      refreshedAt: now,
      emails: buildCards_(cache, state, now, cfg, rules),
      removed: recentlyRemoved_(cache, state),
      rules: rules,
    };
  } finally {
    lock.releaseLock();
  }
}

/** Turn cached features into the card list the phone shows. */
function buildCards_(cache, state, now, cfg, rules) {
  // Which kinds of tasks were later confirmed done, per sender domain ("Thanks for completing your assessment").
  var doneBy = {};
  Object.keys(cache).forEach(function (id) {
    var f = cache[id].f;
    if (!f || !f.doneWords || !f.doneWords.length) return;
    f.doneWords.forEach(function (w) {
      var k = f.domain + '|' + w;
      doneBy[k] = Math.max(doneBy[k] || 0, f.date);
    });
  });

  var items = [];
  Object.keys(cache).forEach(function (id) {
    var f = cache[id].f;
    if (!f || stillApplies_(state.hidden[id], f) || stillApplies_(state.cleared[id], f)) return;
    var d = decide(f, now, cfg, rules);
    if (!isLive(f, d, now, cfg)) return;
    if (d.section === 'action' && d.kind === 'action' && !d.deadline &&
        (f.taskWords || []).some(function (w) { return doneBy[f.domain + '|' + w] > f.date; })) return;
    items.push({ f: f, d: d });
  });

  // Collapse repeat reminders: same section + sender + subject (ignoring "Reminder:", "Re:", "Fwd:") -> newest only.
  items.sort(function (a, b) { return b.f.date - a.f.date; });
  var seen = {};
  items = items.filter(function (x) {
    // Action reminders about the same task ("Complete your form…", "Reminder: Complete your form for…") merge too.
    var task = x.d.section === 'action' && x.f.taskWords && x.f.taskWords.length ? 'task:' + x.f.taskWords.slice().sort().join(',') : '';
    var k = x.d.section + '|' + x.f.domain + '|' + (task || x.f.subject.toLowerCase().replace(/^((re|fwd?|reminder)\s*:\s*)+/g, '').trim());
    if (seen[k]) return false;
    seen[k] = 1;
    return true;
  });

  return items.map(function (x) {
    var f = x.f, d = x.d;
    return {
      id: f.id, msgId: f.msgId || '', from: f.from, fromEmail: f.fromEmail, subject: f.subject, snippet: f.snippet, date: f.date,
      section: d.section, cat: d.cat || f.cat, kind: d.kind, code: f.code || null, opened: stillApplies_(state.tapped[f.id], f),
      deadline: d.deadline, deadlineHasTime: d.deadlineHasTime, moreDeadlines: d.moreDeadlines,
      deadlines: f.deadlines, unread: f.unread,
    };
  });
}

/** Last 30 hidden/cleared cards, for the app's "Recently hidden" list. */
function recentlyRemoved_(cache, state) {
  var all = [];
  ['hidden', 'cleared'].forEach(function (k) {
    Object.keys(state[k]).forEach(function (id) {
      var f = cache[id] && cache[id].f;
      all.push({ id: id, ts: state[k][id], from: f ? f.from : '', subject: f ? f.subject : '' });
    });
  });
  return all.sort(function (a, b) { return b.ts - a.ts; }).slice(0, 30);
}

/** Forget state for threads that left the window. */
function pruneState_(state, cache) {
  var changed = false;
  ['hidden', 'cleared', 'tapped'].forEach(function (k) {
    Object.keys(state[k]).forEach(function (id) { if (!cache[id]) { delete state[k][id]; changed = true; } });
  });
  if (changed) saveState_(state);
}

/** Save (or delete, if both empty) a sender rule set from the app. */
function setRule_(key, section, cat) {
  key = String(key || '').toLowerCase().trim();
  if (!/^(@?[a-z0-9._%+-]+(@[a-z0-9.-]+)?\.[a-z]{2,})$/.test(key)) return { ok: false, error: 'bad-key' };
  if (['', 'important', 'fyi', 'junk'].indexOf(section) < 0 || ['', 'school', 'work', 'family', 'other'].indexOf(cat) < 0) return { ok: false, error: 'bad-rule' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'busy' };
  try {
    var rules = loadRules_();
    if (!section && !cat) delete rules[key];
    else rules[key] = { section: section, cat: cat, ts: Date.now() };
    saveRules_(rules);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** True if you hid / cleared / opened this card AFTER its latest message (a new reply brings it back). */
function stillApplies_(ts, f) { return !!ts && ts >= f.date; }

function setState_(action, ids) {
  ids = (ids || []).filter(function (x) { return x; });
  if (!ids.length || ids.length > 300 || ids.some(function (id) { return !/^[A-Za-z0-9_-]{2,40}$/.test(id); })) return { ok: false, error: 'bad-id' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'busy' };
  try {
    var st = loadState_(), now = Date.now();
    ids.forEach(function (id) {
      if (action === 'restore') { delete st.hidden[id]; delete st.cleared[id]; delete st.tapped[id]; }
      else if (action === 'hide') st.hidden[id] = now;
      else if (action === 'clear') st.cleared[id] = now;
      else if (action === 'tap') st.tapped[id] = now;
    });
    saveState_(st);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ======================================================================
// Functions you run by hand from the Apps Script editor
// ======================================================================

/** Run once. Creates your secret token + the data sheet, and asks for permissions. */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TOKEN');
  if (!token) {
    token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 40);
    props.setProperty('TOKEN', token);
  }
  var ss = db_();
  var me = myEmail_();
  Logger.log('Setup done for ' + me + '\n\nYOUR TOKEN (paste it into the app):\n\n    ' + token + '\n\nData sheet: ' + ss.getUrl());
}

/** Makes a new token (the old one stops working). */
function newToken() {
  PropertiesService.getScriptProperties().deleteProperty('TOKEN');
  setup();
}

/** Scans your inbox (up to ~5 min) and logs where every email landed. Good for tuning Config. */
function previewMyInbox() {
  var r, started = Date.now();
  do { r = refresh_(); if (r.rateLimited) Utilities.sleep(30000); } while (r.ok && !r.done && Date.now() - started < 4.5 * 60e3);
  if (!r.ok) { Logger.log('Error: ' + JSON.stringify(r)); return; }
  var cfg = CONFIG, now = Date.now(), cache = loadThreads_(), rules = loadRules_(), rows = [];
  Object.keys(cache).forEach(function (id) {
    var f = cache[id].f;
    if (!f) return;
    var d = decide(f, now, cfg, rules);
    rows.push({ s: d.section, line: (isLive(f, d, now, cfg) ? '  ' : '· ') + pad_(d.section, 10) + pad_(d.cat, 7) + pad_(f.from, 24) + pad_(f.subject, 50) +
      (d.deadline ? ' [' + new Date(d.deadline).toLocaleString() + ']' : '') + '  — ' + d.why });
  });
  var order = ['action', 'urgent', 'important', 'fyi', 'junk'];
  rows.sort(function (a, b) { return order.indexOf(a.s) - order.indexOf(b.s); });
  Logger.log((r.done ? 'Scan complete. ' : 'Scan still running — run again. ') + r.processed + '/' + r.total + ' processed. "·" = hidden (read / expired).\n\n' +
    rows.map(function (x) { return x.line; }).join('\n'));
}

/** Forget the cache; next refresh re-reads every thread. Hidden cards stay hidden. */
function rescan() { resetCache_(); Logger.log('Cache cleared.'); }

function pad_(s, n) { s = String(s == null ? '' : s); return s.length >= n ? s.slice(0, n - 1) + '… ' : s + ' '.repeat(n - s.length + 1); }
