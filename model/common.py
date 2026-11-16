"""Shared helpers for Scoreline's win-probability training and backtests.

Runs in GitHub Actions only (see .github/workflows/winprob.yml). Everything here is
deterministic given the downloaded data.
"""
import gzip
import json
import math
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "model-data")
MODELS = os.path.join(ROOT, "models")
REPORTS = os.path.join(ROOT, "reports", "winprob")
OUT = os.path.join(ROOT, "model-out")  # not committed (JS check cases)
for d in (DATA, MODELS, REPORTS, OUT):
    os.makedirs(d, exist_ok=True)

UA = {"User-Agent": "Mozilla/5.0 (compatible; win-probability-backtest)"}
EPS = 1e-3  # probabilities are clipped to [EPS, 1-EPS] for log loss (both models alike)


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# ---------------------------------------------------------------- downloads
def download(url, path, optional=False):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for attempt in range(4):
        try:
            r = requests.get(url, headers=UA, timeout=120, stream=True)
            if r.status_code == 404 and optional:
                return None
            r.raise_for_status()
            tmp = path + ".part"
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
            os.replace(tmp, path)
            return path
        except Exception as e:  # noqa
            if attempt == 3:
                if optional:
                    log("download failed", url, e)
                    return None
                raise
            time.sleep(3 * (attempt + 1))


ESPN_SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/{path}/summary?event={id}"
KEEP_KEYS = ("header", "drives", "plays", "winprobability")


def _fetch_summary(args):
    path, gid, cache = args
    fn = os.path.join(cache, f"{gid}.json.gz")
    if os.path.exists(fn):
        return gid, True
    for attempt in range(4):
        try:
            r = requests.get(ESPN_SUMMARY.format(path=path, id=gid), headers=UA, timeout=30)
            if r.status_code == 404:
                return gid, False
            r.raise_for_status()
            j = r.json()
            slim = {k: j.get(k) for k in KEEP_KEYS if k in j}
            with gzip.open(fn + ".part", "wt", encoding="utf-8") as f:
                json.dump(slim, f)
            os.replace(fn + ".part", fn)
            return gid, True
        except Exception:
            time.sleep(2 * (attempt + 1))
    return gid, False


def fetch_summaries(path, ids, league, threads=8):
    """Download (and cache) ESPN summary JSON for each event id. Returns ids that exist."""
    cache = os.path.join(DATA, "espn", league)
    os.makedirs(cache, exist_ok=True)
    ids = [str(i) for i in ids]
    ok = []
    t0 = time.time()
    with ThreadPoolExecutor(threads) as ex:
        for n, (gid, good) in enumerate(ex.map(_fetch_summary, [(path, i, cache) for i in ids])):
            if good:
                ok.append(gid)
            if n % 250 == 0:
                log(f"  espn {league}: {n}/{len(ids)} ({time.time() - t0:.0f}s)")
    log(f"espn {league}: {len(ok)}/{len(ids)} summaries available")
    return ok


def load_summary(league, gid):
    with gzip.open(os.path.join(DATA, "espn", league, f"{gid}.json.gz"), "rt", encoding="utf-8") as f:
        return json.load(f)


def parse_clock(s):
    """'14:52' -> 892.0, '34.5' -> 34.5, None -> None."""
    if s is None:
        return None
    s = str(s).strip()
    try:
        if ":" in s:
            m, sec = s.split(":", 1)
            return int(m) * 60 + float(sec)
        return float(s)
    except ValueError:
        return None


def header_teams(summary):
    comp = (summary.get("header") or {}).get("competitions", [{}])[0]
    home = away = None
    for c in comp.get("competitors", []):
        if c.get("homeAway") == "home":
            home = c
        elif c.get("homeAway") == "away":
            away = c
    return comp, home, away


