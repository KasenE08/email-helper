// UI: rendering, refresh loop, gestures (tap / long-press / swipe), toast, settings.
import { CATS, group, counts, deadlineInfo, codeMinutesLeft, clearsOnTap, ago, refreshedLabel } from './model.js';
import { store } from './store.js';
import * as api from './api.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FADE_MS = 10_000;             // tapped card fades this long after you come back
const LONG_PRESS_MS = 500;
const RETURN_WINDOW_MS = 30 * 60e3; // reopening the app within 30 min still fades tapped cards
const MAX_CHUNKS = 60;              // safety cap on one refresh's scan loop

const fading = new Map();           // id -> fade start (ms)
const awaitingReturn = new Set();   // ids opened in Gmail; fade starts when the app is visible again
let gesture = null;
let refreshing = false;

// ---------- Rendering ----------

function render() {
  if (gesture) return; // don't swap DOM under a finger
  const now = Date.now();
  const groups = group(store.cache.emails, store.state, now);
  const c = counts(groups, now);

  $('#refreshed').textContent = refreshing ? 'Refreshing…' : refreshedLabel(store.cache.refreshedAt, now);
  $('#counts').innerHTML =
    `<b>${c.action}</b> need action · <b>${c.week}</b> due this week` +
    (c.overdue ? ` · <span class="bad"><b>${c.overdue}</b> overdue</span>` : '') +
    (store.settings.demo ? '<span class="demo">Demo</span>' : '');

  const total = groups.reduce((n, s) => n + s.items.length, 0);
  if (!total) {
    $('#list').innerHTML = store.cache.refreshedAt
      ? '<div class="empty-all"><b>All clear</b>Nothing needs you right now.</div>'
      : refreshing ? '' : '<div class="empty-all"><b>No emails yet</b>Tap ↻ to load your inbox.</div>';
    $('#hint').hidden = true;
    return;
  }
  $('#hint').hidden = false;
  $('#list').innerHTML = groups.filter((s) => s.items.length).map((s) => `
    <section class="${s.id} ${store.state.collapsed[s.id] ? 'collapsed' : ''}">
      <button class="sh" data-sec="${s.id}" aria-expanded="${!store.state.collapsed[s.id]}">${esc(s.name)} <span class="n">${s.items.length}</span><span class="car">▾</span></button>
      <div class="body">${s.items.map((e) => card(e, s.id, now)).join('')}</div>
    </section>`).join('');
}

function card(e, section, now) {
  const dl = deadlineInfo(e, now);
  const mins = codeMinutesLeft(e, now);
  const fadeStart = fading.get(e.id);
  const cls = ['item', dl?.overdue ? 'overdue' : '', fadeStart ? 'clearing' : ''].join(' ');
  const style = fadeStart ? ` style="--fade-ms:${FADE_MS}ms;--fade-delay:${-(now - fadeStart)}ms"` : '';
  const head = `<div class="r1"><span class="from">${esc(e.from)}</span><span class="time">${ago(e.date, now)}</span></div>
    <div class="subj">${esc(e.subject)}</div>`;
  if (section === 'junk') return `<div class="${cls}" data-id="${esc(e.id)}"${style}>${head}</div>`;

  let right = '';
  if (dl) right = `<span class="due">${esc(dl.label)}</span>`;
  else if (mins !== null && mins > 0) right = `<span class="due">${mins} min left</span>`;
  const chip = typeof e.code === 'string' ? ` <button class="code-chip" data-copy="${esc(e.code)}" aria-label="Copy code">${esc(e.code)}</button>` : '';
  return `<div class="${cls}" data-id="${esc(e.id)}"${style}>${head}
    <div class="snip">${esc(e.snippet)}</div>
    <div class="meta"><span><span class="cat" style="--c:var(--${e.cat})">${CATS[e.cat] || 'Other'}</span>${chip}</span>${right}</div>
  </div>`;
}

