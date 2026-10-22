# email-helper

Private, rule-based Gmail sorter: a PWA (GitHub Pages) + a Google Apps Script backend. $0, no AI.

**Status:** Phase 2 done: Apps Script backend + rules engine. Phase 3 connects the app to it.

**Setting it up:** see [SETUP.md](SETUP.md).

**App:** https://kasene08.github.io/email-helper/ (add `?demo` to try it with fake emails)

## Layout
- `app/` — the PWA (deployed to Pages by `.github/workflows/pages.yml`)
  - `js/model.js` — sections, sorting, deadline labels, disappear rules (pure logic)
  - `js/store.js` — what's kept on the phone (settings, hidden cards, cache)
  - `js/api.js` — Apps Script calls (stubbed until Phase 3; demo mode returns mock data)
  - `js/mock-data.js` — fake inbox for demo mode + screenshots
  - `js/app.js` — UI, gestures, settings
- `apps-script/` — the Google Apps Script backend
  - `Rules.gs` — **the rules engine** (sections, categories, codes, deadlines). Start here to tweak sorting.
  - `Config.example.gs` — every list the rules use (your real `Config.gs` stays private)
  - `Gmail.gs` — reads Gmail (read-only), `Store.gs` — private data sheet, `Code.gs` — the JSON endpoint
  - `Samples.gs` — fake sample emails + expected results (the test harness)
  - `dist/EmailHelper.gs` — all of the above in one file, for pasting (`node tools/bundle.mjs`)
- `tests/` — `node tests/run-rules.mjs` (rules + deadline cases), `node tests/run-backend.mjs` (whole backend with fake Gmail/Sheets)
- `design/` — Phase 0 concepts, icons, screenshots
- `tools/phase1-shots.mjs` — screenshots the app at iPhone size: `node tools/phase1-shots.mjs`

## Gestures
- **Tap** a card: opens it in Gmail. Cards without a deadline fade out ~10 s after you come back.
- **Hold** or **swipe** a card: hides it now. Undo appears for 5 s; Settings → Recently hidden restores older ones.
- Tap a verification code chip to copy it.
