# email-helper

Private, rule-based Gmail sorter: a PWA (GitHub Pages) + a Google Apps Script backend. $0, no AI.

**Status:** Phase 1 done: app shell with demo data. Backend comes in Phase 2.

**App:** https://kasene08.github.io/email-helper/ (add `?demo` to try it with fake emails)

## Layout
- `app/` — the PWA (deployed to Pages by `.github/workflows/pages.yml`)
  - `js/model.js` — sections, sorting, deadline labels, disappear rules (pure logic)
  - `js/store.js` — what's kept on the phone (settings, hidden cards, cache)
  - `js/api.js` — Apps Script calls (stubbed until Phase 3; demo mode returns mock data)
  - `js/mock-data.js` — fake inbox for demo mode + screenshots
  - `js/app.js` — UI, gestures, settings
- `design/` — Phase 0 concepts, icons, screenshots
- `tools/phase1-shots.mjs` — screenshots the app at iPhone size: `node tools/phase1-shots.mjs`

## Gestures
- **Tap** a card: opens it in Gmail. Cards without a deadline fade out ~10 s after you come back.
- **Hold** or **swipe** a card: hides it now. Undo appears for 5 s; Settings → Recently hidden restores older ones.
- Tap a verification code chip to copy it.
