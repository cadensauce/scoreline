"""F1 race-win probability per driver, lap by lap.

Data: FastF1 (MIT) lap timing for Grands Prix (no sprints); grid, classification and race distance from
Jolpica-F1 (CC BY-NC-SA 4.0). Model: conditional logit (softmax over the drivers still running) with
features for position, gap to the leader, laps left, safety car, pit stops vs the leader and grid slot.
There is no ESPN F1 win probability, and the app shows none today, so the comparison is against simple
baselines (grid only; position + race progress)."""
import datetime as dt
import json
import os
import random
import time

import numpy as np
import pandas as pd
import requests
from scipy.optimize import minimize

from common import DATA, MODELS, OUT, REPORTS, UA, log, plot_calibration, write_json

TEST = int(os.environ.get("F1_TEST_SEASON", "2025"))
FIRST = int(os.environ.get("F1_FIRST_SEASON", "2019"))
JOL = "https://api.jolpi.ca/ergast/f1"
FEATURES = ["lpos", "lpos_r", "gap_per_lap", "gap_per_lap_sc", "lgrid", "lgrid_left", "stops_vs_leader",
            "stops_vs_leader_r", "gap10", "gap10_sc"]
GAP_CAP = 150.0


def jget(url, fn):
    if os.path.exists(fn):
        return json.load(open(fn, encoding="utf-8"))
    for a in range(5):
        try:
            r = requests.get(url, headers=UA, timeout=30)
            if r.status_code == 429:
                time.sleep(20 * (a + 1))
                continue
            r.raise_for_status()
            j = r.json()
            json.dump(j, open(fn, "w", encoding="utf-8"))
            time.sleep(0.6)
            return j
        except Exception as e:  # noqa
            log("jolpica retry", url, e)
            time.sleep(5 * (a + 1))
    raise RuntimeError(url)


def feature_rows(drivers, lap, total, sc):
    """drivers: list of dicts {id, position, gapToLeader, pitStops, gridPosition}. Same math as wp.js."""
    r = lap / total if total else 0.0
    left = max(total - lap, 0)
    leader = min(drivers, key=lambda d: d["position"])
    lst = leader.get("pitStops") or 0
    X = []
    for d in drivers:
        pos = max(1.0, float(d["position"]))
        g = d.get("gapToLeader")
        g = GAP_CAP if g is None else min(max(float(g), 0.0), GAP_CAP)
        grid = d.get("gridPosition")
        grid = 20.0 if not grid or grid < 1 else float(grid)
        sv = float((d.get("pitStops") or 0) - lst)
        gpl = g / (left + 1)
        X.append([np.log(pos), np.log(pos) * r, gpl, gpl * sc, np.log(grid), np.log(grid) * (1 - r), sv, sv * r,
                  g / 10, g / 10 * sc])
    return np.array(X, dtype=float)


