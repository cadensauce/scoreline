## College football

**Data.** ESPN play-by-play (summary endpoint) for FBS games, 2017-2024 for training (5,903 games, 1,054,294 plays; 2024 used for early stopping, then folded back in). Game lists and final scores: sportsdataverse `cfb_schedules` releases (2004 on). Held out: the 2025 season (807 FBS games with ESPN win probability). We used ESPN's own play-by-play instead of the cfbfastR play files because the current cfbfastR release is built from a different (NCAA) feed whose field conventions don't match what the app receives live; training on the same feed the app uses avoids that mismatch. Pre-game strength: Scoreline's own Elo over all divisions (k=40, home edge 55, 20% regression; FBS start 1500, FCS 1250, others 1000; pre-game log loss 0.5103). No betting lines.

**Model.** Gradient-boosted trees (208 trees, 15 leaves). Same inputs as NFL minus timeouts (not reliably in the college feed) plus the period number (overtime rules change by period). Kickoff and extra-point moments are treated as the receiving team's 1st and 10 at its own 25.

### Held-out 2025: ours vs ESPN on ESPN's own plays

| Model | Brier (lower is better) | Log loss (lower is better) |
|---|---|---|
| Scoreline (ours) | **0.1244** | **0.3789** |
| ESPN | 0.1255 | 0.3816 |

141,351 plays from 807 games. Brier difference (ours minus ESPN): -0.0011, 95% CI -0.0051 to +0.0029 (bootstrap over games).

| Period | Plays | Brier ours | Brier ESPN |
|---|---|---|---|
| Q1 | 31,445 | 0.1735 | 0.1695 |
| Q2 | 40,417 | 0.1401 | 0.1405 |
| Q3 | 32,348 | 0.1090 | 0.1126 |
| Q4 | 36,826 | 0.0779 | 0.0819 |
| OT | 315 | 0.2151 | 0.2316 |

**Swings check** (change in home win probability from one play to the next, same game):

| Model | Mean change per play | 99th percentile | Plays with a change over 25 points |
|---|---|---|---|
| Scoreline (ours) | 1.98 pts | 15.9 pts | 0.28% |
| ESPN | 1.83 pts | 15.2 pts | 0.33% |

![College football 2025 calibration](./calibration-cfb.png)

Calibration table (10 bins): predicted vs actual home win share.

| Bin | Ours: predicted / actual | ESPN: predicted / actual |
|---|---|---|
| 0-10% | 3.4% / 2.9% (n=17,850) | 3.0% / 3.8% (n=18,978) |
| 10-20% | 14.8% / 16.5% (n=9,482) | 14.9% / 16.6% (n=9,731) |
| 20-30% | 25.0% / 23.0% (n=8,636) | 25.0% / 25.7% (n=8,666) |
| 30-40% | 35.0% / 33.2% (n=8,868) | 35.0% / 38.2% (n=9,086) |
| 40-50% | 45.1% / 46.1% (n=9,474) | 45.1% / 46.9% (n=9,402) |
| 50-60% | 55.1% / 55.8% (n=10,340) | 55.0% / 55.0% (n=9,691) |
| 60-70% | 65.1% / 65.2% (n=11,728) | 65.0% / 62.8% (n=10,395) |
| 70-80% | 75.2% / 71.3% (n=11,851) | 75.2% / 72.7% (n=11,726) |
| 80-90% | 85.3% / 86.5% (n=14,062) | 85.1% / 86.5% (n=13,816) |
| 90-100% | 97.1% / 98.1% (n=39,060) | 97.3% / 97.7% (n=39,860) |

Latest season alone, the automatic check says: show ESPN's (ours scores slightly better but the gap is within bootstrap noise, so it is not measurably better). The verdict below uses all held-out seasons.

### Rolling backtest: 2023, 2024 and 2025 (each season predicted by a model trained only on earlier seasons)

| Held-out season | Games | Plays | Brier ours | Brier ESPN | Log loss ours | Log loss ESPN |
|---|---|---|---|---|---|---|
| 2023 | 787 | 135,634 | 0.1228 | 0.1201 | 0.3800 | 0.3745 |
| 2024 | 783 | 137,253 | 0.1335 | 0.1303 | 0.4061 | 0.3989 |
| 2025 | 807 | 141,351 | 0.1244 | 0.1255 | 0.3789 | 0.3816 |
| **All 3 pooled** | 2,377 | 414,238 | **0.1269** | 0.1253 | **0.3883** | 0.3850 |

Pooled Brier difference (ours minus ESPN): +0.0016, 95% CI -0.0007 to +0.0038 (bootstrap over games). Ours is better on both metrics in 1 of 3 seasons.

**Automatic verdict: show ESPN's.** ESPN's numbers score better than ours across the held-out seasons; show ESPN's number, labelled as ESPN's.
