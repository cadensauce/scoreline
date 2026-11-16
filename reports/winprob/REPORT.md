# Scoreline win probability: models and backtest

## Summary

| Sport | Latest held-out season | Brier ours / ESPN | Log loss ours / ESPN | 3 seasons pooled: Brier ours / ESPN (95% CI of gap) | Verdict |
|---|---|---|---|---|---|
| NFL | 50,013 plays, 284 games | 0.1621 / 0.1634 | 0.4834 / 0.4865 |  | **show ESPN's** |
| NBA | 637,996 plays, 1,313 games | 0.1463 / 0.1473 | 0.4388 / 0.4415 |  | **show ESPN's** |
| College football | 141,351 plays, 807 games | 0.1246 / 0.1255 | 0.3797 / 0.3816 |  | **show ESPN's** |
| F1 | not run | | | | |

## NFL

**Data.** nflverse play-by-play (CC-BY 4.0, credit: nflverse), regular season and playoffs. Training: 2006-2024 (5,133 games, 814,066 snaps and kickoffs; 2024 was used for early stopping, then folded back in). Held out: the 2025 season (284 games). Pre-game strength: Scoreline's own Elo from nflverse game results since 1999 (k=20, home edge 50 Elo points, 50% regression between seasons; pre-game log loss 0.6297 on 6,200 training-era games). No betting lines are used as inputs.

**Model.** Gradient-boosted trees (LightGBM, 444 trees, 15 leaves, monotone in score margin, strength, field position and timeouts), exported to plain JSON and evaluated in `models/wp.js`. Inputs: score margin, game and half seconds left, overtime, down, distance, yards to the end zone, home/away/neutral, timeouts left for both teams, pre-game strength, strength x time left, margin / time left.

### Held-out 2025: ours vs ESPN on ESPN's own plays

Both models are scored on exactly the same moments: right after each play that ESPN published a win probability for. Our input is built from ESPN's play-by-play the same way the app will build it live.

| Model | Brier (lower is better) | Log loss (lower is better) |
|---|---|---|
| Scoreline (ours) | **0.1621** | **0.4834** |
| ESPN | 0.1634 | 0.4865 |

50,013 plays from 284 games. Brier difference (ours minus ESPN): -0.0013, 95% CI -0.0072 to +0.0048 (bootstrap over games).

| Period | Plays | Brier ours | Brier ESPN |
|---|---|---|---|
| Q1 | 10,308 | 0.2134 | 0.2149 |
| Q2 | 14,338 | 0.1857 | 0.1869 |
| Q3 | 11,039 | 0.1525 | 0.1533 |
| Q4 | 14,041 | 0.1077 | 0.1092 |
| OT | 287 | 0.1779 | 0.1842 |

**Swings check** (change in home win probability from one play to the next, same game):

| Model | Mean change per play | 99th percentile | Plays with a change over 25 points |
|---|---|---|---|
| Scoreline (ours) | 2.13 pts | 16.3 pts | 0.22% |
| ESPN | 2.13 pts | 15.4 pts | 0.26% |

![NFL 2025 calibration](./calibration-nfl.png)

Calibration table (10 bins): predicted vs actual home win share.

| Bin | Ours: predicted / actual | ESPN: predicted / actual |
|---|---|---|
| 0-10% | 3.5% / 5.9% (n=5,542) | 3.4% / 7.5% (n=5,312) |
| 10-20% | 15.0% / 18.0% (n=3,256) | 14.9% / 18.3% (n=3,259) |
| 20-30% | 25.2% / 30.3% (n=3,982) | 25.4% / 29.9% (n=4,160) |
| 30-40% | 35.0% / 31.9% (n=4,151) | 35.1% / 34.5% (n=4,946) |
| 40-50% | 45.1% / 40.3% (n=4,539) | 45.1% / 41.1% (n=5,569) |
| 50-60% | 55.0% / 47.9% (n=5,005) | 54.9% / 49.3% (n=5,482) |
| 60-70% | 65.0% / 61.9% (n=5,185) | 64.9% / 65.5% (n=5,166) |
| 70-80% | 74.9% / 71.2% (n=4,748) | 75.0% / 77.2% (n=4,843) |
| 80-90% | 85.0% / 83.0% (n=4,693) | 85.0% / 89.6% (n=4,131) |
| 90-100% | 96.8% / 96.0% (n=8,912) | 96.9% / 97.2% (n=7,145) |

