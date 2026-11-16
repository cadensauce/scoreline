# Scoreline overhaul: plan

Rule #1 is simplicity: lots of features, small surface. Home and game pages show essentials; everything else is
one labelled tap deeper. Details for each phase live in the spec; this file tracks order, risks and decisions.

## What Scoreline is today (Phase 0 findings)
- One-file vanilla JS website on GitHub Pages; Android/Windows apps are Tauri shells that load the live site,
  so web and app already share every line of UI code ("same on both" comes for free).
- Firebase (free plan) for accounts/friends/chat/push subscriptions; a push worker on GitHub Actions.
- Data: ESPN's public JSON (unofficial, no licence) + OpenF1. No tests, no build step, no Node/Python on this PC.
- Sports: NFL, CFB, NBA, MLB, F1 (MLB is already in the app, so it stays unless you say otherwise).
- Already present: possession on the game page, kick/play field graphics, broadcasts (TV) on cards,
  injuries tab, alerts with per-team settings, friends + chat, Get the app.
- Win probability shown today is ESPN's number (live), ESPN's predictor or betting odds (pre-game), not ours.

## Phase order
0. Understand (done, waiting on your answers).
1. Fix: notifications on/off + Android app push (15), test setup (Playwright + emulator in Actions),
   performance pass (6) with before/after table, win-probability model + backtest (14), full review fixes (16).
2. Design system (23) → nav with pinned sports + Profile (11) → home → game page → profile (7) → settings,
   themes (9), version in Settings (17). Design rounds 2–4.
3. Follow players/drivers (3), notification controls + quiet hours (4), Closest Games (19), possession on lists (28),
   kick graphics (30), heat map (29), standings (20), playoff picture (24), strategy picker (25), injuries (22),
   broadcast (5), weather (1).
4. Predictions (13), recaps (21), highlights (26), plain-English layer + glossary (27), Beginner Mode (12a),
   tutorial (12b), newcomer walkthroughs.
5. Currency (18), picks, fantasy (2), shop, ledger + anti-cheat (see `docs/phase5-design.md`).
Ongoing: performance budget re-check and security audit (8) each phase.

## How work runs here (constraints)
- Tests, Lighthouse, backtests and model training run in GitHub Actions (free for this public repo) because this PC
  has no Node/Python. Results are committed to the repo (`reports/`).
- Screenshots: taken in the in-app browser at phone (375×812) and desktop (1280×800) sizes.
- Every phase ends with: tests in CI, commit, a `PROGRESS.md` entry, re-measured performance.

## Risks
1. **ESPN data has no licence.** Disney's terms bar automated access. Realistic risk is endpoints changing or
   blocking, not legal action against a free fan app. Mitigation: cache, fallbacks, credits, flags per source.
2. **GitHub Actions terms** don't allow using Actions as a 24/7 server. The push worker (and a future settlement
   worker) could be shut off. Alternatives: Firebase Blaze (Cloud Functions, needs a card, free tier likely
   covers us), or a free-tier host (e.g. a small always-free VM). Decision needed.
3. **Kick ball-location data doesn't exist for free** (no source gives where the ball crossed the uprights).
   Kicks will be drawn from the result text ("wide right", "hit left upright") and clearly labelled, per spec.
4. **Beating ESPN's win probability is hard.** ESPN's live model is decent; our model will be backtested against
   it and the old display. If ours isn't measurably better for a sport, I'll say so instead of shipping it.
5. **Logos**: team/league logos are trademarks; we currently hot-link ESPN's copies.
6. **Spec size**: this is months of work. Phases will land as many small pushes so the live app keeps working.

## Decisions I need from you (also asked in chat)
1. Design direction: A Quiet, B Soft or C Paper (round 1 artifact), and dark or light default.
2. Removals (simplicity): remove the ↻ button, the fake menu mark, per-row stars (follow from team page/Profile),
   the Timeouts tab (folded into Plays); hide Friends + Chat behind Profile, or remove them entirely?
3. MLB: keep (it's already in the app) or drop?
4. Push worker hosting: keep on GitHub Actions (free, terms risk), Firebase Blaze (card on file, likely $0), or
   a free VM?
5. Logos: keep ESPN-hosted team logos, or switch to Scoreline-drawn abbreviation badges?
6. Win probability: if our model doesn't beat ESPN's for a sport, show ESPN's number labelled as ESPN's, or
   show ours anyway, or "unavailable"?
7. Paid/keyed services (all optional):
   a. CollegeFootballData.com API key (free tier, 1,000 calls/month) for CFB history + rankings. Recommended.
   b. YouTube Data API key (free, 10,000 units/day) for official highlight matching. Recommended.
   c. Claude Haiku for recaps (~$1–2/month) vs template recaps from play-by-play (free). Recommend templates first.
   d. Open-Meteo weather (free, non-commercial, attribution required). Recommended.
8. Currency name (see chat): Marks, Tallies or Laurels (or yours).
9. Reward formula: spec's win-chance formula, or fixed "Upset bonus" tiers (safer for store ratings)?
10. Under-13 handling: no accounts for under-13 (simplest COPPA path, they keep all scores features on-device). OK?
11. Fantasy for CFB too, or NFL/NBA/F1 only to start?
12. App stores: Scoreline is APK-only today. Any plan to list on Google Play / App Store soon? (Changes priorities
    for ratings, account deletion links and age gates.)
