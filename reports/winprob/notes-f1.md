### F1: weaknesses and verdict

- **Data limits.** FastF1 could not be used: the F1 live-timing archive it reads now returns 401 Unauthorized
  (checked from this PC and from GitHub Actions). OpenF1 history starts in 2023, so the model is trained on only
  46 races (2023-2024) and tested on the 24 races of 2025.
- No ESPN (or other) F1 win probability exists to compare with; the app shows none today. Ours beats both simple
  baselines by a wide margin (Brier 0.279 vs 0.361 for position + progress, 0.478 for grid only).
- Calibration: slightly under-confident for front-runners in 2025 (when ours said 70-90%, they won about 85-91%),
  likely because 2025 had one dominant team. Over-confident at 10-20% (13.6% predicted, 10.2% won).
- No weather, tyre compound or car-pace input; a late safety car is handled only as a flag, and lapped cars get the
  capped gap.
- Gaps are lap-line crossing times from OpenF1 lap start times, so they update once per lap.

**Verdict: ship ours** (there is no ESPN number), labelled as Scoreline's estimate.
