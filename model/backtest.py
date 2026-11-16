"""Backtest report pieces shared by all ball sports."""
import os

import numpy as np

from common import REPORTS, compare_block, fmt, plot_calibration, swings, verdict


def espn_section(sport, label, games, y, p_ours, p_espn, periods, period_names, extra_series=()):
    md, m = compare_block("Scoreline (ours)", "ESPN", games, y, p_ours, p_espn, periods, period_names)
    so, se = swings(games, p_ours), swings(games, p_espn)
    m["swings_ours"], m["swings_espn"] = so, se
    md += ["", "**Swings check** (change in home win probability from one play to the next, same game):", "",
           "| Model | Mean change per play | 99th percentile | Plays with a change over 25 points |", "|---|---|---|---|",
           f"| Scoreline (ours) | {so[0] * 100:.2f} pts | {so[1] * 100:.1f} pts | {so[2] * 100:.2f}% |",
           f"| ESPN | {se[0] * 100:.2f} pts | {se[1] * 100:.1f} pts | {se[2] * 100:.2f}% |"]
    png = f"calibration-{sport}.png"
    plot_calibration(os.path.join(REPORTS, png), f"{label}: held-out calibration (20 bins)",
                     [("Scoreline (ours)", p_ours), ("ESPN", p_espn), *extra_series], y)
    md += ["", f"![{label} calibration](./{png})", "",
           "Calibration table (10 bins): predicted vs actual home win share.", "",
           "| Bin | Ours: predicted / actual | ESPN: predicted / actual |", "|---|---|---|"]
    edges = np.linspace(0, 1, 11)
    for b in range(10):
        lo, hi = edges[b], edges[b + 1]
        sel_o = (p_ours >= lo) & ((p_ours < hi) if b < 9 else (p_ours <= hi))
        sel_e = (p_espn >= lo) & ((p_espn < hi) if b < 9 else (p_espn <= hi))
        po = f"{p_ours[sel_o].mean() * 100:.1f}% / {y[sel_o].mean() * 100:.1f}% (n={sel_o.sum():,})" if sel_o.any() else "-"
        pe = f"{p_espn[sel_e].mean() * 100:.1f}% / {y[sel_e].mean() * 100:.1f}% (n={sel_e.sum():,})" if sel_e.any() else "-"
        md.append(f"| {int(lo * 100)}-{int(hi * 100)}% | {po} | {pe} |")
    v, why = verdict(m)
    m["verdict"] = v
    md += ["", f"Latest season alone, the automatic check says: {v} ({why.split(';')[0].lower()}). The verdict below uses all held-out seasons."]
    return md, m


def rolling_section(folds):
    """folds: list of (season label, games, y, p_ours, p_espn); each fold's model was trained only on
    earlier seasons. Verdict uses all folds pooled (more games -> tighter bootstrap interval)."""
    from common import boot_diff, brier, logloss

    md = ["| Held-out season | Games | Plays | Brier ours | Brier ESPN | Log loss ours | Log loss ESPN |",
          "|---|---|---|---|---|---|---|"]
    per = []
    for lab, g, y, po, pe in folds:
        r = [lab, len(np.unique(g)), len(y), brier(y, po), brier(y, pe), logloss(y, po), logloss(y, pe)]
        per.append(r)
        md.append(f"| {lab} | {r[1]:,} | {r[2]:,} | {r[3]:.4f} | {r[4]:.4f} | {r[5]:.4f} | {r[6]:.4f} |")
    G = np.concatenate([np.char.add(f[0] + ":", f[1].astype(str)) for f in folds])
    Y = np.concatenate([f[2] for f in folds])
    PO = np.concatenate([f[3] for f in folds])
    PE = np.concatenate([f[4] for f in folds])
    lo, hi = boot_diff(G, Y, PO, PE)
    m = {"seasons": [f[0] for f in folds], "per_season": per, "games": int(len(np.unique(G))), "rows": int(len(Y)),
         "brier_ours": brier(Y, PO), "brier_other": brier(Y, PE), "logloss_ours": logloss(Y, PO),
         "logloss_other": logloss(Y, PE), "brier_diff_ci95": [lo, hi]}
    md.append(f"| **All {len(folds)} pooled** | {m['games']:,} | {m['rows']:,} | **{m['brier_ours']:.4f}** | {m['brier_other']:.4f} | "
              f"**{m['logloss_ours']:.4f}** | {m['logloss_other']:.4f} |")
    wins = sum(1 for r in per if r[3] < r[4] and r[5] < r[6])
    v, why = verdict(m)
    m["verdict"], m["season_wins"] = v, wins
    md += ["", f"Pooled Brier difference (ours minus ESPN): {m['brier_ours'] - m['brier_other']:+.4f}, 95% CI {lo:+.4f} to {hi:+.4f} "
               f"(bootstrap over games). Ours is better on both metrics in {wins} of {len(folds)} seasons.", "",
           f"**Automatic verdict: {v}.** {why.replace('on the held-out season', 'across the held-out seasons')}"]
    return md, m
