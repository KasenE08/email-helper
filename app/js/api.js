// Talks to the Apps Script backend (Phase 3). In demo mode it returns mock data.
//
// Planned contract (GET only, so no CORS preflight):
//   <scriptUrl>?token=...&action=refresh            -> { ok, done, processed, total, emails: [...], state }
//   <scriptUrl>?token=...&action=hide&id=...        -> { ok }
//   <scriptUrl>?token=...&action=tap&id=...         -> { ok }
//   <scriptUrl>?token=...&action=restore&id=...     -> { ok }
// `done: false` means the first-run chunked scan is still going; the app calls again.

import { makeMock } from './mock-data.js';

export class ApiError extends Error {
  constructor(message, kind) { super(message); this.kind = kind; }
}

export async function refresh(settings) {
  if (settings.demo) {
    await new Promise((r) => setTimeout(r, 600)); // feel like a network call
    return { ok: true, done: true, emails: makeMock(Date.now()) };
  }
  throw new ApiError('Backend not connected yet — that comes in Phase 3. Turn on demo data in Settings to try the app.', 'not-ready');
}

// Fire-and-forget state events. No-op until Phase 3.
export async function sendEvent(settings, action, id) {
  if (settings.demo) return;
  void action; void id;
}
