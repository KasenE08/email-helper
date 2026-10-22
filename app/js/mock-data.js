// Realistic fake inbox for demo mode + screenshots. All people/addresses are made up.
// Dates are relative to `now` so the demo always looks current.
export function makeMock(now = Date.now()) {
  const MIN = 60e3, HOUR = 60 * MIN;
  const ago = (ms) => now - ms;
  // A clock time `days` from today, e.g. at(1, 18, 30) = tomorrow 6:30 PM.
  const at = (days, h, m = 0) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d.getTime(); };
  const id = (n) => `demo${String(n).padStart(3, '0')}`;

  return [
    // Needs Reply / Action
    { id: id(1), section: 'action', cat: 'school', kind: 'reply', from: 'Dana Whitfield', date: ago(7 * HOUR),
      subject: 'Brag sheet + rec letter timeline',
      snippet: 'Hi Kasen — before I start your letters, can you send me your updated brag sheet and activity list? Let me know if Monday works for a quick call.',
      deadline: at(4, 15), deadlineHasTime: true },
    { id: id(2), section: 'action', cat: 'school', kind: 'action', from: 'Common App', date: ago(54 * HOUR),
      subject: 'Additional information needed for your application',
      snippet: 'Your application to Georgia Institute of Technology is missing a required item: School Report. Please complete your submission.',
      deadline: ago(16 * HOUR), deadlineHasTime: true },
    { id: id(3), section: 'action', cat: 'work', kind: 'action', from: 'Harver', date: ago(22 * HOUR),
      subject: 'Complete your assessment: Team Member – Publix',
      snippet: "You're almost there! Please complete your online assessment within 48 hours to keep your application active.",
      deadline: at(1, 18, 30), deadlineHasTime: true },
    { id: id(4), section: 'action', cat: 'work', kind: 'action', from: 'Olivia · Kroger Hiring', date: ago(5 * HOUR),
      subject: 'Schedule your interview',
      snippet: 'Hi Kasen! The hiring team would like to meet you. Tap below to pick a time that works for a 15-minute interview.',
      deadline: null },
    { id: id(5), section: 'action', cat: 'family', kind: 'reply', from: 'Mom', date: ago(4 * HOUR),
      subject: 'Thanksgiving — which day are you free?',
      snippet: "Grandma wants to know if we're driving up Wednesday or Thursday. Can you check your work schedule and let me know?",
      deadline: null },

    // Urgent
    { id: id(6), section: 'urgent', cat: 'work', code: '482913', from: 'ADP', date: ago(6 * MIN),
      subject: 'Your ADP verification code',
      snippet: "Your verification code is 482913. It expires in 10 minutes. If you didn't request this, you can ignore this email.",
      deadline: null },
    { id: id(7), section: 'urgent', cat: 'school', from: 'Edmentum', date: ago(10 * HOUR),
      subject: 'English 12 Unit 4 Mastery Test closes tonight',
      snippet: 'Reminder: the Unit 4 Mastery Test closes today at 11:59 PM. Students who have not submitted will receive a zero.',
      deadline: at(0, 23, 59), deadlineHasTime: true },

    // Important
    { id: id(8), section: 'important', cat: 'school', from: 'ACT', date: ago(8 * HOUR),
      subject: 'Your October ACT scores are ready',
      snippet: 'Log in to MyACT to view your composite and section scores, and send them to colleges for free for a limited time.',
      deadline: null },
    { id: id(9), section: 'important', cat: 'school', from: 'College Board', date: ago(26 * HOUR),
      subject: 'You earned an AP Scholar award',
      snippet: 'Congratulations! Your award now appears on your score report and will be included on reports sent to colleges.',
      deadline: null },
    { id: id(10), section: 'important', cat: 'work', from: 'Indeed', date: ago(20 * HOUR),
      subject: 'Your application was viewed by Publix',
      snippet: 'Good news — an employer viewed your application for Team Member. Employers often respond within a week.',
      deadline: null },
    { id: id(11), section: 'important', cat: 'family', from: 'Dad', date: ago(19 * HOUR),
      subject: 'Pics from the lake',
      snippet: 'Got some good ones of you on the dock. Uploaded the rest to the shared album if you want any for your profile.',
      deadline: null },

    // FYI
    { id: id(12), section: 'fyi', cat: 'school', from: 'Vanderbilt Admissions', date: ago(50 * HOUR),
      subject: 'Apply by Nov 1 for Early Decision I',
      snippet: 'The Early Decision I deadline is almost here. Submit your Common App by November 1 to hear back by mid-December.',
      deadline: at(10, 23, 59), deadlineHasTime: false },
    { id: id(13), section: 'fyi', cat: 'school', from: 'Georgia Tech Admission', date: ago(76 * HOUR),
      subject: 'Join us for a virtual info session',
      snippet: 'Hear from admission counselors and current Yellow Jackets about academics, co-ops and campus life. 7:00 PM ET.',
      deadline: at(6, 18), deadlineHasTime: true, moreDeadlines: 1 },
    { id: id(14), section: 'fyi', cat: 'school', from: 'Virginia Tech', date: ago(100 * HOUR),
      subject: 'Your Hokie application checklist',
      snippet: 'Track your materials anytime in the applicant portal. Most items take 5–7 business days to appear after we receive them.',
      deadline: null },
    { id: id(15), section: 'fyi', cat: 'other', from: 'GitHub', date: ago(4.5 * HOUR),
      subject: '[KasenE08/planner] Run failed: pages build and deployment',
      snippet: 'The workflow run for main failed. Job "build" exited with code 1 after 41s.',
      deadline: null },

    // Junk
    { id: id(16), section: 'junk', cat: 'other', from: 'DoorDash', date: ago(4 * HOUR), subject: 'Your order from Chipotle is on its way', snippet: 'Track your Dasher in real time.', deadline: null },
    { id: id(17), section: 'junk', cat: 'other', from: 'Steam', date: ago(5.5 * HOUR), subject: 'Midweek Madness: up to 75% off', snippet: 'Items on your wishlist are on sale.', deadline: null },
    { id: id(18), section: 'junk', cat: 'other', from: 'LinkedIn', date: ago(10 * HOUR), subject: 'You appeared in 9 searches this week', snippet: 'See who is looking at your profile.', deadline: null },
    { id: id(19), section: 'urgent', cat: 'other', code: true, from: 'Twitch', date: ago(18 * HOUR), subject: 'New login to Twitch', snippet: 'We noticed a new login from Safari on iPhone.', deadline: null },
    { id: id(20), section: 'junk', cat: 'other', from: 'Southwest Airlines', date: ago(30 * HOUR), subject: 'Fares from $59 one-way', snippet: 'Book by next week.', deadline: null },
    { id: id(21), section: 'junk', cat: 'other', from: 'Hollister', date: ago(32 * HOUR), subject: '48 hrs only: 40% off everything', snippet: 'Your faves, on sale.', deadline: null },
    { id: id(22), section: 'junk', cat: 'school', from: 'Northfield State University', date: ago(56 * HOUR), subject: "Kasen, you're invited to apply — fee waived", snippet: 'Your Priority Application is ready.', deadline: null },
  ];
}
