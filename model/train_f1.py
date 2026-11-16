"""F1 race-win probability per driver, lap by lap.

Data: OpenF1 (CC BY-NC-SA 4.0) lap times, pit stops and race-control messages for Grands Prix (no sprints);
grid, classification and race distance from Jolpica-F1 (CC BY-NC-SA 4.0). FastF1 was the first choice, but the
F1 live-timing archive it reads now answers 401 (checked 2026-11-15). Model: conditional logit (softmax over the drivers still running) with
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
FIRST = int(os.environ.get("F1_FIRST_SEASON", "2023"))  # OpenF1 history starts in 2023
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


OF1 = "https://api.openf1.org/v1"


def oget(path, fn):
    if os.path.exists(fn):
        return json.load(open(fn, encoding="utf-8"))
    for a in range(6):
        try:
            r = requests.get(f"{OF1}/{path}", headers=UA, timeout=60)
            if r.status_code == 429:
                time.sleep(15 * (a + 1))
                continue
            if r.status_code == 404:
                j = []
            else:
                r.raise_for_status()
                j = r.json()
            json.dump(j, open(fn, "w", encoding="utf-8"))
            time.sleep(2.2)  # free tier: 30 requests/minute
            return j
        except Exception as e:  # noqa
            log("openf1 retry", path, e)
            time.sleep(5 * (a + 1))
    raise RuntimeError(path)


def ts(s):
    return pd.Timestamp(s).timestamp() if s else None


def sc_laps(msgs):
    """Laps with a safety car, virtual safety car or red flag at any point, from race-control messages."""
    out, on, start = set(), False, None
    for m in sorted(msgs, key=lambda m: m["date"]):
        lap = m.get("lap_number") or 0
        txt = (m.get("message") or "").upper()
        cat = m.get("category") or ""
        if (cat == "SafetyCar" and "DEPLOYED" in txt) or (cat == "Flag" and m.get("flag") == "RED"):
            if not on:
                on, start = True, lap
        elif on and ((cat == "SafetyCar" and ("ENDING" in txt or "IN THIS LAP" in txt)) or
                     (cat == "Flag" and m.get("flag") == "GREEN" and m.get("scope") == "Track")):
            out.update(range(start, lap + 1))
            on = False
    if on:
        out.update(range(start, 1000))
    return out


def load_race(season, rnd, skey):
    d = os.path.join(DATA, "f1")
    res = jget(f"{JOL}/{season}/{rnd}/results.json", os.path.join(d, f"res_{season}_{rnd}.json"))
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
    laps = oget(f"laps?session_key={skey}", os.path.join(d, f"of1_laps_{skey}.json"))
    pits = oget(f"pit?session_key={skey}", os.path.join(d, f"of1_pit_{skey}.json"))
    rc = oget(f"race_control?session_key={skey}", os.path.join(d, f"of1_rc_{skey}.json"))
    if not laps:
        return None, "no laps"
    start = {}
    for l in laps:
        start[(str(l["driver_number"]), int(l["lap_number"]))] = (ts(l.get("date_start")), l.get("lap_duration"))
    end = {}
    for (n, L), (t0, dur) in start.items():
        nxt = start.get((n, L + 1))
        if nxt and nxt[0]:
            end[(n, L)] = nxt[0]
        elif t0 and dur:
            end[(n, L)] = t0 + float(dur)
    stops = {}
    for p in pits:
        if p.get("lap_number"):
            stops.setdefault(str(p["driver_number"]), []).append(int(p["lap_number"]))
    scl = sc_laps(rc)
    snaps = [{"lap": 0, "sc": 0.0, "drivers": [{"id": n, "position": (g if g > 0 else 20), "gapToLeader": 0.0,
                                                 "pitStops": 0, "gridPosition": g} for n, g in grid.items()]}]
    for L in range(1, total):
        cur = sorted(((t, n) for (n, l), t in end.items() if l == L and t), key=lambda x: x[0])
        if len(cur) < 3 or winner not in {n for _, n in cur}:
            continue
        t0 = cur[0][0]
        ds = [{"id": n, "position": i + 1, "gapToLeader": float(t - t0),
               "pitStops": sum(1 for s in stops.get(n, []) if s <= L), "gridPosition": grid.get(n, 20)}
              for i, (t, n) in enumerate(cur)]
        snaps.append({"lap": L, "sc": 1.0 if L in scl else 0.0, "drivers": ds})
    return {"season": season, "round": rnd, "total": total, "winner": winner, "snaps": snaps,
            "name": races[0]["raceName"], "sc_laps": sorted(x for x in scl if x <= total)}, None


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
    os.makedirs(os.path.join(DATA, "f1"), exist_ok=True)
    races, fails = [], []
    for season in range(FIRST, TEST + 1):
        sch = jget(f"{JOL}/{season}.json?limit=100", os.path.join(DATA, "f1", f"sched_{season}.json"))
        sess = oget(f"sessions?year={season}&session_name=Race", os.path.join(DATA, "f1", f"of1_sessions_{season}.json"))
        by_date = {s["date_start"][:10]: s["session_key"] for s in sess if s.get("date_start")}
        for rc in sch["MRData"]["RaceTable"]["Races"]:
            if rc["date"] >= dt.date.today().isoformat():
                continue
            pk = os.path.join(DATA, "f1", f"race2_{season}_{rc['round']}.json")
            if os.path.exists(pk):
                races.append(json.load(open(pk, encoding="utf-8")))
                continue
            d0 = dt.date.fromisoformat(rc["date"])
            skey = next((by_date[k] for k in (str(d0), str(d0 - dt.timedelta(days=1)), str(d0 + dt.timedelta(days=1)))
                         if k in by_date), None)
            if skey is None:
                fails.append((season, rc["round"], rc["raceName"], "no OpenF1 session"))
                continue
            try:
                r, why = load_race(season, int(rc["round"]), skey)
            except Exception as e:  # noqa
                r, why = None, f"{type(e).__name__}: {e}"[:160]
            if r is None:
                fails.append((season, rc["round"], rc["raceName"], why))
                log("skip", season, rc["round"], rc["raceName"], why)
                continue
            json.dump(r, open(pk, "w", encoding="utf-8"))
            races.append(r)
            log(f"{season} R{rc['round']} {rc['raceName']}: {len(r['snaps'])} laps, SC laps {r['sc_laps']}")
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
                "source": f"OpenF1 lap times, pit stops, race control + Jolpica-F1 results, Grands Prix {FIRST}-{TEST - 1}"}, compact=False)
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
          f"**Data.** OpenF1 lap times, pit stops and race-control messages (CC BY-NC-SA 4.0; OpenF1 history starts in 2023) for every Grand Prix {FIRST}-{TEST} that loaded, plus grid slots, "
          f"race distance and winners from Jolpica-F1 (CC BY-NC-SA 4.0). Sprints excluded. FastF1 was tried first, but the F1 live-timing archive it reads now returns 401 Unauthorized, so it could not be used. Safety car, VSC and red flag laps come from race-control messages. Training: {FIRST}-{TEST - 1} "
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