**Automatic verdict: show ESPN's.** Ours scores slightly better but the gap is within bootstrap noise, so it is not measurably better; show ESPN's number, labelled as ESPN's.

### Held-out 2025: ours vs nflverse on nflverse plays (before each snap)

| Model | Brier (lower is better) | Log loss (lower is better) |
|---|---|---|
| Scoreline (ours) | **0.1637** | **0.4876** |
| nflverse wp | 0.1724 | 0.5079 |

43,523 plays from 284 games. Brier difference (ours minus nflverse wp): -0.0087, 95% CI -0.0182 to +0.0003 (bootstrap over games).

| Model | Brier (lower is better) | Log loss (lower is better) |
|---|---|---|
| Scoreline (ours) | **0.1637** | **0.4876** |
| nflverse vegas_wp (uses the betting spread) | 0.1597 | 0.4791 |

43,523 plays from 284 games. Brier difference (ours minus nflverse vegas_wp (uses the betting spread)): +0.0040, 95% CI -0.0016 to +0.0104 (bootstrap over games).

## NBA

**Data.** sportsdataverse/hoopR ESPN play-by-play releases. Training: 2015-16 to 2024-25 (12,848 games, 5,989,494 plays; the last of those seasons was used for early stopping, then folded back in). Held out: 2025-26 including playoffs. Pre-game strength: Scoreline's own Elo from final scores (k=20, home edge 40, 40% regression between seasons; pre-game log loss 0.6269). No betting lines are used.

**Model.** Gradient-boosted trees (208 trees, 15 leaves, monotone in margin, possession and strength). Inputs: margin, seconds left, overtime, period, who has the ball (inferred from the last play), pre-game strength, strength x time left, margin / sqrt(time left).

### Held-out 2025-26: ours vs ESPN on ESPN's own plays

| Model | Brier (lower is better) | Log loss (lower is better) |
|---|---|---|
| Scoreline (ours) | **0.1463** | **0.4388** |
| ESPN | 0.1473 | 0.4415 |

637,996 plays from 1,313 games. Brier difference (ours minus ESPN): -0.0010, 95% CI -0.0035 to +0.0015 (bootstrap over games).

| Period | Plays | Brier ours | Brier ESPN |
|---|---|---|---|
| Q1 | 150,914 | 0.1988 | 0.1977 |
| Q2 | 162,953 | 0.1734 | 0.1748 |
| Q3 | 157,357 | 0.1370 | 0.1388 |
| Q4 | 162,874 | 0.0800 | 0.0813 |
| OT | 3,898 | 0.1406 | 0.1538 |

**Swings check** (change in home win probability from one play to the next, same game):

| Model | Mean change per play | 99th percentile | Plays with a change over 25 points |
|---|---|---|---|
| Scoreline (ours) | 1.09 pts | 7.6 pts | 0.03% |
| ESPN | 1.60 pts | 9.3 pts | 0.04% |

![NBA 2025-26 calibration](./calibration-nba.png)

Calibration table (10 bins): predicted vs actual home win share.

| Bin | Ours: predicted / actual | ESPN: predicted / actual |
|---|---|---|
| 0-10% | 2.7% / 2.5% (n=76,487) | 2.9% / 4.4% (n=91,147) |
| 10-20% | 15.1% / 15.2% (n=38,036) | 15.0% / 19.1% (n=44,231) |
| 20-30% | 25.0% / 24.4% (n=45,422) | 25.1% / 29.0% (n=45,974) |
| 30-40% | 35.1% / 34.2% (n=52,683) | 35.0% / 39.7% (n=47,479) |
| 40-50% | 45.1% / 46.8% (n=52,753) | 45.0% / 48.5% (n=50,506) |
| 50-60% | 55.0% / 55.2% (n=56,180) | 55.0% / 56.4% (n=52,684) |
| 60-70% | 65.0% / 65.5% (n=59,145) | 65.1% / 65.0% (n=54,644) |
| 70-80% | 75.2% / 73.2% (n=69,322) | 75.1% / 73.8% (n=58,168) |
| 80-90% | 85.0% / 83.5% (n=72,235) | 85.1% / 82.7% (n=64,405) |
| 90-100% | 97.0% / 97.3% (n=115,733) | 97.0% / 96.6% (n=128,758) |

