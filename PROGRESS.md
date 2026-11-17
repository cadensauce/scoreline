# Scoreline overhaul: progress

## Phase 0 (2026-11-15/16): understand the project. No app code changed.

### Done
- Mapped the repo (see `CLAUDE.md`). There is no test suite yet.
- Research: `docs/research-data-apis.md` (data sources and licences), `docs/research-legal-phase5.md`
  (gambling law, app stores, COPPA, free-tier ledger design).
- Design round 1 published: https://claude.ai/artifact/7GyJvLmrSUSZPFzVYjzkLF (`design-review/round-1/`).
- Phase 5 design doc: `docs/phase5-design.md`.

### Performance baseline (2026-11-16, live site, Chromium desktop machine, 375×812 viewport, warm network)
Measured in the browser with Performance APIs. Lighthouse and real-phone numbers aren't available here
(no Node locally); Phase 1 adds Lighthouse CI in GitHub Actions and a throttled run.

| Metric | Value | Note |
|---|---|---|
| HTML transfer | 66 KB gz (251 KB raw) | one file, no bundle |
| First contentful paint / LCP | 272 ms / 272 ms | desktop CPU |
| CLS | 0.011 | good |
| Time to first scores (fresh load ×3) | 203 / 189 / 141 ms | desktop CPU, warm cache |
| Requests on Home | 50 (46 to ESPN: JSON + logos) | |
| Team logos | 42 images at 500×500 px drawn at 22 px | ~20× more pixels than needed |
| CFB scoreboard JSON | 1,056 KB raw | biggest payload; NFL 238 KB, NBA 161 KB, MLB 20 KB |
| Tab switch (NFL/CFB/NBA/MLB/F1/Home) | 44 / 68 / 134 / 111 / 6 / 126 ms | |
| CFB list scroll, 67 games | 0 of 100 frames over 25 ms | smooth on desktop |
| JS heap | 9 MB → 18 MB after visiting every tab | watch for growth over time |

Read: on a desktop CPU the app is already quick. The slowness you feel on the phone most likely comes from
(1) the 1 MB CFB payload and 42 full-size logos on a phone CPU and mobile network, (2) the app re-downloading
the whole scoreboard every few seconds instead of only what changed, (3) no saved copy of scores to show
instantly at startup, and (4) heavy live game pages (5-second polling, SVG field/shot charts). Phase 1 verifies
this on a throttled phone profile before fixing.

### Bugs and problems found (start of item 16)
1. Installed Android app doesn't reach the push worker yet (0 phones registered; web/worker path verified working).
2. Season-leader stat block wraps its last number onto a second line (pre-game NFL page).
3. Profile button didn't respond once during testing (to reproduce).
4. Game page tabs overflow on a phone; "Timeouts" tab is niche.
5. Live game page shows fouls and the shot chart before the score context and win probability.
6. Pre-game page leads with an empty "Plays will show here…" section.
7. ↻ refresh button duplicates auto-refresh and pull-to-refresh.
8. Logo mark next to SCORELINE looks like a menu button but does nothing.
9. Old team-page star bug left duplicate followed-team entries (cleanup shipped 2026-11-14).
10. Win probability is ESPN's own number (or betting odds before games), not a Scoreline model.
11. Push worker runs 24/7 on GitHub Actions, which GitHub's terms may not allow (see PLAN decisions).

### Design decisions
- Round 1 (2026-11-16): A's open layout (no boxes, hairline rows) + B's rounded touches (floating pill bar, pill buttons, soft top glow).
- Round 2 (2026-11-16): option 1, Inter, airy rows, medium corners. Plain-English status line under the score kept as shown. Marks icon: "Score lines" (rounded square with three lines), shown beside the balance. Applies to every screen from here on.

## Decisions (2026-11-16, from you)
- Design: A's open layout (no boxes, hairline rows) combined with B's rounded touches (floating pill bottom bar,
  pill buttons, soft top glow). Fine-tuned in round 2.
