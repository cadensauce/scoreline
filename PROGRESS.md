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
(none yet: waiting on round 1)

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
