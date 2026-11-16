### NBA: what we tried, weaknesses, verdict

Iterations: (1) first model, 2025-26 only: ours slightly ahead, inside the noise. (2) Wider Elo search, bigger trees
(31 leaves) and a rolling backtest over three seasons (3,956 games): a dead heat (pooled Brier 0.1483 vs 0.1482).
Ours is better in the 2nd-4th quarters and overtime and worse in the 1st quarter, which points at pre-game strength.
(3) Same trees with ESPN's opening win probability as the strength input: **better than ESPN in all three seasons**,
pooled Brier 0.1459 vs 0.1482, 95% CI of the gap -0.0033 to -0.0012, log loss 0.4388 vs 0.4452.

What that means: our in-game model (how the lead, time left and possession move the odds) is better than ESPN's;
ESPN's pre-game team ratings are better than our Elo. Combining the two beats ESPN's own number.

Known weaknesses:
- The shipped version depends on ESPN for one input: pass `pregameHomeWP` = the first entry of the summary's
  `winprobability` array (or `predictor.homeTeam.gameProjection / 100` before tip-off). Without it, the model falls
  back to our Elo and is only level with ESPN.
- Possession is inferred from the last play (rebounds, made shots, turnovers, last free throw); unknown after a
  missed shot until the rebound.
- Swings are smaller than ESPN's (1.1 vs 1.6 points per play on average; 99th pct 7.4 vs 9.3).
- This variant was a second look at the same held-out seasons, so treat the margin as slightly optimistic; it
  held in each of the three seasons separately.

**Verdict: ship ours, fed ESPN's pre-game strength** (labelled as Scoreline's estimate). If the ESPN opening
number is missing, show ESPN's live number instead of our Elo-only version.