- Everything else: my recommendations. Remove ↻, fake menu mark, per-row stars (follow from team page/Profile)
  and the Timeouts tab (into Plays); Friends + Chat move inside Profile. Keep MLB. Keep team logos for now.
  If our win probability doesn't beat ESPN's for a sport, show ESPN's labelled as ESPN's. Free services only
  (Open-Meteo, YouTube key and CFBD key are free; template recaps, no paid AI). Currency: Marks. Under-13: no
  account, all scores features on-device. Fantasy: NFL, NBA, F1 first. Push worker stays on GitHub Actions for now.
  Reward formula: fixed "Upset bonus" tiers (safer for store ratings).

## Phase 1
### Item 15: alerts on/off (done 2026-11-16)
Root cause: turning alerts OFF never redrew the Alerts screen, so the switch kept showing "on". Also: a failed
"off" request was never retried; phones were saved under their push address, so an address change left an old
entry that kept getting alerts; revoked notification permission still showed "on".
Fix: one `setAlerts()` for both directions; one fixed random device id per phone (`pushSubs/{deviceId}`, old
entries migrated and deleted); pending turn-off retried on launch; permission re-checked on launch; anonymous
setup health codes (`diag/{deviceId}`, summarised by the worker into `public/push.status.setup`).
Tests: Playwright in GitHub Actions (`tests/`), 3 regression tests + a smoke test.
Also fixed on the way: the Android app never registered with the push worker (now registers; health shows
"app 1.0.8 | ok"), and app alerts were sent as data-only FCM messages that a swiped-away app never woke up for.
They are now FCM notification messages that Android shows itself. "Send test notification" now asks the
server for a real push when background alerts are connected; verified on the user's phone with the app closed.
Tested: 4 Playwright tests pass in CI (on/off, reload, offline turn-off retry, smoke); manual phone test passed.

### Item 6: performance, pass 1 (shipped 2026-11-16)
Measured in CI on a simulated mid-range phone (4× slower CPU, fast-4G: 150 ms + ~1.1 MB/s), Home tab,
same ESPN data for both. "Before" = live site at the time, "after" = this change.

| Metric | Before | After | Change |
|---|---|---|---|
| Data downloaded on open | 3,648 KB | 1,534 KB | −58% |
| Team logos | 2,232 KB | 117 KB | −95% |
| Reopen app → scores visible | 2,075 ms | 694 ms | −67% (saved scores shown instantly) |
| Switch to Home tab | 1,713 ms | 522 ms | −70% |
| Switch to NFL / CFB / NBA | 921 / 1,966 / 1,397 ms | 768 / 2,018 / 1,362 ms | about the same (network-bound) |
| First-ever open → scores | 2,053 ms | 2,608 ms | single noisy sample; recheck in pass 2 |
| Memory (JS heap) | 23 MB | 11 MB | −52% |
| Slow frames scrolling CFB (of 84) | 6 | 5 | smooth either way |
| Lighthouse performance (mobile) | 65 | 71 | +6 |
| Layout shift (CLS) | 0.552 | 0.552 | poor: main remaining problem |

Changes: logos via ESPN's resizer at drawn size; only changed game cards are redrawn; last list shown instantly at
startup; list refresh 10 s while live (game pages keep 5 s).
Test infra: ESPN blocks browser requests from GitHub's servers, so tests fetch ESPN with Node and hand the data
to the page; the smoke test now fails if scores don't load. Push worker verified to reach ESPN (startup check).
Next: fix the 0.55 layout shift (biggest Lighthouse cost), recheck first-open time, target Lighthouse 90+.

### Item 6: performance, passes 2–3 (shipped 2026-11-16)
| Metric (phone profile / Lighthouse mobile) | Start of Phase 1 | After pass 1 | After pass 3 |
|---|---|---|---|
| Layout shift (CLS) | 0.552 | 0.552 | **0** (footer no longer jumps) |
| Lighthouse performance | 65 | 71 | **77** |
| Lighthouse first contentful paint | 3.2 s | 2.6 s | ~2 s (varies 1.9–2.6 s run to run) |
| Lighthouse largest contentful paint | 3.2 s | 2.6 s | 5.2 s* |
| Reopen → scores visible (fast 4G) | 2,075 ms | 694 ms | **532 ms** |
| First open → scores (fast 4G) | 2,053 ms | 2,608 ms | 2,106 ms |
| Slow frames scrolling CFB (of 84) | 6 | 5 | **0** |
| Blocking time (TBT) | 10 ms | 10 ms | 0 ms |

