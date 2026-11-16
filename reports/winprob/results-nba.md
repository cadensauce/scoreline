## NBA

**Data.** sportsdataverse/hoopR ESPN play-by-play releases. Training: 2015-16 to 2024-25 (12,848 games, 5,989,494 plays; the last of those seasons was used for early stopping, then folded back in). Held out: 2025-26 including playoffs. Pre-game strength: Scoreline's own Elo from final scores (k=20, home edge 55, 40% regression between seasons; pre-game log loss 0.6268). No betting lines are used.

**Model.** Gradient-boosted trees (159 trees, 31 leaves, monotone in margin, possession and strength). Inputs: margin, seconds left, overtime, period, who has the ball (inferred from the last play), pre-game strength, strength x time left, margin / sqrt(time left).

### Held-out 2025-26: ours vs ESPN on ESPN's own plays

| Model | Brier (lower is better) | Log loss (lower is better) |
|---|---|---|
| Scoreline (ours) | **0.1461** | **0.4381** |
| ESPN | 0.1473 | 0.4414 |

640,036 plays from 1,317 games. Brier difference (ours minus ESPN): -0.0012, 95% CI -0.0037 to +0.0011 (bootstrap over games).

| Period | Plays | Brier ours | Brier ESPN |
|---|---|---|---|
| Q1 | 151,382 | 0.1981 | 0.1975 |
| Q2 | 163,471 | 0.1731 | 0.1748 |
| Q3 | 157,877 | 0.1367 | 0.1387 |
| Q4 | 163,408 | 0.0799 | 0.0814 |
| OT | 3,898 | 0.1419 | 0.1538 |

**Swings check** (change in home win probability from one play to the next, same game):

| Model | Mean change per play | 99th percentile | Plays with a change over 25 points |
|---|---|---|---|
| Scoreline (ours) | 1.08 pts | 7.4 pts | 0.03% |
| ESPN | 1.60 pts | 9.3 pts | 0.04% |

![NBA 2025-26 calibration](./calibration-nba.png)

Calibration table (10 bins): predicted vs actual home win share.

| Bin | Ours: predicted / actual | ESPN: predicted / actual |
|---|---|---|
| 0-10% | 2.7% / 2.5% (n=76,305) | 2.9% / 4.4% (n=91,648) |
| 10-20% | 15.0% / 15.0% (n=37,858) | 15.0% / 19.0% (n=44,583) |
| 20-30% | 25.1% / 23.6% (n=46,131) | 25.1% / 28.9% (n=46,333) |
| 30-40% | 35.1% / 34.1% (n=52,118) | 35.0% / 39.7% (n=47,870) |
| 40-50% | 44.9% / 46.7% (n=55,626) | 45.0% / 48.5% (n=50,734) |
| 50-60% | 55.0% / 55.0% (n=56,169) | 55.0% / 56.5% (n=52,780) |
| 60-70% | 65.0% / 65.8% (n=59,175) | 65.1% / 65.0% (n=54,710) |
| 70-80% | 75.2% / 73.3% (n=68,761) | 75.1% / 73.8% (n=58,192) |
| 80-90% | 84.9% / 83.7% (n=73,155) | 85.1% / 82.7% (n=64,410) |
| 90-100% | 97.0% / 97.5% (n=114,738) | 97.0% / 96.6% (n=128,776) |

Latest season alone, the automatic check says: show ESPN's (ours scores slightly better but the gap is within bootstrap noise, so it is not measurably better). The verdict below uses all held-out seasons.

### Rolling backtest: three most recent seasons (each predicted by a model trained only on earlier seasons)

| Held-out season | Games | Plays | Brier ours | Brier ESPN | Log loss ours | Log loss ESPN |
|---|---|---|---|---|---|---|
| 2023-24 | 1,318 | 613,470 | 0.1473 | 0.1461 | 0.4432 | 0.4413 |
| 2024-25 | 1,321 | 624,637 | 0.1515 | 0.1513 | 0.4526 | 0.4530 |
| 2025-26 | 1,317 | 640,036 | 0.1461 | 0.1473 | 0.4381 | 0.4414 |
| **All 3 pooled** | 3,956 | 1,878,143 | **0.1483** | 0.1482 | **0.4446** | 0.4452 |

Pooled Brier difference (ours minus ESPN): +0.0000, 95% CI -0.0016 to +0.0016 (bootstrap over games). Ours is better on both metrics in 1 of 3 seasons.

**Automatic verdict: show ESPN's.** ESPN's numbers score better than ours across the held-out seasons; show ESPN's number, labelled as ESPN's.
