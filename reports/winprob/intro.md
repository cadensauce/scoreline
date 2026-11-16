# Scoreline win probability: models and backtest

Scoreline's own win-probability models, one per sport, trained on free historical data and backtested on
seasons the models never saw. "ESPN" below is the number the app shows today (ESPN's live win probability),
scored on exactly the same moments as ours.

How to read the numbers:
- **Brier score** = average of (predicted probability - result)^2, where result is 1 if the home team won.
  Lower is better; always guessing 50% scores 0.25.
- **Log loss** = average of -log(probability given to what actually happened). Lower is better; it punishes
  confident misses hard. Probabilities are clipped to 0.1%-99.9% for both models before scoring.
- **Calibration**: of all moments where a model said 70%, did the home team win about 70% of the time?
  Each chart shows ours and ESPN's on the same axes; points on the dashed line are perfectly calibrated.
- **95% CI**: plays within a game are not independent, so the uncertainty comes from resampling whole games
  (1,000 bootstrap samples). If the interval for "ours minus ESPN" includes 0, the difference could be luck.
- **Verdict rule** (decided before seeing results): ship ours only if it beats ESPN on both Brier and log loss
  and the Brier gap's 95% interval is entirely below 0 across the pooled held-out seasons. Otherwise the app
  shows ESPN's number, labelled as ESPN's.

Everything here is produced by `.github/workflows/winprob.yml` (Python in GitHub Actions; this PC has no
Python). Retrain: `gh workflow run winprob.yml -R cadensauce/scoreline` (optionally `-f sports=nfl,nba`).
Models: `models/wp-{sport}.json`, browser runtime: `models/wp.js` (`window.ScorelineWP`), training code: `model/`.
The workflow also checks that `models/wp.js` reproduces the Python predictions on 3,000 held-out states per sport.

Data credits: nflverse (NFL play-by-play and schedules, CC-BY 4.0); sportsdataverse / hoopR (NBA play-by-play)
and sportsdataverse `cfb_schedules` (college schedules/results); ESPN public summary feed (college play-by-play
and every "ESPN" comparison number); OpenF1 and Jolpica-F1 (F1, CC BY-NC-SA 4.0, non-commercial).