Pass 2: main area reserves the screen (CLS), Google Fonts no longer block first paint, Firebase starts after scores
show (or on tapping the account button). Pass 3: fonts use `display=optional` (no late re-paint).

*Why Lighthouse 90+ isn't reachable as things stand: Lighthouse simulates slow 4G (~200 KB/s). The Home screen
needs ~1.4 MB of ESPN scoreboard JSON before scores can paint, which alone takes ~7 s at that speed. LCP is
measured when real scores appear, so it lands at 5–6 s however light the app is. Real phones on normal 4G see
scores in ~2 s on first open and ~0.5 s on every later open (saved scores). Getting Lighthouse 90+ would need a
small proxy that trims ESPN's data (for example a free Cloudflare Worker), which is new infrastructure: asking first.

### Item 16: review fixes, batch 1 (shipped 2026-11-16)
- Player stat rows (season leaders etc.) no longer wrap the last number onto its own line on phones.
- Removed the ↻ refresh button (approved removal): scores refresh on their own; pull down to refresh on phones.
- Profile button: account code now starts Firebase immediately when tapped (it otherwise loads after scores show).
Remaining audit items (tabs, game page order, stars, header, wording, colours) are handled by the Phase 2 redesign.

### Item 14 (UI part): win probability graph (shipped 2026-11-16)
Game pages show current win probability for both teams plus a graph over the whole game (per-play history from
the game summary, so it works after the game too). Drag or tap to see any earlier moment with its play text;
live games refresh it every 15 s. Labelled "ESPN win probability" until our own model passes its backtest
(model work in progress: `model/`, `reports/winprob/`). Screenshot: `design-review/wp-graph-live-mobile.jpg`.

### Phase 2: navigation (item 11) + phone speed fixes (shipped 2026-11-16)
- Bottom bar = Home + pinned sports (default NFL, CFB, F1; up to 4) + You, as a floating rounded bar.
  The You tab holds account, the pinned-sport picker, alerts (phones) and About. Every sport is one tap away
  from chips on Home. Header account button removed (one path to the account). Swipes follow the bar order.
- "App feels slow again" (switching tabs, scrolling) fixes: no live blur behind the bars (repainted every scroll
  frame on phones), top glow limited to the top of the page, tab switches draw instantly from memory when the
  data is under 30 s old, off-screen game cards skip rendering (content-visibility) with real-size estimates.
  CI phone profile: requests on open 41 → 17, logos 105 → 35 KB, JS heap 20 → 17 MB, CLS 0.088 (good < 0.1).
  The memory-hit tab switch isn't measured by CI yet (CI visits each tab once).