**Automatic verdict: show ESPN's.** Ours scores slightly better but the gap is within bootstrap noise, so it is not measurably better; show ESPN's number, labelled as ESPN's.

## College football

**Data.** ESPN play-by-play (summary endpoint) for FBS games, 2017-2024 for training (5,903 games, 1,054,294 plays; 2024 used for early stopping, then folded back in). Game lists and final scores: sportsdataverse `cfb_schedules` releases (2004 on). Held out: the 2025 season (807 FBS games with ESPN win probability). We used ESPN's own play-by-play instead of the cfbfastR play files because the current cfbfastR release is built from a different (NCAA) feed whose field conventions don't match what the app receives live; training on the same feed the app uses avoids that mismatch. Pre-game strength: Scoreline's own Elo over all divisions (k=40, home edge 40, 20% regression; FBS start 1500, FCS 1250, others 1000; pre-game log loss 0.5105). No betting lines.

**Model.** Gradient-boosted trees (201 trees, 15 leaves). Same inputs as NFL minus timeouts (not reliably in the college feed) plus the period number (overtime rules change by period). Kickoff and extra-point moments are treated as the receiving team's 1st and 10 at its own 25.

### Held-out 2025: ours vs ESPN on ESPN's own plays

| Model | Brier (lower is better) | Log loss (lower is better) |
|---|---|---|
| Scoreline (ours) | **0.1246** | **0.3797** |
| ESPN | 0.1255 | 0.3816 |

141,351 plays from 807 games. Brier difference (ours minus ESPN): -0.0009, 95% CI -0.0047 to +0.0031 (bootstrap over games).

| Period | Plays | Brier ours | Brier ESPN |
|---|---|---|---|
| Q1 | 31,445 | 0.1736 | 0.1695 |
| Q2 | 40,417 | 0.1403 | 0.1405 |
| Q3 | 32,348 | 0.1095 | 0.1126 |
| Q4 | 36,826 | 0.0781 | 0.0819 |
| OT | 315 | 0.2159 | 0.2316 |

**Swings check** (change in home win probability from one play to the next, same game):

| Model | Mean change per play | 99th percentile | Plays with a change over 25 points |
|---|---|---|---|
| Scoreline (ours) | 1.95 pts | 15.8 pts | 0.28% |
| ESPN | 1.83 pts | 15.2 pts | 0.33% |

![College football 2025 calibration](./calibration-cfb.png)

Calibration table (10 bins): predicted vs actual home win share.

| Bin | Ours: predicted / actual | ESPN: predicted / actual |
|---|---|---|
| 0-10% | 3.4% / 2.8% (n=18,023) | 3.0% / 3.8% (n=18,978) |
| 10-20% | 14.7% / 16.6% (n=9,442) | 14.9% / 16.6% (n=9,731) |
| 20-30% | 24.9% / 23.5% (n=8,555) | 25.0% / 25.7% (n=8,666) |
| 30-40% | 35.0% / 33.1% (n=8,629) | 35.0% / 38.2% (n=9,086) |
| 40-50% | 45.1% / 46.3% (n=9,225) | 45.1% / 46.9% (n=9,402) |
| 50-60% | 55.1% / 54.9% (n=10,511) | 55.0% / 55.0% (n=9,691) |
| 60-70% | 65.1% / 65.5% (n=11,879) | 65.0% / 62.8% (n=10,395) |
| 70-80% | 75.1% / 72.0% (n=12,204) | 75.2% / 72.7% (n=11,726) |
| 80-90% | 85.2% / 86.4% (n=14,018) | 85.1% / 86.5% (n=13,816) |
| 90-100% | 97.1% / 98.0% (n=38,865) | 97.3% / 97.7% (n=39,860) |

**Automatic verdict: show ESPN's.** Ours scores slightly better but the gap is within bootstrap noise, so it is not measurably better; show ESPN's number, labelled as ESPN's.