function banner(html, kind = '') {
  const b = $('#banner');
  if (!html) { b.hidden = true; return; }
  b.className = `banner ${kind}`;
  b.innerHTML = html;
  b.hidden = false;
}

function progressBanner(processed, total) {
  const pct = total ? Math.round((processed / total) * 100) : 0;
  banner(`Processing inbox… <b>${processed}/${total}</b><div class="bar"><i style="width:${pct}%"></i></div>`);
}

function idleBanner() {
  if (!navigator.onLine && !store.settings.demo) banner('Offline. Showing your saved emails.');
  else if (!store.isConfigured() && !store.settings.demo) banner('Not connected yet. Open <b>Settings</b> to add your script URL and token, or turn on demo data.');
  else banner('');
}

// ---------- Toast ----------

let toastTimer;
function toast(msg, undo) {
  $('#toast-msg').textContent = msg;
  const btn = $('#toast-undo');
  btn.hidden = !undo;
  btn.onclick = () => { hideToast(); undo?.(); };
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, undo ? 5000 : 2600);
}
function hideToast() { $('#toast').classList.remove('show'); }

// ---------- Syncing hide / tap / clear with the script ----------

/** Send an event now; if that fails (offline etc.), queue it for the next refresh. */
function sync(action, id) {
  if (store.settings.demo) return;
  api.sendEvent(store.settings, action, id).catch(() => store.queueEvent(action, id));
}

/** Re-send queued events in order. Stops at the first failure (keeps the rest). */
async function flushPending() {
  if (store.settings.demo || !store.pending.length) return;
  const queue = [...store.pending];
  while (queue.length) {
    try { await api.sendEvent(store.settings, queue[0].action, queue[0].id); queue.shift(); }
    catch { break; }
  }
  store.setPending(queue);
}

// ---------- Actions ----------

const findEmail = (id) => store.cache.emails.find((e) => e.id === id);
const cardEl = (id) => document.querySelector(`.item[data-id="${CSS.escape(id)}"]`);

// Collapse a card's height, then run `done`.
function animateOut(el, done) {
  if (!el) return done();
  el.style.height = `${el.offsetHeight}px`;
  void el.offsetHeight;
  el.classList.add('leaving');
  el.style.height = '0px';
  setTimeout(done, 230);
}

function hideCard(id) {
  fading.delete(id);
  animateOut(cardEl(id), () => {
    store.hide(id);
    sync('hide', id);
    render();
    toast('Hidden', () => restore(id));
  });
}

function restore(id) {
  const cached = !!findEmail(id);
  store.restore(id);
  if (cached || store.settings.demo) { sync('restore', id); render(); return; }
  // The script stopped sending this card while it was hidden: tell it, then refresh to get it back.
  store.queueEvent('restore', id);
  refresh();
}

// Link formats. Which ones open the exact email on iPhone is what Settings → "Test email links" checks.
const LINKS = {
  'app-thread': { label: 'Gmail app · thread link', url: (e) => `googlegmail:///cv=${encodeURIComponent(e.id)}/accountId=1&create-new-tab` },
  'app-thread-plain': { label: 'Gmail app · thread link (short)', url: (e) => `googlegmail:///cv=${encodeURIComponent(e.id)}` },
  app: { label: 'Gmail app · just open the app', url: () => 'googlegmail://' },
  'web-thread': { label: 'Browser · thread', url: (e, s) => `https://mail.google.com/mail/u/${s.gmail ? encodeURIComponent(s.gmail) : '0'}/#all/${encodeURIComponent(e.id)}` },
  'web-msgid': { label: 'Browser · search by Message-ID', url: (e, s) => `https://mail.google.com/mail/u/${s.gmail ? encodeURIComponent(s.gmail) : '0'}/#search/${encodeURIComponent('rfc822msgid:' + (e.msgId || ''))}` },
};
const OPEN_IN = { app: 'app-thread', web: 'web-thread' };

