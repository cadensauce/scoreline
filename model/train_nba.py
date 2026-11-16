"""NBA win probability: train on hoopR/sportsdataverse ESPN play-by-play, backtest on the most recent
full season against ESPN's live win probability on the same plays."""
import datetime as dt
import os
import random

import numpy as np
import pandas as pd

import nba
from backtest import espn_section, opening_strength, rolling_section
from common import (DATA, MODELS, OUT, REPORTS, check_export, download, eval_trees, export_trees, fetch_summaries,
                    fit_gbm, js_cases, load_summary, log, parse_clock, run_elo, sigmoid, tune_elo, write_json)
from strength import strh_array

TEST = int(os.environ.get("NBA_TEST_SEASON", "2026"))  # season label = year the season ends (2025-26)
FIRST = 2016
URL = "https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_nba_pbp/play_by_play_{}.parquet"
COLS = ["game_id", "season", "game_date", "type_text", "home_score", "away_score", "period_number",
        "clock_display_value", "scoring_play", "shooting_play", "team_id", "home_team_id", "away_team_id",
        "sequence_number"]


def main():
    d = os.path.join(DATA, "nba")
    frames = []
    for s in range(FIRST, TEST + 2):
        fn = download(URL.format(s), os.path.join(d, f"pbp_{s}.parquet"), optional=(s == TEST + 1))
        if fn:
            f = pd.read_parquet(fn, columns=COLS)
            frames.append(f)
            log(f"season {s}: {len(f):,} rows, {f.game_id.nunique()} games")
    pbp = pd.concat(frames, ignore_index=True)
    pbp["sequence_number"] = pd.to_numeric(pbp.sequence_number, errors="coerce")
    pbp = pbp.sort_values(["game_id", "sequence_number"], kind="stable").reset_index(drop=True)
    for c in ("home_team_id", "away_team_id", "team_id"):
        pbp[c] = pd.to_numeric(pbp[c], errors="coerce").astype("Int64").astype(str)

    # ---------------- games + Elo (from final scores in the play-by-play)
    g = pbp.groupby("game_id").agg(season=("season", "first"), date=("game_date", "first"),
                                   home=("home_team_id", "first"), away=("away_team_id", "first"),
                                   hs=("home_score", "max"), as_=("away_score", "max")).reset_index()
    g = g.dropna(subset=["hs", "as_"]).sort_values(["date", "game_id"])
    glist = [{"gid": r.game_id, "season": int(r.season), "home": r.home, "away": r.away, "hs": float(r.hs),
              "as": float(r.as_), "neutral": False} for r in g.itertuples() if r.hs != r.as_]
    eparams = tune_elo(glist, {"k": [15, 20, 25], "hfa": [15, 25, 40, 55], "revert": [0.3, 0.4, 0.55]},
                       set(range(FIRST + 2, TEST)), mov="basketball")
    pre, ratings = run_elo(glist, eparams["k"], eparams["hfa"], eparams["revert"], mov="basketball")
    final = dict(zip(g.game_id, (g.hs > g.as_).astype(float)))

    # ---------------- training rows
    trn = pbp[pbp.season < TEST].copy()
    trn = trn[trn.game_id.map(pre).notna()]
    poss = np.zeros(len(trn))
    gid = trn.game_id.to_numpy()
    tt, tm, hm, aw = trn.type_text.to_numpy(), trn.team_id.to_numpy(), trn.home_team_id.to_numpy(), trn.away_team_id.to_numpy()
    sc, sh = trn.scoring_play.fillna(False).astype(bool).to_numpy(), trn.shooting_play.fillna(False).astype(bool).to_numpy()
    cur, last = 0, None
    for i in range(len(trn)):
        if gid[i] != last:
            cur, last = 0, gid[i]
        side = 1 if tm[i] == hm[i] else -1 if tm[i] == aw[i] else 0
        cur = nba.poss_update(cur, tt[i], side, sc[i], sh[i])
        poss[i] = cur
    clock = trn.clock_display_value.map(parse_clock)
    df = pd.DataFrame({"game": gid, "season": trn.season.to_numpy(),
                       "hs": trn.home_score.astype(float).to_numpy(), "as_": trn.away_score.astype(float).to_numpy(),
                       "period": trn.period_number.astype(float).to_numpy(), "clock": clock.astype(float).to_numpy(),
                       "poss": poss, "strh": trn.game_id.map(pre).astype(float).to_numpy(),
                       "y": trn.game_id.map(final).astype(float).to_numpy()})
    df = df.dropna().reset_index(drop=True)
    # scores in the feed never go down: carry the running max within each game (fixes rare glitches)
    df["hs"] = df.groupby("game")["hs"].cummax()
    df["as_"] = df.groupby("game")["as_"].cummax()
    df = df[df.groupby("game")["hs"].transform("max") != df.groupby("game")["as_"].transform("max")]
    def train(S):
        tr, va = df[df.season < S - 1], df[df.season == S - 1]
        log(f"[{S}] train {len(tr):,} rows / {tr.game.nunique()} games; val {len(va):,} / {va.game.nunique()} games")
        booster, best = fit_gbm(nba.features(tr), tr.y.to_numpy(), nba.features(va), va.y.to_numpy(), nba.FEATURES,
                                nba.MONO, params={"min_data_in_leaf": 2000, "num_leaves": 31})
        trees = export_trees(booster)
        check_export(booster, trees, nba.features(va))
        return trees, best, tr, va

    predB = {}

    def espn_eval(S, ev):
        test_ids = sorted(pbp[pbp.season == S].game_id.astype(str).unique())
        ok = fetch_summaries("basketball/nba", test_ids, "nba")
        rows, skipped = [], {}
        for eid in ok:
            st, meta = nba.espn_states(load_summary("nba", eid))
            if st is None:
                skipped[meta] = skipped.get(meta, 0) + 1
                continue
            key = int(eid) if int(eid) in pre else eid
            if key not in pre:
                skipped["no elo"] = skipped.get("no elo", 0) + 1
                continue
            logit0 = pre[key] - (eparams["hfa"] / 400 * np.log(10) if st and st[0]["neutral"] else 0)
            p0 = float(sigmoid(logit0))
            for r in st:
                r.update({"pregameHomeWP": p0, "_game": eid, "_y": meta["home_win"]})
            rows += st
        log(f"[{S}] espn rows {len(rows):,}; skipped {skipped}")
        ef = nba.states_to_frame(rows)
        ef["strh"] = strh_array(rows, None)
        pb = ef.copy()
        pb["strh"] = opening_strength(rows)
        predB[S] = nba.predict_home(ev, pb)
        return rows, ef, nba.predict_home(ev, ef)

    folds = []
    for S in (TEST - 2, TEST - 1):
        trees_s = train(S)[0]
        rws, _, po = espn_eval(S, lambda F, t=trees_s: eval_trees(t, F))
        folds.append((f"{S - 1}-{str(S)[2:]}", np.array([r["_game"] for r in rws]), np.array([r["_y"] for r in rws]), po,
                      np.array([r["_espn"] for r in rws])))
    trees, best, tr, va = train(TEST)
    ev = lambda F: eval_trees(trees, F)  # noqa
    rows, ef, p_ours = espn_eval(TEST, ev)
    p_espn = np.array([r["_espn"] for r in rows])
    y = np.array([r["_y"] for r in rows])
    gm = np.array([r["_game"] for r in rows])
    pnames = [(1.0, "Q1"), (2.0, "Q2"), (3.0, "Q3"), (4.0, "Q4"), (lambda p: p >= 5, "OT")]
    md_e, met_e = espn_section("nba", f"NBA {TEST - 1}-{str(TEST)[2:]}", gm, y, p_ours, p_espn,
                               ef["period"].to_numpy(), pnames)
    folds.append((f"{TEST - 1}-{str(TEST)[2:]}", gm, y, p_ours, p_espn))
    md_r, met_r = rolling_section(folds)
    foldsB = [(fo[0], fo[1], fo[2], predB[s], fo[4]) for fo, s in zip(folds, (TEST - 2, TEST - 1, TEST))]
    md_b, met_b = rolling_section(foldsB)
    met_e["verdict"] = met_r["verdict"]

    elo = {"hfa": eparams["hfa"], "revert": eparams["revert"], "base": 1500.0, "ratings": ratings,
           "asOf": str(g.date.max())}
    write_json(os.path.join(MODELS, "wp-nba.json"),
               {"sport": "nba", "trained": dt.date.today().isoformat(), "kind": "lightgbm-flat",
                "features": nba.FEATURES, "trees": trees, "elo": elo,
                "source": f"hoopR / sportsdataverse ESPN play-by-play, seasons {FIRST - 1}-{str(FIRST)[2:]} to {TEST - 2}-{str(TEST - 1)[2:]}"})
    random.seed(3)
    idx = random.sample(range(len(rows)), min(3000, len(rows)))
    cases = [{k: v for k, v in rows[i].items() if not k.startswith("_")} for i in idx]
    for c in cases[:300]:
        c.pop("pregameHomeWP")
        c["homeTeamId"], c["awayTeamId"] = random.sample(list(elo["ratings"]), 2)
        c["season"] = TEST + random.choice([0, 1, 2])
    cf = nba.states_to_frame(cases)
    cf["strh"] = strh_array(cases, elo)
    js_cases(os.path.join(OUT, "cases-nba.json"), cases, nba.predict_home(ev, cf))

    md = ["## NBA", "",
          f"**Data.** sportsdataverse/hoopR ESPN play-by-play releases. Training: {FIRST - 1}-{str(FIRST)[2:]} to "
          f"{TEST - 2}-{str(TEST - 1)[2:]} ({tr.game.nunique() + va.game.nunique():,} games, {len(tr) + len(va):,} plays; "
          f"the last of those seasons was used for early stopping, then folded back in). Held out: {TEST - 1}-{str(TEST)[2:]} "
          f"including playoffs. Pre-game strength: Scoreline's own Elo from final scores (k={eparams['k']}, home edge "
          f"{eparams['hfa']}, {int(eparams['revert'] * 100)}% regression between seasons; pre-game log loss "
          f"{eparams['pregame_logloss']:.4f}). No betting lines are used.", "",
          f"**Model.** Gradient-boosted trees ({len(trees)} trees, 31 leaves, monotone in margin, possession and strength). "
          "Inputs: margin, seconds left, overtime, period, who has the ball (inferred from the last play), pre-game strength, "
          "strength x time left, margin / sqrt(time left).", "",
          f"### Held-out {TEST - 1}-{str(TEST)[2:]}: ours vs ESPN on ESPN's own plays", "", *md_e, "",
          "### Rolling backtest: three most recent seasons (each predicted by a model trained only on earlier seasons)", "", *md_r, "", "### Variant: same model, pre-game strength taken from ESPN instead of our Elo", "", "Same trees; the strength input is ESPN's first published win probability for the game (the app can read it live from the summary's first `winprobability` entry or the pre-game predictor). Everything else is ours.", "", *md_b]
    with open(os.path.join(REPORTS, "results-nba.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md) + "\n")
    write_json(os.path.join(REPORTS, "metrics-nba.json"), {"espn": met_e, "rolling": met_r, "rolling_espn_pregame": met_b, "elo": eparams, "trees": len(trees),
                                                            "best_rounds": best}, compact=False)
    log("done", met_e["brier_ours"], met_e["brier_other"])


if __name__ == "__main__":
    main()
