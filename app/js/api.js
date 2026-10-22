// Talks to the Apps Script web app. In demo mode it returns mock data instead.
//
// Contract (GET only, so the browser never sends a CORS preflight):
//   ?token=…&action=ping                       -> { ok, version }
//   ?token=…&action=refresh                    -> { ok, done, processed, total, refreshedAt, emails, removed }
//   ?token=…&action=hide|clear|tap|restore&id= -> { ok }
//   ?token=…&action=read&id=                   -> { ok, thread: { subject, messages: [{ from, date, mine, body }] } }
//   ?token=…&action=rule&key=&section=&cat=    -> { ok }  (sender rules set from the reader)
// done=false means the first-run scan is still going; call refresh again.

import { makeMock } from './mock-data.js';

export class ApiError extends Error {
  constructor(message, kind) { super(message); this.kind = kind; }
}

const REFRESH_TIMEOUT_MS = 120_000; // one chunk is ~40 s of work + Google's overhead
const EVENT_TIMEOUT_MS = 20_000;

async function call(settings, action, params = {}, timeoutMs = EVENT_TIMEOUT_MS) {
  let url;
  try { url = new URL(settings.scriptUrl); } catch { throw new ApiError('The script URL looks wrong. Copy it again from Deploy → Manage deployments (it ends in /exec).', 'bad-url'); }
  url.searchParams.set('token', settings.token);
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { method: 'GET', cache: 'no-store', redirect: 'follow', signal: ctrl.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new ApiError('The script took too long to answer. Tap refresh again; it picks up where it left off.', 'timeout');
    if (!navigator.onLine) throw new ApiError('No internet. Showing your saved emails.', 'offline');
    throw new ApiError("Couldn't reach the script. Check the URL, and that the deployment's access is \"Anyone\".", 'network');
  } finally {
    clearTimeout(timer);
  }

  let data;
  try { data = await res.json(); } catch {
    // Google returns an HTML sign-in page when the web app isn't public.
    throw new ApiError('The script answered with a web page instead of data. In Apps Script, set Deploy → Who has access to "Anyone".', 'not-json');
  }
  if (!data.ok) {
    const msgs = {
      'bad-token': 'Wrong token. Copy it again from the setup() log in Apps Script.',
      busy: 'The script is busy with another refresh. Try again in a moment.',
      'unknown-action': 'The script is out of date. Paste the new code and make a New version in Manage deployments.',
    };
    throw new ApiError(msgs[data.error] || `Script error: ${data.message || data.error}`, data.error || 'server');
  }
  return data;
}

export async function ping(settings) {
  if (settings.demo) return { ok: true, version: 'demo' };
  return call(settings, 'ping');
}

export async function refresh(settings) {
  if (settings.demo) {
    await new Promise((r) => setTimeout(r, 600));
    return { ok: true, done: true, processed: 0, total: 0, refreshedAt: Date.now(), emails: makeMock(Date.now()), removed: [], rules: {} };
  }
  // "busy" usually means a previous chunk is still finishing: wait and retry a few times.
  for (let attempt = 0; ; attempt++) {
    try { return await call(settings, 'refresh', {}, globalThis.__EH_TIMEOUT_MS || REFRESH_TIMEOUT_MS); } // (test hook)
    catch (err) {
      if (err.kind !== 'busy' || attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}

/** Full thread text for the in-app reader. */
export async function read(settings, email) {
  if (settings.demo) {
    await new Promise((r) => setTimeout(r, 400));
    return { id: email.id, subject: email.subject, messages: [{ from: email.from, date: email.date, mine: false,
      body: `${email.snippet}\n\nThis is demo text standing in for the full email. In the real app you see the whole message here, with links you can tap:\n\n⟦https://example.com/demo|Open the link from this email⟧\n\nThanks,\n${email.from}` }] };
  }
  return (await call(settings, 'read', { id: email.id }, 30_000)).thread;
}

/** Save a sender rule (both empty = delete). key: 'a@b.com' or '@b.com'. */
export async function setRule(settings, key, section, cat) {
  if (settings.demo) return { ok: true };
  return call(settings, 'rule', { key, section: section || '', cat: cat || '' });
}

/** hide | clear | tap | restore. Throws on failure (caller queues it for later). */
export async function sendEvent(settings, action, id) {
  if (settings.demo) return { ok: true };
  return call(settings, action, { id });
}