function openLink(url) {
  if (url.startsWith('http')) window.open(url, '_blank', 'noopener');
  else window.location.href = url;
}

function openCard(id) {
  const e = findEmail(id);
  if (!e) return;
  store.tap(id);
  sync('tap', id);
  const clears = clearsOnTap(e, Date.now());

  if (store.settings.demo) {
    toast('Demo: this would open the email in Gmail');
    if (clears) setTimeout(() => startFade(id), 800);
    return;
  }
  if (clears) {
    awaitingReturn.add(id);
    // iOS freezes this page while Gmail is open, so this timer effectively runs once you're back.
    // It's the main trigger: home-screen apps don't reliably fire "you're back" events.
    setTimeout(checkReturn, 1500);
  }
  const kind = LINKS[store.settings.openIn] ? store.settings.openIn : OPEN_IN[store.settings.openIn] || 'app-thread';
  openLink(LINKS[kind].url(e, store.settings));
}

function startFade(id) {
  if (fading.has(id) || store.state.hidden[id] || store.state.cleared[id]) return;
  const start = Date.now();
  fading.set(id, start);
  render();
  setTimeout(() => {
    if (fading.get(id) !== start) return;
    fading.delete(id);
    animateOut(cardEl(id), () => {
      store.clear(id);
      sync('clear', id);
      render();
      toast('Marked done', () => restore(id));
    });
  }, FADE_MS);
}

// Coming back from Gmail: start fading whatever was opened.
function checkReturn() {
  if (document.visibilityState !== 'visible' || !awaitingReturn.size) return;
  for (const id of awaitingReturn) startFade(id);
  awaitingReturn.clear();
  render();
}
document.addEventListener('visibilitychange', checkReturn);
window.addEventListener('pageshow', checkReturn);
window.addEventListener('focus', checkReturn);

/** Backup: anything you opened over a minute ago that never got to fade is cleared now. */
function clearStaleTaps() {
  const now = Date.now();
  for (const [id, ts] of Object.entries(store.state.tapped)) {
    if (store.state.cleared[id] || store.state.hidden[id] || fading.has(id) || awaitingReturn.has(id)) continue;
    const e = findEmail(id);
    if (e && clearsOnTap(e, now) && now - ts > 60e3) { store.clear(id); sync('clear', id); }
  }
}
window.addEventListener('online', () => { idleBanner(); flushPending(); });
window.addEventListener('offline', idleBanner);

async function refresh() {
  if (refreshing) return;
  if (!store.isConfigured() && !store.settings.demo) { openSettings(true); return; }
  refreshing = true;
  $('#refresh-btn').classList.add('spinning');
  banner('');
  render();
  try {
    await flushPending(); // so the script already knows what you hid while offline
    for (let i = 0; i < MAX_CHUNKS; i++) {
      const res = await api.refresh(store.settings);
      store.saveCache({ emails: res.emails, refreshedAt: res.refreshedAt || Date.now(), removed: res.removed || [] });
      if (res.done) {
        store.prune(res.emails.map((e) => e.id));
        clearStaleTaps();
        banner('');
        break;
      }
      progressBanner(res.processed, res.total); // first run: keep going, showing progress
      render();
    }
  } catch (err) {
    banner(esc(err.message), err.kind === 'offline' ? '' : 'error');
  } finally {
    refreshing = false;
    $('#refresh-btn').classList.remove('spinning');
    render();
  }
}

// ---------- Gestures: tap / long-press / swipe ----------

const list = $('#list');

list.addEventListener('click', (ev) => {
  const sec = ev.target.closest('.sh');
  if (sec) { store.toggleCollapsed(sec.dataset.sec); render(); return; }
  const chip = ev.target.closest('.code-chip');
  if (chip) {
    navigator.clipboard?.writeText(chip.dataset.copy).then(() => toast('Code copied'), () => toast('Could not copy'));
  }
});

list.addEventListener('contextmenu', (ev) => { if (ev.target.closest('.item')) ev.preventDefault(); });

