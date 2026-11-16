"""College football win probability: train on ESPN play-by-play of FBS games (game lists and results from
the sportsdataverse cfb_schedules releases), backtest on the most recent full season against ESPN's
live win probability on the same plays."""
import datetime as dt
import os
import random

import numpy as np
import pandas as pd

import football as fb
from backtest import espn_section
from common import (DATA, MODELS, OUT, REPORTS, check_export, download, eval_trees, export_trees, fetch_summaries,
                    fit_gbm, js_cases, load_summary, log, run_elo, sigmoid, tune_elo, write_json)
from strength import strh_array

TEST = int(os.environ.get("CFB_TEST_SEASON", "2025"))
FIRST = int(os.environ.get("CFB_FIRST_SEASON", "2017"))
SCHED = "https://github.com/sportsdataverse/sportsdataverse-data/releases/download/cfb_schedules/cfb_schedules_{}.csv.gz"
BASES = {"fbs": 1500.0, "fcs": 1250.0}
OTHER = 1000.0


def main():
    d = os.path.join(DATA, "cfb")
    sch = []
    for s in range(2004, TEST + 2):
        fn = download(SCHED.format(s), os.path.join(d, f"sched_{s}.csv.gz"), optional=True)
        if fn:
            sch.append(pd.read_csv(fn, low_memory=False))
    sc = pd.concat(sch, ignore_index=True).drop_duplicates("game_id")
    sc = sc.sort_values(["start_date", "game_id"]).reset_index(drop=True)
    sc["home_id"] = sc.home_id.astype("Int64").astype(str)
    sc["away_id"] = sc.away_id.astype("Int64").astype(str)
    div = {}
    for r in sc.itertuples():
        div[r.home_id] = str(r.home_division).lower()
        div[r.away_id] = str(r.away_division).lower()
    base_of = lambda t: BASES.get(div.get(t), OTHER)  # noqa
    comp = sc[(sc.completed == True) & sc.home_points.notna() & sc.away_points.notna()]  # noqa
    glist = [{"gid": int(r.game_id), "season": int(r.season), "home": r.home_id, "away": r.away_id,
              "hs": float(r.home_points), "as": float(r.away_points), "neutral": bool(r.neutral_site)}
             for r in comp.itertuples()]
    log(f"schedule: {len(glist):,} completed games {comp.season.min()}-{comp.season.max()}")
    eparams = tune_elo(glist, {"k": [20, 30, 40], "hfa": [40, 60, 80], "revert": [0.2, 0.33, 0.5]},
                       set(range(2008, TEST)), mov="football", base_of=base_of)
    pre, ratings = run_elo(glist, eparams["k"], eparams["hfa"], eparams["revert"], mov="football", base_of=base_of)

    fbs = comp[(comp.season >= FIRST) & (comp.season <= TEST) & (comp.fbs_game == True)]  # noqa
    log(f"FBS games {FIRST}-{TEST}: {len(fbs):,}")
    ok = set(fetch_summaries("football/college-football", fbs.game_id.astype(int).astype(str).tolist(), "cfb"))
    season_of = dict(zip(fbs.game_id.astype(int).astype(str), fbs.season.astype(int)))
    train_rows, test_rows, skipped = [], [], {}
    for eid in sorted(ok):
        st, meta = fb.espn_states(load_summary("cfb", eid), require_wp=(season_of[eid] == TEST))
        if st is None:
            skipped[meta] = skipped.get(meta, 0) + 1
            continue
        if int(eid) not in pre:
            continue
        p0 = float(sigmoid(pre[int(eid)]))
        for r in st:
            r.update({"pregameHomeWP": p0, "_game": eid, "_y": meta["home_win"], "_season": season_of[eid],
                      "_strh": pre[int(eid)]})
        (test_rows if season_of[eid] == TEST else train_rows).extend(st)
    log(f"rows: train {len(train_rows):,}, test {len(test_rows):,}; skipped {skipped}")

    tf = fb.canonical(fb.states_to_frame(train_rows), "cfb")
    tf["strh"] = [r["_strh"] for r in train_rows]
    tf["season"] = [r["_season"] for r in train_rows]
    tf["game"] = [r["_game"] for r in train_rows]
    hw = np.array([r["_y"] for r in train_rows])
    # unknown possession rows can't be oriented; drop them from training only
    tf["hw"] = hw
    tf = tf[tf.poss != 0].reset_index(drop=True)
    tf["y"] = np.where(tf.poss > 0, tf.hw, 1 - tf.hw)
    tr, va = tf[tf.season < TEST - 1], tf[tf.season == TEST - 1]
    log(f"train {len(tr):,} rows / {tr.game.nunique()} games; val {len(va):,} / {va.game.nunique()} games")
    X = lambda f: fb.features(f, "cfb", f["poss"].to_numpy())  # noqa
    booster, best = fit_gbm(X(tr), tr.y.to_numpy(), X(va), va.y.to_numpy(), fb.CFB_FEATURES, fb.CFB_MONO)
    trees = export_trees(booster)
    check_export(booster, trees, X(va))
    ev = lambda F: eval_trees(trees, F)  # noqa

    ef = fb.states_to_frame(test_rows)
    ef["strh"] = strh_array(test_rows, None)
    can = fb.canonical(ef, "cfb")
    p_ours = fb.predict_home(ev, can, "cfb")
    p_espn = np.array([r["_espn"] for r in test_rows])
    y = np.array([r["_y"] for r in test_rows])
    gm = np.array([r["_game"] for r in test_rows])
    pnames = [(1.0, "Q1"), (2.0, "Q2"), (3.0, "Q3"), (4.0, "Q4"), (lambda p: p >= 5, "OT")]
    md_e, met_e = espn_section("cfb", f"College football {TEST}", gm, y, p_ours, p_espn, can["period"].to_numpy(), pnames)

    recent = {t for g in glist if g["season"] >= TEST - 1 for t in (g["home"], g["away"])}
    elo = {"hfa": eparams["hfa"], "revert": eparams["revert"], "base": OTHER,
           "bases": {t: base_of(t) for t in recent if base_of(t) != OTHER},
           "ratings": {t: v for t, v in ratings.items() if t in recent}, "asOf": str(comp.start_date.max())[:10]}
    write_json(os.path.join(MODELS, "wp-cfb.json"),
               {"sport": "cfb", "trained": dt.date.today().isoformat(), "kind": "lightgbm-flat",
                "features": fb.CFB_FEATURES, "trees": trees, "elo": elo,
                "source": f"ESPN play-by-play of FBS games {FIRST}-{TEST - 1}; schedules/results from sportsdataverse cfb_schedules"})
    random.seed(3)
    idx = random.sample(range(len(test_rows)), min(3000, len(test_rows)))
    cases = [{k: v for k, v in test_rows[i].items() if not k.startswith("_")} for i in idx]
    fbs_ids = [t for t in elo["ratings"] if base_of(t) == 1500.0]
    for c in cases[:300]:
        c.pop("pregameHomeWP")
        c["homeTeamId"], c["awayTeamId"] = random.sample(fbs_ids, 2)
        c["season"] = TEST + random.choice([0, 1, 2])
    for c in cases[300:330]:
        c.pop("pregameHomeWP", None)
        c["homeTeamId"], c["awayTeamId"] = "999999", random.choice(fbs_ids)
    for c in cases[330:400]:
        c["possession"] = None
    cf = fb.states_to_frame(cases)
    cf["strh"] = strh_array(cases, elo)
    js_cases(os.path.join(OUT, "cases-cfb.json"), cases, fb.predict_home(ev, fb.canonical(cf, "cfb"), "cfb"))

    md = ["## College football", "",
          f"**Data.** ESPN play-by-play (summary endpoint) for FBS games, {FIRST}-{TEST - 1} for training "
          f"({tr.game.nunique() + va.game.nunique():,} games, {len(tr) + len(va):,} plays; {TEST - 1} used for early stopping, then folded back in). "
          f"Game lists and final scores: sportsdataverse `cfb_schedules` releases (2004 on). Held out: the {TEST} season "
          f"({len(np.unique(gm))} FBS games with ESPN win probability). "
          "We used ESPN's own play-by-play instead of the cfbfastR play files because the current cfbfastR release is built from "
          "a different (NCAA) feed whose field conventions don't match what the app receives live; training on the same feed the app uses avoids that mismatch. "
          f"Pre-game strength: Scoreline's own Elo over all divisions (k={eparams['k']}, home edge {eparams['hfa']}, "
          f"{int(eparams['revert'] * 100)}% regression; FBS start 1500, FCS 1250, others 1000; pre-game log loss {eparams['pregame_logloss']:.4f}). No betting lines.",
          "", f"**Model.** Gradient-boosted trees ({len(trees)} trees, 15 leaves). Same inputs as NFL minus timeouts "
          "(not reliably in the college feed) plus the period number (overtime rules change by period). "
          "Kickoff and extra-point moments are treated as the receiving team's 1st and 10 at its own 25.", "",
          f"### Held-out {TEST}: ours vs ESPN on ESPN's own plays", "", *md_e]
    with open(os.path.join(REPORTS, "results-cfb.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md) + "\n")
    write_json(os.path.join(REPORTS, "metrics-cfb.json"), {"espn": met_e, "elo": eparams, "trees": len(trees),
                                                            "best_rounds": best}, compact=False)
    log("done", met_e["brier_ours"], met_e["brier_other"])


if __name__ == "__main__":
    main()
