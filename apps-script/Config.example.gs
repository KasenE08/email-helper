/**
 * CONFIG — every list the rules use.
 *
 * In Apps Script, this file is named "Config.gs". The public repo only has this example
 * with placeholders; your real one (family emails etc.) is never committed.
 *
 * Domains match subdomains too: 'vt.edu' also matches 'admit.vt.edu'.
 * Emails ignore dots/+tags for Gmail addresses.
 * After editing, the next Refresh re-sorts everything automatically.
 *
 * The secret token is NOT here — run setup() once and it's stored in Script Properties.
 */
var CONFIG = {
  // How far back to look in the inbox.
  WINDOW_DAYS: 60,
  // Seconds of work per Refresh call (Apps Script hard limit is 6 min). The app keeps calling until done.
  CHUNK_SECONDS: 40,
  // School/work emails with a deadline this close go to Urgent.
  URGENT_HOURS: 48,
  // Needs-action cards with no deadline that you've already read drop off after this many days.
  ACTION_MAX_AGE_DAYS: 14,

  // ---- People ----
  FAMILY: ['parent1@example.com', 'parent2@example.com'],
  FAMILY_DOMAINS: [],
  COUNSELOR_DOMAINS: ['example-counselor.com'],
  COUNSELOR_EMAILS: [],
  // Name that appears in Calendly / Zoom / Fathom emails about counselor meetings.
  COUNSELOR_NAMES: ['Jane Counselor'],

  // ---- School (category: School) ----
  // Marketing from these colleges goes to FYI. Any other .edu marketing goes to Junk.
  COLLEGE_WHITELIST: ['vanderbilt.edu', 'gatech.edu', 'vt.edu', 'utk.edu', 'umich.edu', 'uah.edu'],
  SCHOOL_DOMAINS: [
    'act.org', 'collegeboard.org', 'parchment.com', 'commonapp.org',
    'edoptionsacademy.com', 'edmentum.com', 'schoology.com',
    // add your school district's domain here (e.g. 'yourdistrict.edu') so it isn't treated as a college
  ],

  // ---- Work (category: Work) ----
  WORK_DOMAINS: ['paradox.ai', 'adp.com', 'indeed.com', 'harver.com'],

  // ---- Other (category: Other, section FYI) ----
  OTHER_DOMAINS: ['github.com'],

  // ---- Senders that are never a real person (bots, schedulers) ----
  AUTOMATED_DOMAINS: ['paradox.ai', 'calendly.com', 'fathom.video', 'schoology.com', 'github.com', 'zoom.us'],

  // ---- Junk ----
  JUNK_DOMAINS: [
    // receipts / orders
    'doordash.com', 'chick-fil-a.com', 'chipotle.com', 'hollisterco.com', 'hollister.com', 'instacart.com',
    'raisingcanes.com', 'sonicdrivein.com', 'ubereats.com', 'grubhub.com', 'starbucks.com',
    // sales / promos
    'steampowered.com', 'southwest.com', 'luv.southwest.com', 'vagaro.com', 'cash.app', 'hm.com',
    // social / accounts
    'linkedin.com', 'facebookmail.com', 'meta.com', 'instagram.com', 'mozilla.org', 'twitch.tv',
    'roblox.com', 'crunchyroll.com', 'ea.com', 'ubisoft.com', 'tiktok.com', 'snapchat.com', 'x.com', 'twitter.com',
    // job-board spam
    'jobalert.indeed.com',
  ],
  // Exact addresses (when the whole domain is too broad, e.g. google.com).
  JUNK_SENDERS: ['googleplay-noreply@google.com', 'noreply-accounts@google.com'],
};
