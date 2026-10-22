/**
 * GMAIL — reads threads through the Advanced Gmail Service (read-only scope).
 * Turns each thread into the plain "email" object the rules engine expects.
 */

var META_HEADERS = ['From', 'To', 'Cc', 'Subject', 'List-Unsubscribe', 'Precedence', 'Auto-Submitted'];
var BODY_MAX_CHARS = 6000;

/** Your own address (cached). */
function myEmail_() {
  var props = PropertiesService.getScriptProperties();
  var me = props.getProperty('ME');
  if (!me) { me = Gmail.Users.getProfile('me').emailAddress; props.setProperty('ME', me); }
  return me;
}

/** All inbox threads inside the window: [{ id, historyId }]. */
function listWindowThreads_(cfg) {
  var out = [], token;
  do {
    var res = Gmail.Users.Threads.list('me', {
      q: 'in:inbox newer_than:' + (cfg.WINDOW_DAYS || 60) + 'd',
      maxResults: 500,
      pageToken: token,
    });
    (res.threads || []).forEach(function (t) { out.push({ id: t.id, historyId: String(t.historyId) }); });
    token = res.nextPageToken;
  } while (token);
  return out;
}

function header_(msg, name) {
  var hs = (msg.payload && msg.payload.headers) || [];
  for (var i = 0; i < hs.length; i++) if (hs[i].name.toLowerCase() === name.toLowerCase()) return hs[i].value;
  return '';
}

/** 'Jane Doe <jane@x.com>' -> { name: 'Jane Doe', email: 'jane@x.com' } */
function parseAddress_(s) {
  s = String(s || '');
  var m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  var e = (s.match(/[^\s<>,"]+@[^\s<>,"]+/) || [''])[0];
  return { name: '', email: e.toLowerCase() };
}

function parseList_(s) { return (String(s || '').match(/[^\s<>,"';:]+@[^\s<>,"';:]+/g) || []).map(function (x) { return x.toLowerCase(); }); }

/**
 * Load one thread. Returns:
 *   { skip: true, historyId }  for threads with no incoming mail (notes to self)
 *   email object               otherwise
 */
function loadThread_(id, me, cfg) {
  var t = Gmail.Users.Threads.get('me', id, { format: 'metadata', metadataHeaders: META_HEADERS });
  var msgs = t.messages || [];
  var meN = normEmail(me);
  var isMine = function (m) { return (m.labelIds || []).indexOf('SENT') >= 0 || normEmail(parseAddress_(header_(m, 'From')).email) === meN; };
  var incoming = msgs.filter(function (m) { return !isMine(m); });
  if (!incoming.length) return { skip: true, historyId: String(t.historyId) };

  var last = incoming[incoming.length - 1];
  var lastAny = msgs[msgs.length - 1];
  var from = parseAddress_(header_(last, 'From'));
  var to = parseList_(header_(last, 'To'));
  var labels = {};
  msgs.forEach(function (m) { (m.labelIds || []).forEach(function (l) { labels[l] = 1; }); });

  var email = {
    id: t.id,
    historyId: String(t.historyId),
    from: from.name || from.email,
    fromEmail: from.email,
    to: to,
    toMe: to.some(function (x) { return normEmail(x) === meN; }),
    subject: header_(last, 'Subject') || header_(msgs[0], 'Subject'),
    snippet: last.snippet || '',
    date: Number(last.internalDate),
    labels: Object.keys(labels),
    unread: msgs.some(function (m) { return (m.labelIds || []).indexOf('UNREAD') >= 0; }),
    replied: lastAny !== last && isMine(lastAny) && Number(lastAny.internalDate) > Number(last.internalDate),
    listUnsubscribe: !!header_(last, 'List-Unsubscribe'),
    bulk: /bulk|list|junk/i.test(header_(last, 'Precedence')) || /^auto-/i.test(header_(last, 'Auto-Submitted')),
    body: '',
  };
  if (needsBody_(email, cfg)) {
    try { email.body = loadBody_(last.id); } catch (e) { console.warn('body failed for ' + id + ': ' + e); }
  }
  return email;
}

/** Skip the (slower) body download for obvious junk. */
function needsBody_(email, cfg) {
  var domain = domainOf(email.fromEmail);
  if (inList(email.fromEmail, cfg.FAMILY) || matchesDomain(domain, cfg.COUNSELOR_DOMAINS)) return true;
  if (inList(email.fromEmail, cfg.JUNK_SENDERS) || matchesDomain(domain, cfg.JUNK_DOMAINS)) return false;
  var promo = email.labels.indexOf('CATEGORY_PROMOTIONS') >= 0 || email.labels.indexOf('CATEGORY_SOCIAL') >= 0;
  if (promo && !matchesDomain(domain, cfg.COLLEGE_WHITELIST)) return false;
  return true;
}

/** Plain-text body of one message (prefers text/plain, falls back to HTML). */
function loadBody_(messageId) {
  var m = Gmail.Users.Messages.get('me', messageId, { format: 'full' });
  var plain = [], html = [];
  (function walk(part) {
    if (!part) return;
    var mime = (part.mimeType || '').toLowerCase();
    if (part.body && part.body.data && !part.filename) {
      if (mime === 'text/plain') plain.push(decodePart_(part.body.data));
      else if (mime === 'text/html') html.push(decodePart_(part.body.data));
    }
    (part.parts || []).forEach(walk);
  })(m.payload);
  var text = plain.length ? cleanText(plain.join('\n')) : htmlToText(html.join('\n'));
  return text.slice(0, BODY_MAX_CHARS);
}

/** The Advanced service may hand back base64url text or raw bytes. */
function decodePart_(data) {
  var bytes = typeof data === 'string' ? Utilities.base64DecodeWebSafe(data) : data;
  return Utilities.newBlob(bytes).getDataAsString('UTF-8');
}
