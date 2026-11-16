### College football: what we tried, weaknesses, verdict

Iterations: (1) first model, 2025 only: ours slightly ahead, inside the noise. (2) Wider Elo search and a rolling
backtest over 2023-2025 (2,377 games): ESPN ahead pooled (0.1269 vs 0.1253), ours loses 2023 and 2024. (3) Same trees
with ESPN's opening win probability as strength: ours slightly ahead pooled (0.1249 vs 0.1253) but the 95% interval
(-0.0016 to +0.0010) includes zero, and it wins only 1 of 3 seasons.

Known weaknesses:
- Pre-game strength: college ratings need recruiting, returning production and many FCS/FBS mismatches; our Elo
  only sees scores. ESPN is clearly better in the 1st quarter, ours better in the 4th quarter and overtime.
- No timeouts input (not reliable in the college feed). Kickoffs and extra points are treated as the receiving
  team's 1st and 10 at its own 25.
- Swings a little larger than ESPN's (2.0 vs 1.8 points per play).
- Trained on ESPN's own play-by-play (2017-2024 FBS games) instead of cfbfastR files: the current cfbfastR release
  comes from a different feed with different conventions, and training on the feed the app uses avoids mismatch.

**Verdict: show ESPN's number, labelled as ESPN's.**
