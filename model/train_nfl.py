"""NFL win probability: train on nflverse play-by-play, backtest on the most recent full season
against ESPN's live win probability (same plays) and nflverse's own wp / vegas_wp."""
import datetime as dt
import os
import random

import numpy as np
import pandas as pd

import football as fb
from backtest import espn_section
from common import (DATA, MODELS, OUT, REPORTS, check_export, download, eval_trees, export_trees, fetch_summaries,
                    fit_gbm, js_cases, load_summary, log, run_elo, sigmoid, tune_elo, write_json, compare_block)
from strength import strh_array

TEST = int(os.environ.get("NFL_TEST_SEASON", "2025"))
FIRST = 2006
NV = "https://github.com/nflverse/nflverse-data/releases/download"
REN = {"OAK": "LV", "SD": "LAC", "STL": "LA"}
COLS = ["game_id", "season", "home_team", "away_team", "posteam", "qtr", "quarter_seconds_remaining", "down",
        "ydstogo", "yardline_100", "posteam_score", "defteam_score", "home_timeouts_remaining",
        "away_timeouts_remaining", "home_wp", "vegas_home_wp", "result", "play_type"]


def main():
    d = os.path.join(DATA, "nfl")
    games = pd.read_csv(download(f"{NV}/schedules/games.csv", os.path.join(d, "games.csv")))
    games = games.sort_values(["gameday", "game_id"]).reset_index(drop=True)
    for c in ("home_team", "away_team"):
        games[c] = games[c].replace(REN)
    glist = [{"gid": r.game_id, "season": int(r.season), "home": r.home_team, "away": r.away_team,
              "hs": None if pd.isna(r.home_score) else float(r.home_score),
              "as": None if pd.isna(r.away_score) else float(r.away_score),
              "neutral": r.location == "Neutral"} for r in games.itertuples()]
    done = [g for g in glist if g["hs"] is not None]
    log(f"games: {len(done)} completed ({games.season.min()}-{games.season.max()})")
    eparams = tune_elo(done, {"k": [15, 20, 25, 30], "hfa": [20, 35, 50, 65], "revert": [0.2, 0.33, 0.5]},
                       set(range(2002, TEST)), mov="football")
    pre, ratings = run_elo(done, eparams["k"], eparams["hfa"], eparams["revert"], mov="football")
    gmeta = games.set_index("game_id")

    # ---------------- play-by-play
    frames = []
    for s in range(FIRST, TEST + 1):
        fn = download(f"{NV}/pbp/play_by_play_{s}.parquet", os.path.join(d, f"pbp_{s}.parquet"))
        frames.append(pd.read_parquet(fn, columns=COLS))
    pbp = pd.concat(frames, ignore_index=True)
    log(f"pbp rows: {len(pbp):,}")
    k = pbp[pbp.play_type == "kickoff"].head(3)
    log("kickoff convention sample:\n" + k[["home_team", "posteam", "yardline_100", "down", "ydstogo"]].to_string())
    pbp["home_team"] = pbp["home_team"].replace(REN)
    pbp["posteam"] = pbp["posteam"].replace(REN)
    keep = (pbp.posteam.notna() & pbp.qtr.notna() & pbp.quarter_seconds_remaining.notna() &
            pbp.posteam_score.notna() & pbp.result.notna() & (pbp.result != 0) &
            (pbp.down.isin([1, 2, 3, 4]) | (pbp.play_type == "kickoff")))
    pbp = pbp[keep].copy()
    ph = pbp.posteam == pbp.home_team
    df = pd.DataFrame({
        "game": pbp.game_id.to_numpy(), "season": pbp.season.to_numpy(),
        "hs": np.where(ph, pbp.posteam_score, pbp.defteam_score).astype(float),
        "as_": np.where(ph, pbp.defteam_score, pbp.posteam_score).astype(float),
        "period": pbp.qtr.astype(float).to_numpy(), "clock": pbp.quarter_seconds_remaining.astype(float).to_numpy(),
        "poss": np.where(ph, 1.0, -1.0), "down": pbp.down.fillna(0).astype(float).to_numpy(),
        "dist": pbp.ydstogo.fillna(0).astype(float).to_numpy(), "ytg": pbp.yardline_100.fillna(35).astype(float).to_numpy(),
        "hto": pbp.home_timeouts_remaining.fillna(3).astype(float).to_numpy(),
        "ato": pbp.away_timeouts_remaining.fillna(3).astype(float).to_numpy(),
        "neutral": pbp.game_id.map(gmeta["location"]).eq("Neutral").astype(float).to_numpy(),
        "strh": pbp.game_id.map(pre).astype(float).to_numpy(),
        "home_win": (pbp.result > 0).astype(float).to_numpy(),
        "nv_wp": pbp.home_wp.to_numpy(float), "nv_vegas": pbp.vegas_home_wp.to_numpy(float),
    })
    df = df[df.strh.notna()].reset_index(drop=True)
    df["ytg"] = df["ytg"].clip(1, 99)
    df["y"] = np.where(df.poss > 0, df.home_win, 1 - df.home_win)
    tr, va, te = df[df.season < TEST - 1], df[df.season == TEST - 1], df[df.season == TEST]
    log(f"train {len(tr):,} rows / {tr.game.nunique()} games; val {len(va):,}; test {len(te):,} / {te.game.nunique()} games")
    X = lambda f: fb.features(f, "nfl", f["poss"].to_numpy())  # noqa
    booster, best = fit_gbm(X(tr), tr.y.to_numpy(), X(va), va.y.to_numpy(), fb.NFL_FEATURES, fb.NFL_MONO)
    trees = export_trees(booster)
    check_export(booster, trees, X(te))
    ev = lambda F: eval_trees(trees, F)  # noqa

    # ---------------- test on nflverse rows (vs nflverse wp and vegas wp)
    ours_nv = fb.predict_home(ev, te, "nfl")
    m_nv = (te.nv_wp.notna() & te.nv_vegas.notna()).to_numpy()
    yv = te.home_win.to_numpy()[m_nv]
    md_nv, met_nv = compare_block("Scoreline (ours)", "nflverse wp", te.game.to_numpy()[m_nv], yv,
                                  ours_nv[m_nv], te.nv_wp.to_numpy()[m_nv])
    md_vg, met_vg = compare_block("Scoreline (ours)", "nflverse vegas_wp (uses the betting spread)",
                                  te.game.to_numpy()[m_nv], yv, ours_nv[m_nv], te.nv_vegas.to_numpy()[m_nv])

    # ---------------- test on ESPN's own play stream
    tg = games[(games.season == TEST) & games.home_score.notna() & games.espn.notna()]
    id_of = {str(int(e)): g for e, g in zip(tg.espn, tg.game_id)}
    ok = fetch_summaries("football/nfl", list(id_of), "nfl")
    rows, team_ids, skipped = [], {}, {}
    for eid in ok:
        st, meta = fb.espn_states(load_summary("nfl", eid))
        if st is None:
            skipped[meta] = skipped.get(meta, 0) + 1
            continue
        gid = id_of[eid]
        g = gmeta.loc[gid]
        team_ids[g.home_team] = meta["home_id"]
        team_ids[g.away_team] = meta["away_id"]
        p0 = float(sigmoid(pre[gid]))
        for r in st:
            r.update({"pregameHomeWP": p0, "_game": eid, "_y": meta["home_win"]})
        rows += st
    log(f"espn rows {len(rows):,}; skipped games {skipped}")
    ef = fb.states_to_frame(rows)
    ef["strh"] = strh_array(rows, None)
    can = fb.canonical(ef, "nfl")
    p_ours = fb.predict_home(ev, can, "nfl")
    p_espn = np.array([r["_espn"] for r in rows])
    y = np.array([r["_y"] for r in rows])
    gm = np.array([r["_game"] for r in rows])
    per = can["period"].to_numpy()
    pnames = [(1.0, "Q1"), (2.0, "Q2"), (3.0, "Q3"), (4.0, "Q4"), (lambda p: p >= 5, "OT")]
    md_e, met_e = espn_section("nfl", f"NFL {TEST}", gm, y, p_ours, p_espn, per, pnames)

    # ---------------- export
    elo = {"hfa": eparams["hfa"], "revert": eparams["revert"], "base": 1500.0,
           "ratings": {team_ids[t]: v for t, v in ratings.items() if t in team_ids},
           "asOf": str(games[games.home_score.notna()].gameday.max())}
    model = {"sport": "nfl", "trained": dt.date.today().isoformat(), "kind": "lightgbm-flat",
             "features": fb.NFL_FEATURES, "trees": trees, "elo": elo,
             "source": "nflverse play-by-play (CC-BY 4.0), seasons %d-%d" % (FIRST, TEST - 1)}
    write_json(os.path.join(MODELS, "wp-nfl.json"), model)

    # JS parity cases: real held-out states (with pregameHomeWP) + team-id/Elo cases
    random.seed(3)
    idx = random.sample(range(len(rows)), min(3000, len(rows)))
    cases = [{k: v for k, v in rows[i].items() if not k.startswith("_")} for i in idx]
    for c in cases[:300]:
        c.pop("pregameHomeWP")
        c["homeTeamId"], c["awayTeamId"] = random.sample(list(elo["ratings"]), 2)
        c["season"] = TEST + random.choice([0, 1, 2])
    for c in cases[300:400]:
        c["possession"] = None
    cf = fb.states_to_frame(cases)
    cf["strh"] = strh_array(cases, elo)
    js_cases(os.path.join(OUT, "cases-nfl.json"), cases, fb.predict_home(ev, fb.canonical(cf, "nfl"), "nfl"))

    seasons = f"{FIRST}-{TEST - 1}"
    md = [f"## NFL", "",
          f"**Data.** nflverse play-by-play (CC-BY 4.0, credit: nflverse), regular season and playoffs. "
          f"Training: {seasons} ({tr.game.nunique() + va.game.nunique():,} games, {len(tr) + len(va):,} snaps and kickoffs; "
          f"{TEST - 1} was used for early stopping, then folded back in). Held out: the {TEST} season "
          f"({te.game.nunique()} games). Pre-game strength: Scoreline's own Elo from nflverse game results since 1999 "
          f"(k={eparams['k']}, home edge {eparams['hfa']} Elo points, {int(eparams['revert'] * 100)}% regression between seasons; "
          f"pre-game log loss {eparams['pregame_logloss']:.4f} on {eparams['n']:,} training-era games). No betting lines are used as inputs.",
          "",
          f"**Model.** Gradient-boosted trees (LightGBM, {len(trees)} trees, 15 leaves, monotone in score margin, strength, field position and timeouts), "
          f"exported to plain JSON and evaluated in `models/wp.js`. Inputs: score margin, game and half seconds left, overtime, down, distance, "
          "yards to the end zone, home/away/neutral, timeouts left for both teams, pre-game strength, strength x time left, margin / time left.",
          "", f"### Held-out {TEST}: ours vs ESPN on ESPN's own plays", "",
          "Both models are scored on exactly the same moments: right after each play that ESPN published a win probability for. "
          "Our input is built from ESPN's play-by-play the same way the app will build it live.", "", *md_e,
          "", f"### Held-out {TEST}: ours vs nflverse on nflverse plays (before each snap)", "", *md_nv, "", *md_vg]
    with open(os.path.join(REPORTS, "results-nfl.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md) + "\n")
    write_json(os.path.join(REPORTS, "metrics-nfl.json"),
               {"espn": met_e, "nflverse_wp": met_nv, "nflverse_vegas_wp": met_vg, "elo": eparams,
                "trees": len(trees), "best_rounds": best}, compact=False)
    log("done", met_e["brier_ours"], met_e["brier_other"])


if __name__ == "__main__":
    main()
