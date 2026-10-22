// Shared mock data + helpers for the Phase 0 HUD concepts.
// All people and addresses here are fake. "Now" is pinned so screenshots are stable.
(function () {
  const NOW = new Date('2026-10-22T16:40:00-05:00'); // Thu Oct 22, 4:40 PM Central
  const LAST_REFRESH = new Date(NOW.getTime() - 4 * 60 * 1000);
  const d = (s) => new Date(s + '-05:00');

  const SECTIONS = [
    { id: 'action', name: 'Needs Reply / Action', short: 'Action' },
    { id: 'urgent', name: 'Urgent', short: 'Urgent' },
    { id: 'important', name: 'Important', short: 'Important' },
    { id: 'fyi', name: 'FYI', short: 'FYI' },
    { id: 'junk', name: 'Junk', short: 'Junk', collapsed: true },
  ];
  const CATS = { school: 'School', work: 'Work', family: 'Family', other: 'Other' };
  const CAT_ORDER = ['school', 'work', 'family', 'other'];

  const EMAILS = [
    // Needs Reply / Action
    { id: 't01', section: 'action', cat: 'school', kind: 'reply', from: 'Dana Whitfield', date: d('2026-10-22T09:14:00'),
      subject: 'Brag sheet + rec letter timeline',
      snippet: 'Hi Kasen — before I start your letters, can you send me your updated brag sheet and activity list? Let me know if Monday works for a quick call.',
      deadline: d('2026-10-26T15:00:00') },
    { id: 't02', section: 'action', cat: 'school', kind: 'action', from: 'Common App', date: d('2026-10-20T10:02:00'),
      subject: 'Additional information needed for your application',
      snippet: 'Your application to Georgia Institute of Technology is missing a required item: School Report. Please complete your submission by Oct 21.',
      deadline: d('2026-10-21T23:59:00') },
    { id: 't03', section: 'action', cat: 'work', kind: 'action', from: 'Harver', date: d('2026-10-21T18:30:00'),
      subject: 'Complete your assessment: Team Member – Publix',
      snippet: "You're almost there! Please complete your online assessment within 48 hours to keep your application active.",
      deadline: d('2026-10-23T18:30:00') },
    { id: 't04', section: 'action', cat: 'work', kind: 'action', from: 'Olivia · Kroger Hiring', date: d('2026-10-22T11:48:00'),
      subject: 'Schedule your interview',
      snippet: 'Hi Kasen! The hiring team would like to meet you. Tap below to pick a time that works for a 15-minute interview.',
      deadline: null },
    { id: 't05', section: 'action', cat: 'family', kind: 'reply', from: 'Mom', date: d('2026-10-22T13:05:00'),
      subject: 'Thanksgiving — which day are you free?',
      snippet: "Grandma wants to know if we're driving up Wednesday or Thursday. Can you check your work schedule and let me know?",
      deadline: null },

    // Urgent
    { id: 't06', section: 'urgent', cat: 'work', kind: null, code: true, from: 'ADP', date: d('2026-10-22T16:34:00'),
      subject: 'Your ADP verification code',
      snippet: "Your verification code is 482913. It expires in 10 minutes. If you didn't request this, you can ignore this email.",
      deadline: null },
    { id: 't07', section: 'urgent', cat: 'school', kind: null, from: 'Edmentum', date: d('2026-10-22T07:00:00'),
      subject: 'English 12 Unit 4 Mastery Test closes tonight',
      snippet: 'Reminder: the Unit 4 Mastery Test closes today at 11:59 PM. Students who have not submitted will receive a zero.',
      deadline: d('2026-10-22T23:59:00') },

    // Important
    { id: 't08', section: 'important', cat: 'school', kind: null, from: 'ACT', date: d('2026-10-22T08:10:00'),
      subject: 'Your October ACT scores are ready',
      snippet: 'Log in to MyACT to view your composite and section scores, and send them to colleges for free until Oct 30.',
      deadline: null },
    { id: 't09', section: 'important', cat: 'school', kind: null, from: 'College Board', date: d('2026-10-21T14:00:00'),
      subject: 'You earned an AP Scholar award',
      snippet: 'Congratulations! Your award now appears on your score report and will be included on reports sent to colleges.',
      deadline: null },
    { id: 't10', section: 'important', cat: 'work', kind: null, from: 'Indeed', date: d('2026-10-21T20:12:00'),
      subject: 'Your application was viewed by Publix',
      snippet: 'Good news — an employer viewed your application for Team Member. Employers often respond within a week.',
      deadline: null },
    { id: 't11', section: 'important', cat: 'family', kind: null, from: 'Dad', date: d('2026-10-21T21:40:00'),
      subject: 'Pics from the lake',
      snippet: 'Got some good ones of you on the dock. Uploaded the rest to the shared album if you want any for your profile.',
      deadline: null },

    // FYI
    { id: 't12', section: 'fyi', cat: 'school', kind: null, from: 'Vanderbilt Admissions', date: d('2026-10-20T15:00:00'),
      subject: 'Apply by Nov 1 for Early Decision I',
      snippet: 'Kasen, the Early Decision I deadline is almost here. Submit your Common App by November 1 to hear back by mid-December.',
      deadline: d('2026-11-01T23:59:00') },
    { id: 't13', section: 'fyi', cat: 'school', kind: null, from: 'Georgia Tech Admission', date: d('2026-10-19T12:00:00'),
      subject: 'Join us Thursday, October 29 for a virtual info session',
      snippet: 'Hear from admission counselors and current Yellow Jackets about academics, co-ops and campus life. 7:00 PM ET.',
      deadline: d('2026-10-29T18:00:00') },
    { id: 't14', section: 'fyi', cat: 'school', kind: null, from: 'Virginia Tech', date: d('2026-10-18T09:30:00'),
      subject: 'Your Hokie application checklist',
      snippet: 'Track your materials anytime in the applicant portal. Most items take 5–7 business days to appear after we receive them.',
      deadline: null },
    { id: 't15', section: 'fyi', cat: 'other', kind: null, from: 'GitHub', date: d('2026-10-22T12:02:00'),
      subject: '[KasenE08/planner] Run failed: pages build and deployment',
      snippet: 'The workflow run for main failed. Job "build" exited with code 1 after 41s.',
      deadline: null },

    // Junk
    { id: 't16', section: 'junk', cat: 'other', from: 'DoorDash', date: d('2026-10-22T12:31:00'), subject: 'Your order from Chipotle is on its way', snippet: 'Track your Dasher in real time.', deadline: null },
    { id: 't17', section: 'junk', cat: 'other', from: 'Steam', date: d('2026-10-22T11:00:00'), subject: 'Midweek Madness: up to 75% off', snippet: 'Items on your wishlist are on sale.', deadline: null },
    { id: 't18', section: 'junk', cat: 'other', from: 'LinkedIn', date: d('2026-10-22T06:15:00'), subject: 'You appeared in 9 searches this week', snippet: 'See who is looking at your profile.', deadline: null },
    { id: 't19', section: 'junk', cat: 'other', from: 'Twitch', date: d('2026-10-21T22:03:00'), subject: 'New login to Twitch', snippet: 'We noticed a new login from Safari on iPhone.', deadline: null },
    { id: 't20', section: 'junk', cat: 'other', from: 'Southwest Airlines', date: d('2026-10-21T10:00:00'), subject: 'Fares from $59 one-way', snippet: 'Book by Oct 27.', deadline: null },
    { id: 't21', section: 'junk', cat: 'other', from: 'Hollister', date: d('2026-10-21T08:00:00'), subject: '48 hrs only: 40% off everything', snippet: 'Your faves, on sale.', deadline: null },
    { id: 't22', section: 'junk', cat: 'school', from: 'Northfield State University', date: d('2026-10-20T08:00:00'), subject: "Kasen, you're invited to apply — fee waived", snippet: 'Your Priority Application is ready.', deadline: null },
  ];

  const DAY = 86400000;
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const WKD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const startOfDay = (t) => { const x = new Date(t); x.setHours(0, 0, 0, 0); return x; };

  function time(t) {
    let h = t.getHours(), m = t.getMinutes();
    const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
    return m ? `${h}:${String(m).padStart(2, '0')} ${ap}` : `${h} ${ap}`;
  }
  function ago(t) {
    const mins = Math.round((NOW - t) / 60000);
    if (mins < 60) return `${mins}m`;
    if (startOfDay(t).getTime() === startOfDay(NOW).getTime()) return `${Math.round(mins / 60)}h`;
    if (startOfDay(NOW) - startOfDay(t) === DAY) return 'Yesterday';
    return `${MON[t.getMonth()]} ${t.getDate()}`;
  }
  // Deadline info: state is overdue | today | tomorrow | week | later
  function deadline(e) {
    if (!e.deadline) return null;
    const t = e.deadline;
    const dayDiff = Math.round((startOfDay(t) - startOfDay(NOW)) / DAY);
    const ms = t - NOW;
    let state, label;
    if (ms < 0) { state = 'overdue'; label = `Overdue · ${MON[t.getMonth()]} ${t.getDate()}`; }
    else if (dayDiff === 0) { state = 'today'; label = `Today ${time(t)}`; }
    else if (dayDiff === 1) { state = 'tomorrow'; label = `Tomorrow ${time(t)}`; }
    else if (dayDiff < 7) { state = 'week'; label = `${WKD[t.getDay()]} ${MON[t.getMonth()]} ${t.getDate()}`; }
    else { state = 'later'; label = `${MON[t.getMonth()]} ${t.getDate()}`; }
    const h = Math.abs(ms) / 3600000;
    const countdown = h < 24 ? `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m` : `${Math.floor(h / 24)}d ${Math.floor(h % 24)}h`;
    return { state, label, countdown, overdue: state === 'overdue', date: t };
  }
  function codeLeft(e) {
    if (!e.code) return null;
    return Math.max(0, 15 - Math.round((NOW - e.date) / 60000));
  }
  function grouped() {
    return SECTIONS.map((s) => ({
      ...s,
      items: EMAILS.filter((e) => e.section === s.id).sort((a, b) =>
        CAT_ORDER.indexOf(a.cat) - CAT_ORDER.indexOf(b.cat) || b.date - a.date),
    }));
  }
  function counts() {
    const action = EMAILS.filter((e) => e.section === 'action').length;
    let week = 0, overdue = 0;
    for (const e of EMAILS) {
      if (e.section === 'junk') continue;
      const dl = deadline(e);
      if (!dl) continue;
      if (dl.overdue) overdue++;
      else if (dl.date - NOW <= 7 * DAY) week++;
    }
    return { action, week, overdue };
  }
  function refreshedAgo() { return `${Math.round((NOW - LAST_REFRESH) / 60000)} min ago`; }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // Click a section header ([data-toggle]) to collapse/expand its body.
  function wireToggles(root = document) {
    root.addEventListener('click', (ev) => {
      const h = ev.target.closest('[data-toggle]');
      if (h) h.closest('[data-section]').classList.toggle('collapsed');
    });
  }

  window.MOCK = { NOW, SECTIONS, CATS, EMAILS, grouped, counts, deadline, codeLeft, ago, time, refreshedAgo, esc, wireToggles, MON, WKD };
})();
