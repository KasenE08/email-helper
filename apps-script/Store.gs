/**
 * STORE — everything the script remembers, in a private Google Sheet it creates
 * ("Email Helper Data" in your Drive). You can open it to look, but don't edit it.
 *
 *   threads : one row per inbox thread  [id, historyId, analyzed-features JSON]
 *   state   : cards you hid / tapped     [id, hidden|cleared|tapped, timestamp]
 *   queue   : thread ids still waiting to be processed (first run / big changes)
 */

var DB_NAME = 'Email Helper Data';

function db_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('DB_ID'), ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create(DB_NAME);
    ss.getSheets()[0].setName('threads');
    ss.insertSheet('state');
    ss.insertSheet('queue');
    props.setProperty('DB_ID', ss.getId());
  }
  return ss;
}

function sheet_(name) { var ss = db_(); return ss.getSheetByName(name) || ss.insertSheet(name); }

function readRows_(name) {
  var sh = sheet_(name), n = sh.getLastRow();
  return n ? sh.getRange(1, 1, n, sh.getLastColumn()).getValues() : [];
}

function writeRows_(name, rows, cols) {
  var sh = sheet_(name);
  sh.clearContents();
  if (rows.length) sh.getRange(1, 1, rows.length, cols).setValues(rows);
}

// ---- threads: { id: { h: historyId, f: features } or { h, skip: true } } ----

function loadThreads_() {
  var out = {};
  readRows_('threads').forEach(function (r) {
    if (!r[0]) return;
    try { out[r[0]] = JSON.parse(r[2]); out[r[0]].h = String(r[1]); } catch (e) { /* bad row: re-fetch */ }
  });
  return out;
}

function saveThreads_(map) {
  var rows = Object.keys(map).map(function (id) {
    var c = map[id];
    return [id, c.h, JSON.stringify(c.skip ? { skip: true } : { f: c.f })];
  });
  writeRows_('threads', rows, 3);
}

// ---- state ----

function loadState_() {
  var st = { hidden: {}, cleared: {}, tapped: {} };
  readRows_('state').forEach(function (r) { if (r[0] && st[r[1]]) st[r[1]][r[0]] = Number(r[2]); });
  return st;
}

function saveState_(st) {
  var rows = [];
  ['hidden', 'cleared', 'tapped'].forEach(function (k) {
    Object.keys(st[k]).forEach(function (id) { rows.push([id, k, st[k][id]]); });
  });
  writeRows_('state', rows, 3);
}

// ---- queue ----

function loadQueue_() { return readRows_('queue').map(function (r) { return String(r[0]); }).filter(String); }
function saveQueue_(ids) { writeRows_('queue', ids.map(function (id) { return [id]; }), 1); }

/** Forget all analyzed threads (next refresh re-reads everything). Keeps hide/tap state. */
function resetCache_() {
  writeRows_('threads', [], 3);
  writeRows_('queue', [], 1);
  PropertiesService.getScriptProperties().deleteProperty('SIG');
}