# ---------------------------------------------------------------- Elo
def logit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def run_elo(games, k, hfa, revert, mov="football", base_of=None, default_base=1500.0):
    """games: list of dicts sorted by date with keys gid, season, home, away, hs, as, neutral.
    Returns (pregame_home_logit by gid, ratings {team: [rating, last_season]}).
    base_of(team) gives the mean a team regresses to between seasons."""
    R, last = {}, {}
    pre = {}
    for g in games:
        h, a, s = g["home"], g["away"], g["season"]
        for t in (h, a):
            b = base_of(t) if base_of else default_base
            if t not in R:
                R[t] = b
            elif last[t] != s:
                R[t] = b + (R[t] - b) * (1 - revert)
            last[t] = s
        d = R[h] - R[a] + (0 if g["neutral"] else hfa)
        pre[g["gid"]] = d / 400 * math.log(10)
        if g["hs"] is None or g["as"] is None:
            continue
        m = g["hs"] - g["as"]
        exp_h = 1 / (1 + 10 ** (-d / 400))
        res = 1.0 if m > 0 else 0.0 if m < 0 else 0.5
        dw = d if m > 0 else -d  # winner's elo edge
        if mov == "football":
            mult = math.log(abs(m) + 1) * 2.2 / (dw * 0.001 + 2.2) if m != 0 else 1.0
        else:  # basketball (FiveThirtyEight NBA form)
            mult = ((abs(m) + 3) ** 0.8) / (7.5 + 0.006 * dw) if m != 0 else 1.0
        delta = k * mult * (res - exp_h)
        R[h] += delta
        R[a] -= delta
    return pre, {t: [round(R[t], 2), last[t]] for t in R}


def tune_elo(games, grid, eval_seasons, **kw):
    """Grid search Elo (k, hfa, revert) on pregame log loss over eval_seasons (training years only)."""
    best = None
    for k in grid["k"]:
        for hfa in grid["hfa"]:
            for rv in grid["revert"]:
                pre, _ = run_elo(games, k, hfa, rv, **kw)
                ys, ps = [], []
                for g in games:
                    if g["season"] in eval_seasons and g["hs"] is not None and g["hs"] != g["as"]:
                        ys.append(1.0 if g["hs"] > g["as"] else 0.0)
                        ps.append(sigmoid(pre[g["gid"]]))
                ll = logloss(np.array(ys), np.array(ps))
                if best is None or ll < best[0]:
                    best = (ll, k, hfa, rv, len(ys))
    log(f"elo tuned: logloss {best[0]:.4f} k={best[1]} hfa={best[2]} revert={best[3]} (n={best[4]})")
    return {"k": best[1], "hfa": best[2], "revert": best[3], "pregame_logloss": best[0], "n": best[4]}


# ---------------------------------------------------------------- GBM
def fit_gbm(Xtr, ytr, Xva, yva, names, monotone, params=None, max_rounds=800):
    import lightgbm as lgb

    p = dict(objective="binary", learning_rate=0.05, num_leaves=15, min_data_in_leaf=400,
             lambda_l2=5.0, bagging_fraction=0.8, bagging_freq=1, feature_fraction=1.0,
             monotone_constraints=monotone, monotone_constraints_method="advanced",
             verbose=-1, seed=7, deterministic=True, force_row_wise=True, num_threads=4)
    if params:
        p.update(params)
    dtr = lgb.Dataset(Xtr, ytr, feature_name=names, free_raw_data=False)
    dva = lgb.Dataset(Xva, yva, reference=dtr)
    b = lgb.train(p, dtr, num_boost_round=max_rounds, valid_sets=[dva],
                  callbacks=[lgb.early_stopping(60, verbose=False), lgb.log_evaluation(100)])
    best = b.best_iteration or max_rounds
    log(f"gbm early-stopped at {best} rounds (val logloss {b.best_score['valid_0']['binary_logloss']:.4f})")
    # refit on train + validation with the chosen number of rounds
    X = np.vstack([Xtr, Xva])
    y = np.concatenate([ytr, yva])
    b2 = lgb.train(p, lgb.Dataset(X, y, feature_name=names), num_boost_round=int(best * 1.05) + 1)
    return b2, best


