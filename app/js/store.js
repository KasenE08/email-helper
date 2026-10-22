// Everything the app keeps on the phone (localStorage).
// Hide / tap / clear events are also sent to the Apps Script (the real source of truth),
// so clearing Safari data doesn't bring hidden cards back. Events that fail (offline)
// wait in `pending` and are re-sent before the next refresh.

const KEYS = { settings: 'eh.settings', state: 'eh.state', cache: 'eh.cache', pending: 'eh.pending' };

function read(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode / full: ignore */ }
}

const DEFAULT_SETTINGS = { scriptUrl: '', token: '', gmail: '', openIn: 'app', demo: false };
const DEFAULT_STATE = { hidden: {}, cleared: {}, tapped: {}, collapsed: { junk: true } };
const DEFAULT_CACHE = { emails: [], refreshedAt: 0, removed: [] };

export const store = {
  settings: { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) },
  state: { ...DEFAULT_STATE, ...read(KEYS.state, {}) },
  cache: { ...DEFAULT_CACHE, ...read(KEYS.cache, {}) },
  pending: read(KEYS.pending, []),

  isConfigured() { return !!(this.settings.scriptUrl && this.settings.token); },

  saveSettings(patch) { Object.assign(this.settings, patch); write(KEYS.settings, this.settings); },
  saveState() { write(KEYS.state, this.state); },
  saveCache(patch) { this.cache = { ...this.cache, ...patch }; write(KEYS.cache, this.cache); },

  // hidden = long-press / swipe ("Done / Hide"); cleared = tapped + faded out.
  hide(id) { this.state.hidden[id] = Date.now(); this.saveState(); },
  clear(id) { this.state.cleared[id] = Date.now(); this.saveState(); },
  restore(id) {
    delete this.state.hidden[id]; delete this.state.cleared[id]; delete this.state.tapped[id];
    this.saveState();
    this.cache.removed = (this.cache.removed || []).filter((r) => r.id !== id);
    write(KEYS.cache, this.cache);
  },
  tap(id) { this.state.tapped[id] = Date.now(); this.saveState(); },
  toggleCollapsed(section) { this.state.collapsed[section] = !this.state.collapsed[section]; this.saveState(); },

  queueEvent(action, id) { this.pending.push({ action, id, ts: Date.now() }); write(KEYS.pending, this.pending); },
  setPending(list) { this.pending = list; write(KEYS.pending, list); },

  /**
   * "Recently hidden": what this phone hid + what the script remembers (survives clearing Safari).
   * Newest first: [{ id, ts, from, subject }]
   */
  recentlyRemoved(limit = 30) {
    const byId = new Map();
    for (const r of this.cache.removed || []) byId.set(r.id, r);
    for (const k of ['hidden', 'cleared']) {
      for (const [id, ts] of Object.entries(this.state[k])) {
        const e = this.cache.emails.find((x) => x.id === id);
        const prev = byId.get(id);
        byId.set(id, { id, ts: Math.max(ts, prev?.ts || 0), from: e?.from || prev?.from || '', subject: e?.subject || prev?.subject || '' });
      }
    }
    return [...byId.values()].sort((a, b) => b.ts - a.ts).slice(0, limit);
  },

  /** Drop local state for threads the script no longer returns or remembers. */
  prune(liveIds) {
    const keep = new Set([...liveIds, ...(this.cache.removed || []).map((r) => r.id)]);
    for (const k of ['hidden', 'cleared', 'tapped']) {
      for (const id of Object.keys(this.state[k])) if (!keep.has(id)) delete this.state[k][id];
    }
    this.saveState();
  },

  resetAll() {
    for (const k of Object.values(KEYS)) localStorage.removeItem(k);
    this.settings = { ...DEFAULT_SETTINGS };
    this.state = structuredClone(DEFAULT_STATE);
    this.cache = { ...DEFAULT_CACHE };
    this.pending = [];
  },
};