list.addEventListener('pointerdown', (ev) => {
  const el = ev.target.closest('.item');
  if (!el || ev.button > 0 || ev.target.closest('.code-chip')) return;
  const g = { el, id: el.dataset.id, x0: ev.clientX, y0: ev.clientY, dx: 0, mode: 'pending', pointerId: ev.pointerId };
  g.pressTimer = setTimeout(() => el.classList.add('pressing'), 120);
  g.lpTimer = setTimeout(() => {
    g.mode = 'longpress';
    el.classList.remove('pressing');
    gesture = null;
    hideCard(g.id);
  }, LONG_PRESS_MS);
  gesture = g;
});

list.addEventListener('pointermove', (ev) => {
  const g = gesture;
  if (!g || ev.pointerId !== g.pointerId) return;
  const dx = ev.clientX - g.x0, dy = ev.clientY - g.y0;
  if (g.mode === 'pending') {
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      g.mode = 'swipe';
      clearTimers(g);
      g.el.classList.remove('pressing');
      g.el.classList.add('dragging');
      g.el.setPointerCapture?.(ev.pointerId);
    } else if (Math.abs(dy) > 10) {
      endGesture(); // it's a scroll
      return;
    }
  }
  if (g.mode === 'swipe') {
    g.dx = dx;
    const w = g.el.offsetWidth;
    g.el.style.transform = `translateX(${dx}px)`;
    g.el.style.opacity = String(1 - Math.min(Math.abs(dx) / w, 1) * 0.8);
  }
});

list.addEventListener('pointerup', (ev) => {
  const g = gesture;
  if (!g || ev.pointerId !== g.pointerId) return;
  clearTimers(g);
  g.el.classList.remove('pressing', 'dragging');
  gesture = null;
  if (g.mode === 'swipe') {
    const w = g.el.offsetWidth;
    if (Math.abs(g.dx) > w * 0.3) {
      g.el.style.transform = `translateX(${Math.sign(g.dx) * w}px)`;
      hideCard(g.id);
    } else {
      g.el.style.transform = '';
      g.el.style.opacity = '';
    }
  } else if (g.mode === 'pending') {
    openCard(g.id);
  }
});

list.addEventListener('pointercancel', () => endGesture());

function clearTimers(g) { clearTimeout(g.pressTimer); clearTimeout(g.lpTimer); }
function endGesture() {
  const g = gesture;
  if (!g) return;
  clearTimers(g);
  g.el.classList.remove('pressing', 'dragging');
  g.el.style.transform = '';
  g.el.style.opacity = '';
  gesture = null;
}

// ---------- Settings ----------

function openSettings(setup = false) {
  const s = store.settings;
  $('#settings-title').textContent = setup ? 'Connect' : 'Settings';
  $('#settings-intro').hidden = !setup;
  $('#settings-done').textContent = setup ? 'Save' : 'Done';
  $('#f-url').value = s.scriptUrl;
  $('#f-token').value = s.token;
  $('#f-gmail').value = s.gmail;
  $('#f-demo').checked = s.demo;
  $('#conn-status').textContent = '';
  $('#conn-status').className = 'conn-status';
  setSeg(LINKS[s.openIn] ? (s.openIn.startsWith('web') ? 'web' : 'app') : s.openIn);
  renderRecent();
  renderLinkTest();
  $('#settings').hidden = false;
  $('#settings').scrollTop = 0;
}

function readForm() {
  return {
    scriptUrl: $('#f-url').value.trim(),
    token: $('#f-token').value.trim(),
    gmail: $('#f-gmail').value.trim(),
    openIn: document.querySelector('#f-openin .on')?.dataset.v || 'app',
    demo: $('#f-demo').checked,
  };
}

function setSeg(v) {
  for (const b of document.querySelectorAll('#f-openin button')) b.classList.toggle('on', b.dataset.v === v);
}