def load_race(season, rnd, cache):
    import fastf1

    res = jget(f"{JOL}/{season}/{rnd}/results.json", os.path.join(DATA, "f1", f"res_{season}_{rnd}.json"))
    races = res["MRData"]["RaceTable"]["Races"]
    if not races:
        return None, "no results"
    R = races[0]["Results"]
    win = [x for x in R if x["position"] == "1"]
    if not win:
        return None, "no winner"
    total = int(win[0]["laps"])
    grid = {x["number"]: int(x["grid"]) for x in R}
    winner = win[0]["number"]
    code = {x["number"]: x["Driver"].get("code") or x["Driver"]["driverId"] for x in R}
    sess = fastf1.get_session(season, rnd, "R")
    sess.load(laps=True, telemetry=False, weather=False, messages=False)
    laps = sess.laps
    if laps is None or len(laps) == 0:
        return None, "no laps"
    lp = pd.DataFrame({"num": laps["DriverNumber"].astype(str).to_numpy(),
                       "lap": laps["LapNumber"].astype(float).to_numpy(),
                       "t": laps["Time"].dt.total_seconds().to_numpy(),
                       "pit": laps["PitInTime"].notna().to_numpy(),
                       "ts": laps["TrackStatus"].astype(str).to_numpy(),
                       "fpos": laps["Position"].astype(float).to_numpy()})
    lp = lp.sort_values(["num", "lap"])
    lp["stops"] = lp.groupby("num")["pit"].cumsum()  # pit stops made by the end of this lap
    snaps = []
    starters = [n for n in grid if n in code]
    snaps.append({"lap": 0, "sc": 0.0, "drivers": [{"id": n, "position": (grid[n] if grid[n] > 0 else 20),
                                                     "gapToLeader": 0.0, "pitStops": 0, "gridPosition": grid[n]}
                                                    for n in starters]})
    for L in range(1, total):
        cur = lp[(lp.lap == L)]
        cur = cur[np.isfinite(cur.t)]
        if len(cur) < 3 or winner not in set(cur.num):
            continue
        cur = cur.sort_values("t")
        t0 = cur.t.min()
        sc = 1.0 if any(c in "".join(cur.ts.tolist()) for c in "4567") else 0.0
        ds = [{"id": r.num, "position": i + 1, "gapToLeader": float(r.t - t0), "pitStops": int(r.stops),
               "gridPosition": grid.get(r.num, 20)} for i, r in enumerate(cur.itertuples())]
        snaps.append({"lap": L, "sc": sc, "drivers": ds})
    return {"season": season, "round": rnd, "total": total, "winner": winner, "snaps": snaps,
            "name": races[0]["raceName"], "codes": code}, None


def build(races, feats=FEATURES):
    X, y, grp, meta = [], [], [], []
    gi = 0
    for rc in races:
        for sn in rc["snaps"]:
            F = feature_rows(sn["drivers"], sn["lap"], rc["total"], sn["sc"])
            ids = [d["id"] for d in sn["drivers"]]
            if rc["winner"] not in ids:
                continue
            X.append(F)
            y += [1.0 if i == rc["winner"] else 0.0 for i in ids]
            grp += [gi] * len(ids)
            meta += [(rc["season"], rc["round"], sn["lap"], i) for i in ids]
            gi += 1
    idx = [FEATURES.index(f) for f in feats]
    return np.vstack(X)[:, idx], np.array(y), np.array(grp), meta


def softmax_groups(s, grp):
    starts = np.r_[0, np.flatnonzero(np.diff(grp)) + 1]
    mx = np.maximum.reduceat(s, starts)
    e = np.exp(s - np.repeat(mx, np.diff(np.r_[starts, len(s)])))
    z = np.add.reduceat(e, starts)
    return e / np.repeat(z, np.diff(np.r_[starts, len(s)])), starts


def fit(X, y, grp, l2=1e-3):
    ng = len(np.unique(grp))

    def f(w):
        p, starts = softmax_groups(X @ w, grp)
        ll = -np.sum(np.log(np.clip(p[y == 1], 1e-12, 1))) / ng + l2 * w @ w
        g = X.T @ (p - y) / ng + 2 * l2 * w
        return ll, g

    w = minimize(f, np.zeros(X.shape[1]), jac=True, method="L-BFGS-B", options={"maxiter": 2000}).x
    return w


def scores(X, y, grp, w):
    p, starts = softmax_groups(X @ w, grp)
    sq = np.add.reduceat((p - y) ** 2, starts)
    ll = -np.log(np.clip(p[y == 1], 1e-3, 1))
    return float(sq.mean()), float(ll.mean()), p


