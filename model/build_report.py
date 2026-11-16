"""Assemble reports/winprob/REPORT.md from the per-sport results (auto) and notes (hand-written)."""
import json
import os

from common import REPORTS

SPORTS = [("nfl", "NFL"), ("nba", "NBA"), ("cfb", "College football"), ("f1", "F1")]


def read(name):
    p = os.path.join(REPORTS, name)
    return open(p, encoding="utf-8").read().strip() if os.path.exists(p) else None


def main():
    out = [read("intro.md") or "# Scoreline win probability: models and backtest", ""]
    rows = ["| Sport | Latest held-out season | Brier ours / ESPN | Log loss ours / ESPN | 3 seasons pooled: Brier ours / ESPN (95% CI of gap) | Same, ours with ESPN's pre-game strength | Verdict |",
            "|---|---|---|---|---|---|---|"]
    for key, name in SPORTS:
        mp = os.path.join(REPORTS, f"metrics-{key}.json")
        if not os.path.exists(mp):
            rows.append(f"| {name} | not run | | | | | |")
            continue
        m = json.load(open(mp, encoding="utf-8"))
        e, r = m.get("espn"), m.get("rolling")
        if e:
            v = m.get("verdict_final") or e.get("verdict")
            rb = m.get("rolling_espn_pregame")
            if rb and rb.get("verdict") == "ship ours" and v != "ship ours":
                v = "ship ours, fed ESPN's pre-game strength"
            pooled_b = (f"{rb['brier_ours']:.4f} / {rb['brier_other']:.4f} ({rb['brier_diff_ci95'][0]:+.4f} to {rb['brier_diff_ci95'][1]:+.4f})" if rb else "")
            pooled = (f"{r['brier_ours']:.4f} / {r['brier_other']:.4f} ({r['brier_diff_ci95'][0]:+.4f} to {r['brier_diff_ci95'][1]:+.4f})"
                      if r else "")
            rows.append(f"| {name} | {e['rows']:,} plays, {e['games']:,} games | {e['brier_ours']:.4f} / {e['brier_other']:.4f} | "
                        f"{e['logloss_ours']:.4f} / {e['logloss_other']:.4f} | {pooled} | {pooled_b} | **{v}** |")
        else:
            rows.append(f"| {name} | {m.get('summary_row', 'see section')} | | | | | **{m.get('verdict_final', m.get('verdict', '-'))}** |")
    out += ["## Summary", "", *rows, ""]
    for key, _ in SPORTS:
        res, notes = read(f"results-{key}.md"), read(f"notes-{key}.md")
        if res:
            out += [res, ""]
        if notes:
            out += [notes, ""]
    tail = read("outro.md")
    if tail:
        out += [tail, ""]
    with open(os.path.join(REPORTS, "REPORT.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(out))
    print("wrote REPORT.md")


if __name__ == "__main__":
    main()
