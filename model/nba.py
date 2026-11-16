"""NBA state, possession inference and features. Mirrored exactly in models/wp.js."""
import re

import numpy as np
import pandas as pd

from common import header_teams, parse_clock, sigmoid

FEATURES = ["diff", "sec", "ot", "poss", "str", "str_time", "diff_scaled", "period"]
MONO = [1, 0, 0, 1, 1, 1, 1, 0]
RE_FT = re.compile(r"(\d) of (\d)")
TURNOVER_WORDS = ("turnover", "traveling", "offensive foul", "offensive charge", "offensive goaltending",
                  "double dribble", "discontinued dribble", "palming", "3-second", "backcourt", "back court",
                  "kicked ball")


def poss_update(prev, type_text, side, scoring, shooting):
    """Who has the ball after this play: +1 home, -1 away, 0 unknown. side = +1/-1/0 for the play's team."""
    t = (type_text or "").lower()
    if side == 0:
        return 0 if ("end period" in t or "end game" in t or "end of" in t) else prev
    if "rebound" in t:
        return side
    if "free throw" in t:
        if "technical" in t:
            return prev
        m = RE_FT.search(t)
        if m and m.group(1) == m.group(2):
            return -side if scoring else 0
        return side
    if scoring:
        return -side
    if any(w in t for w in TURNOVER_WORDS):
        return -side
    if "jump ball" in t or t == "jumpball":
        return 0
    if shooting:
        return 0
    return prev


def espn_states(summary):
    comp, home, away = header_teams(summary)
    if not home or not away:
        return None, "no teams"
    try:
        hs_f, as_f = int(home.get("score")), int(away.get("score"))
    except (TypeError, ValueError):
        return None, "no final score"
    if hs_f == as_f:
        return None, "tie"
    hid, aid = str(home["team"]["id"]), str(away["team"]["id"])
    wp = {str(w.get("playId")): w.get("homeWinPercentage") for w in (summary.get("winprobability") or [])}
    plays = summary.get("plays") or []
    if not wp or not plays:
        return None, "no win probability"
    rows, poss, hsc, asc = [], 0, 0, 0
    neutral = bool(comp.get("neutralSite"))
    for i, p in enumerate(plays):
        tid = str((p.get("team") or {}).get("id"))
        side = 1 if tid == hid else -1 if tid == aid else 0
        poss = poss_update(poss, (p.get("type") or {}).get("text"), side, bool(p.get("scoringPlay")),
                           bool(p.get("shootingPlay")))
        try:
            hsc = max(hsc, int(p.get("homeScore") or 0))
            asc = max(asc, int(p.get("awayScore") or 0))
        except (TypeError, ValueError):
            pass
        pid = str(p.get("id"))
        per = (p.get("period") or {}).get("number")
        clk = parse_clock((p.get("clock") or {}).get("displayValue"))
        if pid not in wp or wp[pid] is None or per is None or clk is None:
            continue
        rows.append({"homeScore": hsc, "awayScore": asc, "period": int(per), "clock": float(clk),
                     "possession": "home" if poss > 0 else "away" if poss < 0 else None, "neutral": neutral,
                     "_espn": float(wp[pid])})
    return rows, {"home_id": hid, "away_id": aid, "home_win": 1.0 if hs_f > as_f else 0.0}


def states_to_frame(rows):
    df = pd.DataFrame(rows)
    return pd.DataFrame({
        "hs": pd.to_numeric(df["homeScore"]).astype(float), "as_": pd.to_numeric(df["awayScore"]).astype(float),
        "period": pd.to_numeric(df["period"]).astype(float), "clock": pd.to_numeric(df["clock"]).astype(float),
        "poss": df["possession"].map({"home": 1.0, "away": -1.0}).fillna(0.0),
    })


def features(df):
    per = df["period"].to_numpy(float)
    clk = np.clip(df["clock"].to_numpy(float), 0, 720)
    reg = per <= 4
    sec = np.where(reg, (4 - per) * 720 + clk, np.minimum(clk, 300))
    diff = df["hs"].to_numpy(float) - df["as_"].to_numpy(float)
    strh = df["strh"].to_numpy(float)
    cols = {"diff": diff, "sec": sec, "ot": (~reg).astype(float), "poss": df["poss"].to_numpy(float),
            "str": strh, "str_time": strh * sec / 2880, "diff_scaled": diff / np.sqrt(sec / 2880 + 0.0025),
            "period": per}
    return np.column_stack([cols[n] for n in FEATURES]).astype(np.float64)


def predict_home(ev, df):
    return sigmoid(ev(features(df)))
