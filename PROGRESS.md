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