def main():
    import fastf1

    cache = os.path.join(DATA, "f1", "fastf1")
    os.makedirs(cache, exist_ok=True)
    fastf1.Cache.enable_cache(cache)
    fastf1.set_log_level("WARNING")
    races, fails = [], []
    for season in range(FIRST, TEST + 1):
        sch = jget(f"{JOL}/{season}.json?limit=100", os.path.join(DATA, "f1", f"sched_{season}.json"))
        for rc in sch["MRData"]["RaceTable"]["Races"]:
            if rc["date"] >= dt.date.today().isoformat():
                continue
            pk = os.path.join(DATA, "f1", f"race_{season}_{rc['round']}.json")
            if os.path.exists(pk):
                races.append(json.load(open(pk, encoding="utf-8")))
                continue
            try:
                r, why = load_race(season, int(rc["round"]), cache)
            except Exception as e:  # noqa
                r, why = None, f"{type(e).__name__}: {e}"[:160]
            if r is None:
                fails.append((season, rc["round"], rc["raceName"], why))
                log("skip", season, rc["round"], rc["raceName"], why)
                continue
            json.dump(r, open(pk, "w", encoding="utf-8"))
            races.append(r)
            log(f"{season} R{rc['round']} {rc['raceName']}: {len(r['snaps'])} laps")
    tr = [r for r in races if r["season"] < TEST]
    te = [r for r in races if r["season"] == TEST]
    log(f"races: train {len(tr)}, test {len(te)}, failed {len(fails)}")
    Xtr, ytr, gtr, _ = build(tr)
    Xte, yte, gte, mte = build(te)
    w = fit(Xtr, ytr, gtr)
    log("weights", dict(zip(FEATURES, np.round(w, 4))))
    b_ours, l_ours, p_ours = scores(Xte, yte, gte, w)
    base = {}
    for name, feats in (("Grid only (pre-race order, never updates)", ["lgrid"]),
                        ("Position + race progress", ["lpos", "lpos_r"])):
        idx = [FEATURES.index(f) for f in feats]
        wb = fit(Xtr[:, idx], ytr, gtr)
        b, l, p = scores(Xte[:, idx], yte, gte, wb)
        base[name] = (b, l, p)
    # swings: per driver, change between consecutive snapshots of the same race
    key = pd.DataFrame(mte, columns=["season", "round", "lap", "id"])
    key["p"] = p_ours
    key = key.sort_values(["season", "round", "id", "lap"])
    dd = key.groupby(["season", "round", "id"])["p"].diff().abs().dropna()
    key2 = key.copy()
    key2["pb"] = base["Position + race progress"][2][key.index]
    dd2 = key2.groupby(["season", "round", "id"])["pb"].diff().abs().dropna()
    plot_calibration(os.path.join(REPORTS, "calibration-f1.png"), f"F1 {TEST}: held-out calibration (each driver, each lap)",
                     [("Scoreline (ours)", p_ours), ("Position + progress baseline", base["Position + race progress"][2]),
                      ("Grid-only baseline", base["Grid only (pre-race order, never updates)"][2])], yte)
    # calibration table
    edges = np.linspace(0, 1, 11)
    cal = []
    for b in range(10):
        sel = (p_ours >= edges[b]) & ((p_ours < edges[b + 1]) if b < 9 else (p_ours <= 1))
        if sel.any():
            cal.append(f"| {int(edges[b] * 100)}-{int(edges[b + 1] * 100)}% | {sel.sum():,} | {p_ours[sel].mean() * 100:.1f}% | {yte[sel].mean() * 100:.1f}% |")

    write_json(os.path.join(MODELS, "wp-f1.json"),
               {"sport": "f1", "trained": dt.date.today().isoformat(), "kind": "conditional-logit",
                "features": FEATURES, "weights": [float(x) for x in w], "gapCap": GAP_CAP,
                "source": f"FastF1 lap timing + Jolpica-F1 results, Grands Prix {FIRST}-{TEST - 1}"}, compact=False)
    # JS parity cases
    random.seed(3)
    cases = []
    allsn = [(rc, sn) for rc in te for sn in rc["snaps"]]
    for rc, sn in random.sample(allsn, min(150, len(allsn))):
        st = {"lap": sn["lap"], "totalLaps": rc["total"], "safetyCar": bool(sn["sc"]),
              "drivers": [dict(d) for d in sn["drivers"]]}
        if random.random() < 0.2:
            st["drivers"][-1]["gapToLeader"] = None
        F = feature_rows(st["drivers"], st["lap"], st["totalLaps"], 1.0 if st["safetyCar"] else 0.0)
        s = F @ w
        e = np.exp(s - s.max())
        pp = e / e.sum()
        for d, v in zip(st["drivers"], pp):
            cases.append({"state": st, "driver": d["id"], "expected": float(v)})
    write_json(os.path.join(OUT, "cases-f1.json"), {"cases": cases})

    n_snap_te = len(np.unique(gte))
    best_base = min(b[0] for b in base.values())
    v = "ship ours (no ESPN number exists)" if b_ours < best_base and l_ours < min(b[1] for b in base.values()) else "show nothing"
    md = ["## F1", "",
          f"**Data.** FastF1 lap timing (MIT; data from F1 live timing) for every Grand Prix {FIRST}-{TEST} that loaded, plus grid slots, "
          f"race distance and winners from Jolpica-F1 (CC BY-NC-SA 4.0). Sprints excluded. Training: {FIRST}-{TEST - 1} "
          f"({len(tr)} races, {len(np.unique(gtr)):,} lap snapshots, {len(ytr):,} driver-laps). Held out: {TEST} "
          f"({len(te)} races, {n_snap_te:,} lap snapshots, {len(yte):,} driver-laps)."
          + (f" Races that failed to load: {len(fails)} ({'; '.join(f'{a} R{b} {c}' for a, b, c, _ in fails[:12])})." if fails else ""),
          "",
          "**Model.** Conditional logit: each driver gets a score from position, gap to the leader per lap left, "
          "the same under a safety car / VSC / red flag, grid slot fading with race progress, pit stops made versus the leader, "
          "and the raw gap; the win probabilities are the softmax of the scores over the drivers still running, so they always sum to 100%. "
          "10 weights in `models/wp-f1.json`.", "",
          f"### Held-out {TEST}", "",
          "There is no ESPN F1 win probability and the app shows none today, so the comparison is against two simple baselines fitted on the same training races. "
          "Brier = sum over drivers of (p - won)^2 per lap snapshot, averaged; log loss = -log(probability given to the eventual winner).", "",
          "| Model | Brier (lower is better) | Log loss (lower is better) |", "|---|---|---|",
          f"| Scoreline (ours) | **{b_ours:.4f}** | **{l_ours:.4f}** |"]
    for name, (b, l, _) in base.items():
        md.append(f"| {name} | {b:.4f} | {l:.4f} |")
    md += ["", f"**Swings check:** mean change per driver per lap {dd.mean() * 100:.2f} pts (99th pct {np.percentile(dd, 99) * 100:.1f} pts); "
               f"position + progress baseline {dd2.mean() * 100:.2f} pts (99th pct {np.percentile(dd2, 99) * 100:.1f} pts).", "",
           f"![F1 calibration](./calibration-f1.png)", "",
           "| Bin | Driver-laps | Predicted | Actual win share |", "|---|---|---|---|", *cal, "",
           f"**Automatic verdict: {v}.**"]
    with open(os.path.join(REPORTS, "results-f1.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md) + "\n")
    write_json(os.path.join(REPORTS, "metrics-f1.json"),
               {"brier_ours": b_ours, "logloss_ours": l_ours,
                "baselines": {k: {"brier": b, "logloss": l} for k, (b, l, _) in base.items()},
                "races_train": len(tr), "races_test": len(te), "failed": fails, "weights": dict(zip(FEATURES, map(float, w))),
                "swings_mean": float(dd.mean()), "verdict": v,
                "summary_row": f"{n_snap_te:,} lap snapshots ({len(te)} races); Brier {b_ours:.4f} vs best baseline {best_base:.4f} (no ESPN F1 number)"},
               compact=False)
    log("done", b_ours, l_ours, {k: v[:2] for k, v in base.items()})


if __name__ == "__main__":
    main()
