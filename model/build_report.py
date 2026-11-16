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
    rows = ["| Sport | Held-out plays | Brier ours | Brier ESPN | Log loss ours | Log loss ESPN | Verdict |",
            "|---|---|---|---|---|---|---|"]
    for key, name in SPORTS:
        mp = os.path.join(REPORTS, f"metrics-{key}.json")
        if not os.path.exists(mp):
            rows.append(f"| {name} | not run | | | | | |")
            continue
        m = json.load(open(mp, encoding="utf-8"))
        e = m.get("espn")
        if e:
            v = m.get("verdict_final") or e.get("verdict")
            rows.append(f"| {name} | {e['rows']:,} ({e['games']:,} games) | {e['brier_ours']:.4f} | {e['brier_other']:.4f} | "
                        f"{e['logloss_ours']:.4f} | {e['logloss_other']:.4f} | **{v}** |")
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