### Item 14: win probability models (done for NBA/NFL/CFB; F1 pending live data) — 2026-11-16
Backtest (held-out 2023–25 seasons, `reports/winprob/REPORT.md`, calibration charts included):
| Sport | Brier ours / ESPN | Shown in app |
|---|---|---|
| NBA | 0.1459 / 0.1482 (ours, fed ESPN's opening number; better in all 3 seasons; smaller swings) | **Scoreline model** |
| NFL | 0.1545 / 0.1534 | ESPN's, labelled |
| CFB | 0.1249 / 0.1253 (tie within noise) | ESPN's, labelled |
| F1 | 0.279 vs 0.361 simple baseline (ESPN has none) | needs live gaps: OpenF1 live is paid; trying ESPN's live order at Las Vegas GP |
NBA game pages compute per-play win probability with `models/wp.js` and label it "Scoreline win probability";
falls back to ESPN's if inputs are missing. Tests: model sanity (even game ~50%, +20 with 1:00 left >97%) and a
real finished game page shows the Scoreline label. Retrain weekly in season: `gh workflow run winprob.yml`.

### User-requested additions (2026-11-16)
- Version counter (item 17): `<meta name="version">` is the one source; apps build as major.minor.<run>; shown in You → About.
- Polish batch: new monochrome logo everywhere (one source `icon-512.png`; tab icon, Android/Windows icons,
  branded Windows installer sidebar/header/setup icon), centred name on phones, Home shows only pinned sports,
  no flicker switching day/week/filter, graph drag updates the big numbers, stat rows never overlap, career ring fits.
- Account: email hidden until password re-entry (30 s).
- Sign in with a code: website → newly installed app, one-time 10-minute codes; worker issues a Firebase custom token.
- Two-step sign-in (opt-in, emailed 6-digit codes): enforced by Firestore rules (`member()` = signed in and, if
  twoStep/{uid} exists, a token with `ts` claim). Worker emails codes via a Scoreline Gmail app password
  (secrets SMTP_USER / SMTP_PASS — waiting on the user), 10-minute codes, 5 tries, 1 request/minute.
  Text-message codes were declined (needs the paid Firebase plan).
- Apps rebuilt: build-10 (2.0.10) with the new icon and installer art.

## Where we stopped (2026-11-16, end of day)
Live on main: design system (Inter, monochrome), pinned-sport nav + You tab, speed fixes, NBA win-probability
model + graph, version 2.0, new logo everywhere, email lock, sign-in codes, two-step email codes (needs secrets),
graph drag no longer swipes categories. Apps: build-11/12 (2.0.x) with new icon.

Next session, in order:
1. **Installer with personality** (user: "needs to feel unique, not a covered-up Windows installer"). The dark
   one-click NSIS template is on branch `dark-installer` (NOT merged; releases build-11/12 were built from it).
   NSIS can't go much further. Real options: (a) a small custom Scoreline setup app (Tauri/WebView window we design
   fully: animated logo, progress, "Open Scoreline") that downloads/extracts the app and writes the shortcut and
   uninstall entry; (b) NSIS with a fully custom nsDialogs page (images + our own drawn progress). Propose (a) with
   pictures first (design round), then build.
2. Two-step sign-in: user to create a Scoreline Gmail + app password and add secrets SMTP_USER / SMTP_PASS; then
   restart the push worker (`gh workflow run push.yml`) and test end to end.
3. Phase 2 continues: list/home redesign to open rows (no per-row stars, one filter row), game page order
   (status line, win probability first, tabs Summary/Plays/Stats/Players), design round 3, themes (light/dark),
   profile customization; then Phases 3–5 per PLAN.md.
4. F1 win probability needs live gaps (OpenF1 live is paid): try ESPN live order at the Las Vegas GP (Nov 21–22).

### Custom installer and uninstaller (2026-11-16, shipped)
- `setup-app/`: "Scoreline Setup", a frameless Tauri window (design: "every sport lights up", picked from three
  animated concepts). Carries the real NSIS installer, runs it silently with progress, opens Scoreline after.
  Copies itself next to the app and makes Windows' Uninstall button open it (`--uninstall`): asks first
  (optional "delete my settings on this PC"), the sports switch off while it removes the app, then
  "Scoreline is removed". Runs from a temp copy and cleans up after itself.
- The NSIS installer underneath uses a dark one-click template (`src-tauri/installer/installer.nsi`, CLI pinned
  to 2.12.4). Get the app (Windows) and in-app updates download `Scoreline-Setup.exe`. Verified on the user's PC:
  install 2.0.16, uninstall, reinstall.

### Phase 2: list/game redesign + themes (2026-11-16, shipped)
- Score rows: open rows on hairlines (no boxes, no per-row star buttons; small ★ on followed teams), live = still
  dot, one filter row + search icon, Week/Day kept (Week default). Day switching keeps the day row in place.
