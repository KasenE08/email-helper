# Email Helper

A private, rule-based Gmail sorter for one person. It's a phone app (PWA on GitHub Pages) plus a Google Apps Script
that reads your Gmail **read-only** and sorts it. **$0, no AI by default, no servers, no tracking.**

**App:** https://kasene08.github.io/email-helper/ (add `?demo` to try it with fake emails)
**Set it up:** [SETUP.md](SETUP.md) (~10 minutes, once)

---

## What it does

Every email in your inbox from the last 60 days lands in one section, highest first:

| Section | What goes there |
|---|---|
| **Needs Reply / Action** | A real person asked you something; forms, assessments, interviews to schedule, RSVPs, consent, "missing items" |
| **Urgent** | Verification codes and sign-in alerts (for 15 min, then Junk); school/work items due within 48 h |
| **Important** | Family, your counselor, real people, school/work updates (scores, transcripts…) |
| **FYI** | Marketing from whitelisted colleges, automated "we got your application" notes, GitHub failures |
| **Junk** (collapsed) | Receipts, promos, social, account notices, colleges not on the whitelist, expired codes |

Each card is also tagged **School / Work / Family / Other** and shows a **deadline** if the email has one
("Due Mon Oct 26", "Overdue · Oct 21" in red).

### When cards disappear
- **Needs Reply / Action, no deadline:** stays until you open it in the app (or reply in Gmail, for questions).
- **Has a deadline:** stays until the deadline passes, red for 24 h after, then gone.
- **Everything else:** gone once read (in the app or in Gmail).
- **Done early?** Hold or swipe a card to hide it. Undo appears for 5 s; Settings → Recently hidden restores older ones.

### Using it
- **Tap a card** to read the full email in the app. Links are tappable, and cards you've opened show **✓ Opened** and gray out.
- **Open Gmail** (in the reader) copies the subject and opens the Gmail app. Paste it into Gmail search to reply.
  (The Gmail iPhone app has no link that opens one specific email, so this is the workaround.)
- **Tap a verification code** to copy it.
- **↻** refreshes. The first run reads in chunks ("Processing inbox… 340/1200"); after that only changes are read.
- **Fix sorting from your phone:** in any email, **Always sort emails from** → pick a section and/or category,
  for that address or the whole domain. Manage these in Settings → Sender rules.
- Hidden, opened and rule state lives in the script, so clearing Safari data loses nothing.

---

## How it works

```
iPhone app (GitHub Pages)  ──GET ?token=…&action=refresh──▶  Apps Script web app (your Google account)
  cards, gestures, reader  ◀──────────── JSON ─────────────   reads Gmail (read-only) → rules → cards
                                                              private "Email Helper Data" sheet:
                                                              cache, hidden/opened state, sender rules
```

- **Security:** the repo is public, so it contains no URLs, tokens or personal addresses. The script refuses any
  request without your secret token. Your family/counselor list lives only in your Apps Script `Config.gs`.
- **6-minute limit:** the script works in ~40-second chunks and resumes; the app keeps calling until done.
- **Refresh is manual only.** No timers or triggers.

## Repo layout
- `app/`: the PWA (deployed to Pages by `.github/workflows/pages.yml` on every push to `main`)
  - `js/model.js`: sections, sorting, deadlines, disappear rules (pure logic)
  - `js/app.js`: UI, gestures, reader, sender rules, settings
  - `js/api.js`: calls to the script (timeouts, retries, friendly errors); `js/store.js`: phone storage
  - `js/mock-data.js`: fake inbox for demo mode
- `apps-script/`: the backend
  - `Rules.gs`: **the rules engine.** Start here to change sorting logic.
  - `Config.example.gs`: every list the rules use (your real `Config.gs` stays private)
  - `Gmail.gs` (reading), `Store.gs` (data sheet), `Code.gs` (the JSON endpoint + editor functions)
  - `Samples.gs`: fake sample emails + expected results (the test harness)
  - `dist/EmailHelper.gs`: all of the above in one file for pasting (`node tools/bundle.mjs`)
  - `AI.example.gs`: optional Gemini summaries (see below)
- `tests/`: `run-rules.mjs` (rules + deadlines + sender rules), `run-backend.mjs` (whole backend vs fake Gmail/Sheets)
- `tools/e2e.mjs`: the real app in Chromium against a local fake Apps Script running the real backend
- `design/`: Phase 0 concepts, icons, and screenshots from every phase

## Run the tests
```bash
node tests/run-rules.mjs      # 61 sample emails / deadline cases / sender rules
node tests/run-backend.mjs    # backend end-to-end with fake Gmail + Sheets
node tools/bundle.mjs --check # paste-file is up to date
node tools/e2e.mjs            # app ↔ backend in a real browser (needs Playwright + Chromium)
```
After changing anything in `apps-script/`, run `node tools/bundle.mjs`, then paste `dist/EmailHelper.gs` into Apps Script
and make a **New version** in Manage deployments.

---

## Plugging in AI summaries (optional, later)

Card summaries come from one function, so AI drops in without a rewrite:

- `summarize(email)` in `Rules.gs` is the default. It returns the cleaned Gmail snippet.
- `cardSummary_()` uses `aiSummarize_(email)` instead **if** an `AI.gs` file defines it **and** `CONFIG.AI_SUMMARIES` is `true`.
  If the AI call fails (quota, network), the card falls back to the normal snippet.
- Summaries are made once per new or changed email and cached, so a typical day is a handful of API calls.
  That fits the Gemini free tier.

**To turn on Gemini:**
1. Get a free API key at **https://aistudio.google.com** (Get API key).
2. In Apps Script: **Project Settings → Script Properties → Add**: `GEMINI_API_KEY` = your key.
3. Add a file **AI.gs** and paste [`apps-script/AI.example.gs`](apps-script/AI.example.gs).
4. In `appsscript.json`, add `"https://www.googleapis.com/auth/script.external_request"` to `oauthScopes`.
5. In `Config.gs`, set `AI_SUMMARIES: true`.
6. Save, **Deploy → Manage deployments → ✏️ → New version → Deploy**, and approve the new permission if asked.
   The next Refresh re-reads everything with AI summaries.

Privacy: this sends each new email's subject and text to Google's Gemini API. On the free tier, Google may use
that data to improve its products. Turn it off any time by setting `AI_SUMMARIES: false`.

Want the reader to show an AI summary too, or use another provider? Only `aiSummarize_` changes; it receives
`{ subject, from, fromEmail, snippet, body, date }` and returns a string.

---

## Limits
- The Gmail iPhone app can't open one specific email from a link. Use the in-app reader, and **Open Gmail** to reply.
- Rules are heuristics. Use sender rules for anything that lands wrong, or tweak `Config.gs` / `Rules.gs`.
- Only the inbox is scanned (archived mail is ignored), up to `WINDOW_DAYS` back.
