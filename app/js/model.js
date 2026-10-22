// Pure display logic: no DOM, no storage. Everything time-based takes `now` (ms).
//
// Email shape (what the Apps Script will return, and what mock data uses):
// {
//   id: string            Gmail thread id (used for links + dismiss state)
//   from: string          sender display name
//   subject, snippet: string
//   date: number          ms timestamp of the latest message
//   section: 'action'|'urgent'|'important'|'fyi'|'junk'   decided by the script's rules
//   cat: 'school'|'work'|'family'|'other'
//   kind: 'reply'|'action'|null     only for the action section
//   code: string|true|null  the code ("482913") for code emails, true for login alerts / magic links
//   deadline: number|null ms timestamp of the nearest upcoming deadline
//   deadlineHasTime: bool  false when only a date was found ("Nov 1")
//   moreDeadlines: number  how many other deadlines were found
// }

export const SECTIONS = [
  { id: 'action', name: 'Needs Reply / Action' },
  { id: 'urgent', name: 'Urgent' },
  { id: 'important', name: 'Important' },
  { id: 'fyi', name: 'FYI' },
  { id: 'junk', name: 'Junk' },
];
export const CATS = { school: 'School', work: 'Work', family: 'Family', other: 'Other' };
const CAT_ORDER = ['school', 'work', 'family', 'other'];

const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
export const CODE_URGENT_MS = 15 * MIN;   // codes stay Urgent this long, then drop to Junk
export const OVERDUE_GRACE_MS = DAY;      // overdue cards stay (red) this long, then vanish

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WKD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const dayDiff = (a, b) => Math.round((dayStart(a) - dayStart(b)) / DAY);

export function clock(t) {
  const d = new Date(t);
  let h = d.getHours(); const m = d.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, '0')} ${ap}` : `${h} ${ap}`;
}

// "5m", "3h", "Yesterday", "Oct 19"
export function ago(t, now) {
  const mins = Math.max(0, Math.round((now - t) / MIN));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const dd = dayDiff(now, t);
  if (dd === 0) return `${Math.round(mins / 60)}h`;
  if (dd === 1) return 'Yesterday';
  const d = new Date(t);
  return `${MON[d.getMonth()]} ${d.getDate()}`;
}

export function refreshedLabel(t, now) {
  if (!t) return 'Never refreshed';
  const mins = Math.round((now - t) / MIN);
  if (mins < 1) return 'Refreshed just now';
  if (mins < 60) return `Refreshed ${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `Refreshed ${h} hr ago` : `Refreshed ${Math.round(h / 24)}d ago`;
}

// Deadline label + state. state: overdue | today | tomorrow | week | later
export function deadlineInfo(e, now) {
  if (!e.deadline) return null;
  const t = e.deadline, d = new Date(t), dd = dayDiff(t, now);
  const time = e.deadlineHasTime === false ? '' : ` ${clock(t)}`;
  const md = `${MON[d.getMonth()]} ${d.getDate()}`;
  let state, label;
  if (t < now) { state = 'overdue'; label = `Overdue · ${md}`; }
  else if (dd === 0) { state = 'today'; label = `Due today${time}`; }
  else if (dd === 1) { state = 'tomorrow'; label = `Due tomorrow${time}`; }
  else if (dd < 7) { state = 'week'; label = `Due ${WKD[d.getDay()]} ${md}`; }
  else { state = 'later'; label = `Due ${md}`; }
  if (e.moreDeadlines) label += ` · +${e.moreDeadlines}`;
  return { state, label, overdue: state === 'overdue' };
}

// Minutes left on a verification code's 15-minute Urgent window (null if not a code).
export function codeMinutesLeft(e, now) {
  if (!e.code) return null;
  return Math.max(0, Math.ceil((e.date + CODE_URGENT_MS - now) / MIN));
}

// Section after time-based rules: codes older than 15 min fall to Junk.
export function effectiveSection(e, now) {
  if (e.code && now - e.date > CODE_URGENT_MS) return 'junk';
  return e.section;
}

// Should this card be gone entirely?
// state: { hidden: {id: ts}, cleared: {id: ts} } (see store.js)
export function isGone(e, state, now) {
  if (state.hidden[e.id] || state.cleared[e.id]) return true;
  if (e.deadline && now > e.deadline + OVERDUE_GRACE_MS) return true;
  return false;
}

// Tapping a card clears it (after the fade) only if it has no deadline.
// Deadline cards stay until the deadline passes (or you long-press / swipe them away).
export function clearsOnTap(e) { return !e.deadline; }

export function group(emails, state, now) {
  const visible = emails
    .filter((e) => !isGone(e, state, now))
    .map((e) => ({ ...e, section: effectiveSection(e, now) }));
  return SECTIONS.map((s) => ({
    ...s,
    items: visible
      .filter((e) => e.section === s.id)
      .sort((a, b) => CAT_ORDER.indexOf(a.cat) - CAT_ORDER.indexOf(b.cat) || b.date - a.date),
  }));
}

export function counts(groups, now) {
  let action = 0, week = 0, overdue = 0;
  for (const s of groups) {
    if (s.id === 'junk') continue;
    if (s.id === 'action') action = s.items.length;
    for (const e of s.items) {
      if (!e.deadline) continue;
      if (e.deadline < now) overdue++;
      else if (e.deadline - now <= 7 * DAY) week++;
    }
  }
  return { action, week, overdue };
}