- Game page: score → plain-English status line ("Bengals lead by 21 at halftime. Teams in this spot win about 98%
  of the time.") → tabs Summary/Plays/Stats/Players (timeouts inside Plays) → win probability first.
- Design round 3 published (live screens). Themes (item 9): You → Appearance: System / Dark / Light on the same
  tokens; light contrast text 16.9:1, muted 5.4:1; applied before first paint.

### Phase 2 polish pass + Phase 3 start (2026-11-16, shipped)
- Polish: finished games show Final in the score bar; calmer latest-play headline; graph readout doesn't repeat
  "END GAME"; league label only in mixed lists; TV channel as plain text. (A syntax error from a scripted edit was
  caught by the tests before going live and fixed.)
- Item 28, possession on score rows: live football shows a monochrome ball next to the team with the ball and
  down & distance + red-zone hint under the clock; NBA only when ESPN's data includes possession. Tests render a
  live and a finished row.
- Item 19, Closest Games filter: live by closeness to 50/50 (ESPN's live number, our NBA model, else score gap),
  upcoming by most even matchup from our own team ratings (no betting lines), finished last. Test checks order.
- Profile cards rule still to publish (needs the user's Google sign-in in the browser pane).

## Phase 3 continued (2026-11-16, shipped)
- Weather for outdoor games (NFL/CFB/MLB + F1 track; Open-Meteo, credited; domes skipped) — #26
- Standings + playoff picture (cut lines) for NFL/CFB/NBA/MLB — #27
- Follow players and F1 drivers; "Your players" on Home; app splash uses the new mark — #28
- Quiet hours for alerts (phone time zone; worker honours it) — #29
- Kick graphic (goalposts from behind the kicker, animated: through / wide / doink / short / blocked) — #31, #36
- Heat map view (List / Heat map switch, shade = closeness to 50/50) — #32
- Possession icons for every sport (game header, lists, tiles) — #33, #34
- Field redesign: broadcast-style side-on field, camera follows the play, passes in three beats
  (route → throw → catch + run after, or miss next to the receiver), curvy runs, kicks/returns,
  triangle defenders shown once, penalties as a flag, players fade after the play, Replay,
  arrows step plays across drives, cleaner play card — #35–#42
- Developer-only phone preview (You → Developer; owner's account only, checked by email hash) — #37
- Still to do in Phase 3: strategy picker. Pending from you: Google sign-in to publish the profile-card rule;
  Gmail app password + SMTP secrets for two-step codes.

## 2026-11-17: polish, Phase 4 wrap-up, Phase 5 start (PRs #57–#84)
- Phase 4: Dummy Mode everywhere + every position explained (tap-to-explain), NBA scoring runs, F1 qualifying gaps,
  CFB AP Top 25, MLB starting pitchers, labeled Standings button, Recap tab, play-by-play grouped by drive,
  highlights (game video clips, open on the video site), predicted vs actual on far more games (team schedules).
- Cleaner, minimal pass: game page, Home, You, standings. Football Day view fixed (ESPN's single-day feed misses weekday games).
- Quote card on Home: 26 real sports quotes copied from Wikiquote's sourced sections; random, New button.
- Phase 5, Picks and Marks (live):
  - Pick the winner before kickoff (NFL, CFB, NBA, MLB). Marks: favourite 10, toss-up 15, underdog 25 "Upset bonus".
  - Terms of Service (9 sections). "I agree" (13+) turns on Marks; "No thanks" still picks just for fun; agree later in
    You → Settings. Sign-up: agree to Terms required, "13 or older" optional. Marks are NOT real money, never bought, no prizes.
  - Top bar shows Marks (13+ only) with the Marks icon (`marks-icon.svg`). Home: Make your picks.
  - Worker `push/picks.mjs`: opens games for the next 7 days, freezes the Upset bonus at kickoff, pays only agreed users
    (ledger entry `pick_<id>`, never twice), sweep for missed games, removes data of deleted accounts every 6 h.
  - Rules: ages, games, picks, wallets, ledger (published by you). Emulator rules tests (21) + worker syntax check in CI.
- Next for Phase 5: titles and banners to unlock with Marks (in-app only), fantasy (free to join, Marks optional),
  nightly balance-vs-ledger check.
