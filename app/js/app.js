// UI: rendering, gestures (tap / long-press / swipe), toast, settings.
import { CATS, group, counts, deadlineInfo, codeMinutesLeft, clearsOnTap, ago, refreshedLabel } from './model.js';
import { store } from './store.js';
import * as api from './api.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FADE_MS = 10_000;          // tapped card fades this long after you come back
const LONG_PRESS_MS = 500;
const RETURN_WINDOW_MS = 30 * 60e3; // reopening the app within 30 min still fades tapped cards

const fading = new Map();        // id -> fade start (ms)
const awaitingReturn = new Set(); // ids opened in Gmail; fade starts when the app is visible again
let gesture = null;
let refreshing = false;

// ---------- Rendering ----------

function render() {
  if (gesture) return; // don't swap DOM under a finger
  const now = Date.now();
  const groups = group(store.cache.emails, store.state, now);
  const c = counts(groups, now);

  $('#refreshed').textContent = refreshedLabel(store.cache.refreshedAt, now);
  $('#counts').innerHTML =
    `<b>${c.action}</b> need action · <b>${c.week}</b> due this week` +
    (c.overdue ? ` · <span class="bad"><b>${c.overdue}</b> overdue</span>` : '') +
    (store.settings.demo ? '<span class="demo">Demo</span>' : '');

  const total = groups.reduce((n, s) => n + s.items.length, 0);
  if (!total) {
    $('#list').innerHTML = store.cache.refreshedAt
      ? '<div class="empty-all"><b>All clear</b>Nothing needs you right now.</div>'
      : '<div class="empty-all"><b>No emails yet</b>Tap refresh to load your inbox.</div>';
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

function connectionBanner() {
  if (!store.isConfigured() && !store.settings.demo) banner('Not connected yet. Open <b>Settings</b> to add your script URL and token, or turn on demo data.');
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
  toastTimer = setTimeout(hideToast, undo ? 5000 : 2200);
}
function hideToast() { $('#toast').classList.remove('show'); }

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
    api.sendEvent(store.settings, 'hide', id);
    render();
    toast('Hidden', () => restore(id));
  });
}

function restore(id) {
  store.restore(id);
  api.sendEvent(store.settings, 'restore', id);
  render();
}

function gmailLink(id) {
  const s = store.settings;
  if (s.openIn === 'app') return `googlegmail:///cv=${encodeURIComponent(id)}/accountId=1&create-new-tab`;
  const acct = s.gmail ? encodeURIComponent(s.gmail) : '0';
  return `https://mail.google.com/mail/u/${acct}/#all/${encodeURIComponent(id)}`;
}

function openCard(id) {
  const e = findEmail(id);
  if (!e) return;
  store.tap(id);
  api.sendEvent(store.settings, 'tap', id);
  const clears = clearsOnTap(e);

  if (store.settings.demo) {
    toast('Demo: this would open the email in Gmail');
    if (clears) setTimeout(() => startFade(id), 800);
    return;
  }
  if (clears) awaitingReturn.add(id);
  const link = gmailLink(id);
  if (link.startsWith('http')) window.open(link, '_blank', 'noopener');
  else window.location.href = link;
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
      api.sendEvent(store.settings, 'clear', id);
      render();
      toast('Marked done', () => restore(id));
    });
  }, FADE_MS);
}

// Coming back from Gmail: start fading whatever was opened.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  for (const id of awaitingReturn) startFade(id);
  awaitingReturn.clear();
  render();
});

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  $('#refresh-btn').classList.add('spinning');
  banner('');
  try {
    const res = await api.refresh(store.settings);
    store.saveCache(res.emails, Date.now());
    if (res.done) store.prune(res.emails.map((e) => e.id));
  } catch (err) {
    banner(esc(err.message), 'error');
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
  setSeg(s.openIn);
  renderRecent();
  $('#settings').hidden = false;
}

function setSeg(v) {
  for (const b of document.querySelectorAll('#f-openin button')) b.classList.toggle('on', b.dataset.v === v);
}

function renderRecent() {
  const items = store.recentlyRemoved();
  $('#recent').innerHTML = items.length
    ? items.map(({ id }) => {
        const e = findEmail(id);
        return `<div class="recent-item"><span>${esc(e ? `${e.from} — ${e.subject}` : id)}</span><button data-restore="${esc(id)}">Restore</button></div>`;
      }).join('')
    : '<div class="recent-empty">Nothing hidden.</div>';
}

$('#recent').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-restore]');
  if (b) { restore(b.dataset.restore); renderRecent(); }
});
$('#f-openin').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) setSeg(b.dataset.v); });

$('#settings-done').addEventListener('click', () => {
  const wasDemo = store.settings.demo;
  store.saveSettings({
    scriptUrl: $('#f-url').value.trim(),
    token: $('#f-token').value.trim(),
    gmail: $('#f-gmail').value.trim(),
    openIn: document.querySelector('#f-openin .on')?.dataset.v || 'app',
    demo: $('#f-demo').checked,
  });
  $('#settings').hidden = true;
  if (wasDemo !== store.settings.demo) {
    store.saveCache([], 0); // never mix demo and real emails
    if (store.settings.demo) refresh();
  }
  banner('');
  connectionBanner();
  render();
});

$('#reset-btn').addEventListener('click', () => {
  if (confirm('Clear settings, hidden cards and cached emails on this phone?')) {
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
  if (e && clearsOnTap(e) && Date.now() - ts < RETURN_WINDOW_MS) awaitingReturn.add(id);
}

render();
connectionBanner();
if (store.settings.demo && !store.cache.emails.length) refresh();
if (!store.isConfigured() && !store.settings.demo) openSettings(true);
else if (params.has('settings')) openSettings(false);
for (const id of awaitingReturn) startFade(id);
awaitingReturn.clear();

setInterval(render, 30_000); // keep "x min ago", code timers and overdue state fresh

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