function renderRecent() {
  const items = store.recentlyRemoved();
  $('#recent').innerHTML = items.length
    ? items.map((r) => `<div class="recent-item"><span>${esc(r.from && r.subject ? `${r.from} — ${r.subject}` : r.subject || r.id)}</span><button data-restore="${esc(r.id)}">Restore</button></div>`).join('')
    : '<div class="recent-empty">Nothing hidden.</div>';
}

// Try every link format on one real email; you report which opened the right one.
function renderLinkTest() {
  const emails = store.cache.emails;
  const e = emails.find((x) => !x.code && ['action', 'important'].includes(x.section)) || emails.find((x) => !x.code) || emails[0];
  const box = $('#linktest');
  if (!e || store.settings.demo) {
    box.innerHTML = '<div class="recent-empty">Refresh with your real inbox first.</div>';
    return;
  }
  box.innerHTML = `<div class="lt-email">Testing with: <b>${esc(e.from)}</b> — ${esc(e.subject)}</div>` +
    Object.entries(LINKS).map(([k, l]) => `<button class="lt-btn" data-link="${k}">${esc(l.label)}<span>›</span></button>`).join('') +
    '<div class="lt-note">Tap each one, then come back. Tell Claude which ones opened <i>this exact email</i>.</div>';
  box.dataset.id = e.id;
}

$('#linktest').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-link]');
  if (!b) return;
  const e = findEmail($('#linktest').dataset.id);
  if (e) openLink(LINKS[b.dataset.link].url(e, { ...store.settings, ...readForm() }));
});

$('#recent').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-restore]');
  if (b) { restore(b.dataset.restore); renderRecent(); }
});
$('#f-openin').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) setSeg(b.dataset.v); });

$('#test-conn').addEventListener('click', async () => {
  const st = $('#conn-status');
  st.className = 'conn-status';
  st.textContent = 'Testing…';
  try {
    const r = await api.ping({ ...readForm(), demo: false });
    st.className = 'conn-status ok';
    st.textContent = `✓ Connected (script v${r.version})`;
  } catch (err) {
    st.className = 'conn-status bad';
    st.textContent = err.message;
  }
});

$('#settings-done').addEventListener('click', () => {
  const was = { ...store.settings };
  store.saveSettings(readForm());
  $('#settings').hidden = true;
  const s = store.settings;
  const switched = was.demo !== s.demo || (!s.demo && (was.scriptUrl !== s.scriptUrl || was.token !== s.token));
  if (switched) {
    store.saveCache({ emails: [], refreshedAt: 0, removed: [] }); // never mix demo/real or two accounts
    if (s.demo || store.isConfigured()) refresh();
  }
  idleBanner();
  render();
});

$('#reset-btn').addEventListener('click', () => {
  if (confirm('Clear settings, hidden cards and cached emails on this phone? (Hidden cards stay hidden in the script.)')) {
    store.resetAll();
    location.replace(location.pathname);
  }
});

$('#settings-btn').addEventListener('click', () => openSettings(false));
$('#refresh-btn').addEventListener('click', refresh);

// ---------- Boot ----------

const params = new URLSearchParams(location.search);
if (params.has('demo')) store.saveSettings({ demo: true });

// Tapped cards from a session iOS killed in the background still fade on reopen.
for (const [id, ts] of Object.entries(store.state.tapped)) {
  const e = findEmail(id);
  if (e && clearsOnTap(e) && Date.now() - ts < RETURN_WINDOW_MS && !store.state.cleared[id]) awaitingReturn.add(id);
}
clearStaleTaps();

render();
idleBanner();
if (store.settings.demo && !store.cache.emails.length) refresh();
if (!store.isConfigured() && !store.settings.demo) openSettings(true);
else if (params.has('settings')) openSettings(false);
for (const id of awaitingReturn) startFade(id);
awaitingReturn.clear();
flushPending();

setInterval(render, 30_000); // keep "x min ago", code timers and overdue state fresh

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
