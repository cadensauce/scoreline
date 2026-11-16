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
    md += ["", f"**Automatic verdict: {v}.** {why}"]
    return md, m
