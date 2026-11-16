### NFL: what we tried, weaknesses, verdict

Iterations: (1) first model, 2025 only: ours slightly ahead of ESPN but inside the noise. (2) Wider Elo search and a
rolling backtest over 2023-2025, so the verdict rests on 854 games instead of 284: ESPN comes out ahead overall
(ours loses 2023 clearly, wins 2024 and 2025 narrowly). (3) Same trees fed ESPN's opening win probability as the
pre-game strength: still behind ESPN pooled (+0.0019 Brier).

Known weaknesses:
- **Pre-game strength is the gap.** Our Elo uses only past scores; ESPN's numbers carry their team ratings
  (and nflverse's `vegas_wp`, which uses the betting spread, beats ours on its own plays: 0.1597 vs 0.1637).
  We avoided betting lines on purpose. Ours does beat nflverse's non-betting `wp` (0.1637 vs 0.1724 on 2025).
- Late-game edge: ours is a little better than ESPN in the 4th quarter and overtime of 2025, worse early.
- Mid-range calibration: in 2025 both models over-rated home teams between 40% and 60%; ours slightly more.
- Swings: same average change per play as ESPN (2.1 points), slightly bigger extremes (99th pct 16.3 vs 15.4).
- Kickoff / extra-point moments are mapped to nflverse's kickoff convention; the extra point itself is not added yet.
- The Elo hyperparameters were tuned on all pre-2025 seasons, so the 2023/2024 folds have a small look-ahead in
  those three settings (not in the trees).
- Team Elo ratings ship inside `wp-nfl.json` and go stale unless the workflow is re-run (weekly in season is enough),
  or the app passes `pregameHomeWP`.

**Verdict: show ESPN's number, labelled as ESPN's.** Ours is not measurably better.
