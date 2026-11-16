# Scoreline

Free, independent fan sports app: live scores and game detail for NFL, College Football, NBA, MLB and F1.
Not affiliated with any league, team or ESPN. Non-commercial (no ads, no paid features).

## Architecture

- **Website** = `index.html` (one file: HTML + CSS + vanilla JS, ~2,900 lines, CRLF line endings) plus
  `account.js` (Firebase accounts, friends, chat; ES module), `sw.js` (service worker: offline cache + web push),
  `manifest.webmanifest`, icons. Hosted on GitHub Pages from `main` (https://cadensauce.github.io/scoreline/).
- **Apps** = Tauri v2 shells (`src-tauri/`) that load the live website, so site changes reach the apps instantly.
  Windows installer + Android APK are built by `.github/workflows/apps.yml` and published as GitHub Releases
  (`build-N`, app version `1.0.N`). Android extras (push via Firebase Cloud Messaging) live in `android/` and are
  copied into the generated Android project during the build.
- **Push worker** = `push/worker.mjs`, run 24/7 by `.github/workflows/push.yml` in 6-hour GitHub Actions shifts.
  Polls ESPN every 20 s, sends alerts by web push (home-screen installs) and FCM (Android app). Secret: `FIREBASE_SA`.
- **Database/auth** = Firebase project `scoreline-41f14` (Spark/free plan). Rules in `firestore.rules`
  (publish by pasting into Firebase console → Firestore → Rules). Collections: users, profiles, usernames,
  requests, chats/messages, pushSubs, public (readable), meta (worker only).
- **Data** = ESPN public JSON (site.api.espn.com, sports.core.api.espn.com, site.web.api.espn.com), OpenF1.
  No API keys. See `docs/research-data-apis.md` for options and licensing.

## Key code landmarks (index.html)

- Tokens: `:root` at the top of `<style>`. Phone layout ≤720px.
- `MOBILE_APP` / `STANDALONE` / `IS_PHONE`: alerts only exist on phones (never desktop).
- `LEAGUES`, `ORDER` (tabs), `render()`, `gameCard()`, `barHtml()`; game sheet `openGame`, field `drawField`,
  win probability `winProb()` (shows ESPN's numbers, not our own model), team page `openTeam`/`drawTeam`.
- Alerts: `ALERT_DEFAULTS`, `alertPrefs`, `wants`, `renderAlerts`, `pushSync`, `checkAlerts`.
- Storage: `store.get/set` → localStorage keys prefixed `scoreline:`.

## Build / run / test

- No local toolchain is required for the site: edit `index.html`, push to `main`, Pages deploys in ~1 min.
- **Bump `<meta name="build" content="…">` on every push** (unix seconds). Open pages compare it and reload.
- **Version (item 17):** `<meta name="version" content="2.0">` in index.html is the one source of truth. Bump it
  (major.minor) for a release. The apps build reads it, so app versions are `major.minor.<build run>`; You → About
  shows "Version 2.0 · Updated <build date>" (+ the app version inside the apps).
- Preview a commit without deploying: load raw.githubusercontent HTML into an iframe `srcdoc` with a
  `<base href="https://cadensauce.github.io/scoreline/">` (set `window.__PREVIEW_APP=1` for phone-app mode).
- Apps: `gh workflow run apps.yml -R cadensauce/scoreline --ref main` (~15 min). Push worker:
  `gh workflow run push.yml -R cadensauce/scoreline`. Health: Firestore `public/push.status` (counts only).
- This machine has no Node or Python; anything that needs them runs in GitHub Actions.
- Tests: none yet (Phase 1 adds Playwright + Firestore-emulator tests run in Actions).

## Conventions

- Every feature ships for every sport, themed per sport. Phone-first; desktop redesign comes with the Windows app.
- No notifications on desktop. Monochrome UI; team colours only as small accents. No ESPN/league branding.
- Plain, friendly wording; same word for the same thing everywhere.
- Never show made-up data: show "not available" instead.
- Ask before pushing large or irreversible changes; commit with clear messages.
- Plan/progress: `PLAN.md`, `PROGRESS.md`. Design reviews: `design-review/round-N/`.
