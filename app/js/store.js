// Everything the app keeps on the phone (localStorage).
// Phase 3 also sends hide/tap/clear events to the Apps Script so state survives
// clearing Safari data; this local copy is the fast path + offline fallback.

const KEYS = { settings: 'eh.settings', state: 'eh.state', cache: 'eh.cache' };

function read(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode / full: ignore */ }
}

const DEFAULT_SETTINGS = { scriptUrl: '', token: '', gmail: '', openIn: 'app', demo: false };
const DEFAULT_STATE = { hidden: {}, cleared: {}, tapped: {}, collapsed: { junk: true } };

export const store = {
  settings: { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) },
  state: { ...DEFAULT_STATE, ...read(KEYS.state, {}) },
  cache: read(KEYS.cache, { emails: [], refreshedAt: 0 }),

  isConfigured() { return !!(this.settings.scriptUrl && this.settings.token); },

  saveSettings(patch) { Object.assign(this.settings, patch); write(KEYS.settings, this.settings); },
  saveState() { write(KEYS.state, this.state); },
  saveCache(emails, refreshedAt) { this.cache = { emails, refreshedAt }; write(KEYS.cache, this.cache); },

  // hidden = long-press / swipe ("Done / Hide"); cleared = tapped + faded out.
  hide(id) { this.state.hidden[id] = Date.now(); this.saveState(); },
  clear(id) { this.state.cleared[id] = Date.now(); this.saveState(); },
  restore(id) { delete this.state.hidden[id]; delete this.state.cleared[id]; delete this.state.tapped[id]; this.saveState(); },
  tap(id) { this.state.tapped[id] = Date.now(); this.saveState(); },
  toggleCollapsed(section) { this.state.collapsed[section] = !this.state.collapsed[section]; this.saveState(); },

  // Most recent hidden/cleared ids, newest first (for the "Recently hidden" list).
  recentlyRemoved(limit = 20) {
    const all = [...Object.entries(this.state.hidden), ...Object.entries(this.state.cleared)];
    return all.sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id, ts]) => ({ id, ts }));
  },

  // Drop state for threads that no longer exist in the inbox data (keeps storage small).
  prune(ids) {
    const keep = new Set(ids);
    for (const k of ['hidden', 'cleared', 'tapped']) {
      for (const id of Object.keys(this.state[k])) if (!keep.has(id)) delete this.state[k][id];
    }
    this.saveState();
  },

  resetAll() {
    for (const k of Object.values(KEYS)) localStorage.removeItem(k);
    this.settings = { ...DEFAULT_SETTINGS };
    this.state = structuredClone(DEFAULT_STATE);
    this.cache = { emails: [], refreshedAt: 0 };
  },
};