def export_trees(booster):
    """LightGBM booster -> compact flat trees {s,t,l,r,v}. Child >=0 is a split node, <0 is leaf ~c."""
    dump = booster.dump_model()
    trees = []
    for ti in dump["tree_info"]:
        root = ti["tree_structure"]
        if "split_index" not in root:
            trees.append({"s": [], "t": [], "l": [], "r": [], "v": [round(root["leaf_value"], 10)]})
            continue
        ns = ti["num_leaves"] - 1
        s, t, l, r = [0] * ns, [0.0] * ns, [0] * ns, [0] * ns
        v = [0.0] * ti["num_leaves"]

        def ref(node):
            return node["split_index"] if "split_index" in node else -(node["leaf_index"] + 1)

        stack = [root]
        while stack:
            nd = stack.pop()
            if "split_index" not in nd:
                v[nd["leaf_index"]] = round(nd["leaf_value"], 10)
                continue
            assert nd["decision_type"] == "<=", nd["decision_type"]
            i = nd["split_index"]
            s[i], t[i] = nd["split_feature"], float(nd["threshold"])
            l[i], r[i] = ref(nd["left_child"]), ref(nd["right_child"])
            stack += [nd["left_child"], nd["right_child"]]
        trees.append({"s": s, "t": t, "l": l, "r": r, "v": v})
    return trees


def eval_trees(trees, X):
    """Raw score of exported trees (same arithmetic as models/wp.js)."""
    X = np.asarray(X, dtype=np.float64)
    n = X.shape[0]
    total = np.zeros(n)
    for tr in trees:
        if not tr["s"]:
            total += tr["v"][0]
            continue
        s, t = np.array(tr["s"]), np.array(tr["t"])
        l, r, v = np.array(tr["l"]), np.array(tr["r"]), np.array(tr["v"])
        node = np.zeros(n, dtype=np.int64)
        out = np.zeros(n)
        act = np.arange(n)
        while act.size:
            nd = node[act]
            go_left = X[act, s[nd]] <= t[nd]
            ch = np.where(go_left, l[nd], r[nd])
            leaf = ch < 0
            out[act[leaf]] = v[-ch[leaf] - 1]
            node[act[~leaf]] = ch[~leaf]
            act = act[~leaf]
        total += out
    return total


def check_export(booster, trees, X):
    raw = booster.predict(X[:20000], raw_score=True)
    mine = eval_trees(trees, X[:20000])
    d = float(np.max(np.abs(raw - mine)))
    log(f"export check: max |lightgbm - flat| raw score = {d:.2e}")
    assert d < 1e-6, d
    return d


# ---------------------------------------------------------------- metrics
def clip(p):
    return np.clip(np.asarray(p, dtype=float), EPS, 1 - EPS)


def brier(y, p):
    return float(np.mean((clip(p) - y) ** 2))


def logloss(y, p):
    p = clip(p)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def boot_diff(games, y, p1, p2, B=1000, seed=1):
    """95% CI of brier(p1)-brier(p2), resampling whole games."""
    games = np.asarray(games)
    e1 = (clip(p1) - y) ** 2
    e2 = (clip(p2) - y) ** 2
    uniq, inv = np.unique(games, return_inverse=True)
    s1 = np.bincount(inv, e1)
    s2 = np.bincount(inv, e2)
    c = np.bincount(inv)
    rng = np.random.default_rng(seed)
    diffs = []
    for _ in range(B):
        idx = rng.integers(0, len(uniq), len(uniq))
        diffs.append(s1[idx].sum() / c[idx].sum() - s2[idx].sum() / c[idx].sum())
    return float(np.percentile(diffs, 2.5)), float(np.percentile(diffs, 97.5))


def swings(games, p):
    """Mean |change| in home WP between consecutive rows of the same game, and its 99th pct."""
    games = np.asarray(games)
    p = np.asarray(p, dtype=float)
    same = games[1:] == games[:-1]
    d = np.abs(np.diff(p))[same]
    return float(d.mean()), float(np.percentile(d, 99)), float((d > 0.25).mean())


def calibration(y, p, bins=10):
    p = np.asarray(p, dtype=float)
    idx = np.minimum((p * bins).astype(int), bins - 1)
    rows = []
    for b in range(bins):
        m = idx == b
        if m.sum():
            rows.append((b / bins, (b + 1) / bins, int(m.sum()), float(p[m].mean()), float(y[m].mean())))
    return rows


def plot_calibration(path, title, series, y):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(5.2, 5.2), dpi=120)
    ax.plot([0, 1], [0, 1], color="#999", lw=1, ls="--", label="Perfect")
    styles = [("#1f5fbf", "o"), ("#d9822b", "s"), ("#3a9a5b", "^"), ("#8a4fbf", "D")]
    for (name, p), (col, mk) in zip(series, styles):
        rows = calibration(y, p, bins=20)
        ax.plot([r[3] for r in rows], [r[4] for r in rows], marker=mk, color=col, lw=1.5, ms=4, label=name)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.set_xlabel("Predicted home win probability")
    ax.set_ylabel("Share of those plays where home team won")
    ax.set_title(title, fontsize=10)
    ax.grid(alpha=0.25)
    ax.legend(loc="upper left", fontsize=8)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def fmt(x, d=4):
    return f"{x:.{d}f}"


def compare_block(name_ours, name_other, games, y, p_ours, p_other, periods=None, period_names=None):
    """Markdown rows + dict of metrics comparing two models on identical rows."""
    lo, hi = boot_diff(games, y, p_ours, p_other)
    m = {
        "rows": int(len(y)), "games": int(len(np.unique(games))),
        "brier_ours": brier(y, p_ours), "brier_other": brier(y, p_other),
        "logloss_ours": logloss(y, p_ours), "logloss_other": logloss(y, p_other),
        "brier_diff_ci95": [lo, hi],
    }
    md = [f"| Model | Brier (lower is better) | Log loss (lower is better) |", "|---|---|---|",
          f"| {name_ours} | {bold(m['brier_ours'], m['brier_other'])} | {bold(m['logloss_ours'], m['logloss_other'])} |",
          f"| {name_other} | {bold(m['brier_other'], m['brier_ours'])} | {bold(m['logloss_other'], m['logloss_ours'])} |", "",
          f"{m['rows']:,} plays from {m['games']:,} games. Brier difference (ours minus {name_other}): "
          f"{m['brier_ours'] - m['brier_other']:+.4f}, 95% CI {lo:+.4f} to {hi:+.4f} (bootstrap over games)."]
    if periods is not None:
        md += ["", f"| Period | Plays | Brier ours | Brier {name_other} |", "|---|---|---|---|"]
        m["by_period"] = {}
        for pv, pn in period_names:
            sel = periods == pv if not callable(pv) else pv(periods)
            if sel.sum() == 0:
                continue
            bo, bt = brier(y[sel], p_ours[sel]), brier(y[sel], p_other[sel])
            m["by_period"][pn] = [int(sel.sum()), bo, bt]
            md.append(f"| {pn} | {int(sel.sum()):,} | {fmt(bo)} | {fmt(bt)} |")
    return md, m


def write_json(path, obj, compact=True):
    with open(path, "w", encoding="utf-8") as f:
        if compact:
            json.dump(obj, f, separators=(",", ":"))
        else:
            json.dump(obj, f, indent=1)


def verdict(m):
    better = m["brier_ours"] < m["brier_other"] and m["logloss_ours"] < m["logloss_other"]
    sig = m["brier_diff_ci95"][1] < 0
    if better and sig:
        return "ship ours", "Ours has lower Brier score and log loss than ESPN on the held-out season, and the Brier gap is outside the bootstrap noise."
    if better:
        return "show ESPN's", "Ours scores slightly better but the gap is within bootstrap noise, so it is not measurably better; show ESPN's number, labelled as ESPN's."
    return "show ESPN's", "ESPN's numbers score better than ours on the held-out season; show ESPN's number, labelled as ESPN's."


def js_cases(path, states, expected):
    write_json(path, {"cases": [{"state": s, "expected": float(e)} for s, e in zip(states, expected)]})


RE_TO = re.compile(r"timeout #\d+ by ([A-Z]{2,4})", re.I)


def bold(x, other, d=4):
    """Format x, in bold when it is the better (lower) of the two."""
    return f"**{x:.{d}f}**" if x < other else f"{x:.{d}f}"
