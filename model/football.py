"""Football (NFL + college) state building and features. Mirrored exactly in models/wp.js."""
import numpy as np
import pandas as pd

from common import RE_TO, header_teams, parse_clock

# ESPN play types that are not snaps; their start/score fields are unreliable.
NON_PLAYS = {"timeout", "official timeout", "end period", "end of half", "end of game", "two-minute warning",
             "end of regulation", "coin toss", "end of quarter"}

NFL_FEATURES = ["diff", "sec", "half_sec", "ot", "down", "dist", "ytg", "pos_home", "pos_to", "def_to",
                "str", "str_time", "diff_time"]
NFL_MONO = [1, 0, 0, 0, 0, 0, -1, 1, 1, -1, 1, 1, 1]
CFB_FEATURES = ["diff", "sec", "half_sec", "ot", "down", "dist", "ytg", "pos_home", "str", "str_time",
                "diff_time", "period"]
CFB_MONO = [1, 0, 0, 0, 0, 0, -1, 1, 1, 1, 1, 0]


def flatten_plays(summary):
    out = []
    dr = summary.get("drives") or {}
    for d in (dr.get("previous") or []):
        out += d.get("plays") or []
    cur = dr.get("current")
    if cur and cur.get("plays"):
        ids = {p.get("id") for p in out}
        out += [p for p in cur["plays"] if p.get("id") not in ids]
    return out


def is_snap(p):
    t = ((p.get("type") or {}).get("text") or "").strip().lower()
    st = p.get("start") or {}
    if t in NON_PLAYS:
        return False
    if st.get("down") is None or st.get("down", 0) < 0:
        return False
    if (st.get("team") or {}).get("id") is None:
        return False
    return True


def espn_states(summary, require_wp=True):
    """Rows (one per ESPN win-probability entry) describing the state right after each play, in the
    same shape the app passes to ScorelineWP.nfl/cfb. Returns (rows, meta) or (None, reason)."""
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
    abbr = {home["team"].get("abbreviation"): "home", away["team"].get("abbreviation"): "away"}
    wp = {str(w.get("playId")): w.get("homeWinPercentage") for w in (summary.get("winprobability") or [])}
    plays = flatten_plays(summary)
    if not plays or (require_wp and not wp):
        return None, "no win probability"
    nxt = [None] * len(plays)
    j = None
    for i in range(len(plays) - 1, -1, -1):
        nxt[i] = j
        if is_snap(plays[i]):
            j = i
    neutral = bool(comp.get("neutralSite"))
    rows = []
    hsc = asc = 0
    used = {}  # (half, side) -> timeouts used

    def half_of(per):
        return 1 if per <= 2 else 2 if per <= 4 else per  # each OT period counts separately

    for i, p in enumerate(plays):
        try:
            hsc = max(hsc, int(p.get("homeScore") or 0))
            asc = max(asc, int(p.get("awayScore") or 0))
        except (TypeError, ValueError):
            pass
        per_i = (p.get("period") or {}).get("number") or 1
        t = ((p.get("type") or {}).get("text") or "").strip().lower()
        if t == "timeout":
            m = RE_TO.search(p.get("text") or "")
            if m and m.group(1).upper() in abbr:
                k = (half_of(per_i), abbr[m.group(1).upper()])
                used[k] = used.get(k, 0) + 1
        pid = str(p.get("id"))
        if nxt[i] is None or (require_wp and wp.get(pid) is None):
            continue
        q = plays[nxt[i]]
        st = q.get("start") or {}
        per = (q.get("period") or {}).get("number")
        clk = parse_clock((q.get("clock") or {}).get("displayValue"))
        if per is None or clk is None:
            continue
        tid = str((st.get("team") or {}).get("id"))
        poss = "home" if tid == hid else "away" if tid == aid else None
        hlf = half_of(per)
        cap = 3 if per <= 4 else 2
        rows.append({
            "homeScore": hsc, "awayScore": asc, "period": int(per), "clock": float(clk),
            "possession": poss, "down": st.get("down"), "distance": st.get("distance"),
            "yardsToEndzone": st.get("yardsToEndzone"),
            "homeTimeouts": max(0, cap - used.get((hlf, "home"), 0)),
            "awayTimeouts": max(0, cap - used.get((hlf, "away"), 0)),
            "neutral": neutral, "_espn": None if wp.get(pid) is None else float(wp[pid]), "_seq": i,
        })
    meta = {"home_id": hid, "away_id": aid, "home_win": 1.0 if hs_f > as_f else 0.0,
            "home_abbr": home["team"].get("abbreviation"), "away_abbr": away["team"].get("abbreviation")}
    return rows, meta


def states_to_frame(rows):
    """App-shaped states -> numeric frame in ESPN semantics (possession +1 home / -1 away / 0 unknown)."""
    df = pd.DataFrame(rows)
    out = pd.DataFrame({
        "hs": pd.to_numeric(df["homeScore"]).astype(float),
        "as_": pd.to_numeric(df["awayScore"]).astype(float),
        "period": pd.to_numeric(df["period"]).astype(float),
        "clock": pd.to_numeric(df["clock"]).astype(float),
        "poss": df["possession"].map({"home": 1.0, "away": -1.0}).fillna(0.0),
        "down": pd.to_numeric(df["down"], errors="coerce").fillna(0.0),
        "dist": pd.to_numeric(df["distance"], errors="coerce").fillna(0.0),
        "ytg": pd.to_numeric(df["yardsToEndzone"], errors="coerce").fillna(75.0),
    })
    n = len(df)
    for col, src in (("hto", "homeTimeouts"), ("ato", "awayTimeouts")):
        out[col] = pd.to_numeric(df[src], errors="coerce").fillna(3.0).to_numpy() if src in df else np.full(n, 3.0)
    out["neutral"] = df["neutral"].fillna(False).astype(bool).astype(float).to_numpy() if "neutral" in df else 0.0
    return out


def canonical(df, sport):
    """ESPN semantics -> training semantics. A state with no valid down (kickoff, extra point) has
    ESPN possession = the kicking team; training data treats it as the receiving team's ball."""
    df = df.copy()
    kick = ~df["down"].isin([1.0, 2.0, 3.0, 4.0])
    df.loc[kick, "poss"] = -df.loc[kick, "poss"]
    if sport == "nfl":
        df.loc[kick, "ytg"] = np.where(df.loc[kick, "ytg"] >= 50, 100 - df.loc[kick, "ytg"], 35.0)
        df.loc[kick, "down"] = 0.0
        df.loc[kick, "dist"] = 0.0
    else:
        df.loc[kick, "ytg"] = 75.0
        df.loc[kick, "down"] = 1.0
        df.loc[kick, "dist"] = 10.0
    df["ytg"] = df["ytg"].clip(1, 99)
    df["dist"] = df["dist"].clip(0, 99)
    return df


def features(df, sport, side):
    """side = +1 (possession team is home) or -1. df canonical; 'strh' = home pregame logit."""
    s = np.asarray(side, dtype=float)
    per = df["period"].to_numpy(float)
    clk = df["clock"].to_numpy(float)
    reg = per <= 4
    qlen = 900.0
    sec = np.where(reg, (4 - per) * qlen + clk, 0.0 if sport == "cfb" else clk)
    sec = np.clip(sec, 0, 3600)
    half = np.where(per <= 2, (2 - per) * qlen + clk, np.where(reg, (4 - per) * qlen + clk, sec))
    half = np.clip(half, 0, 1800)
    ot = (~reg).astype(float)
    diff = s * (df["hs"].to_numpy(float) - df["as_"].to_numpy(float))
    neutral = df["neutral"].to_numpy(float) if "neutral" in df else 0.0
    pos_home = np.where(neutral > 0.5, 0.5, (s > 0).astype(float))
    strp = s * df["strh"].to_numpy(float)
    elapsed = np.where(reg, (3600 - sec) / 3600, 1.0)
    decay = np.exp(-4 * elapsed)
    cols = {
        "diff": diff, "sec": sec, "half_sec": half, "ot": ot,
        "down": df["down"].to_numpy(float), "dist": df["dist"].to_numpy(float), "ytg": df["ytg"].to_numpy(float),
        "pos_home": pos_home, "str": strp, "str_time": strp * decay, "diff_time": diff / decay,
        "period": per,
    }
    if sport == "nfl":
        hto, ato = df["hto"].to_numpy(float), df["ato"].to_numpy(float)
        cols["pos_to"] = np.where(s > 0, hto, ato)
        cols["def_to"] = np.where(s > 0, ato, hto)
    names = NFL_FEATURES if sport == "nfl" else CFB_FEATURES
    return np.column_stack([np.broadcast_to(cols[n], (len(df),)) for n in names]).astype(np.float64)


def predict_home(trees_eval, df, sport):
    """Home win probability for canonical states; unknown possession averages both sides."""
    from common import sigmoid

    poss = df["poss"].to_numpy(float)
    side = np.where(poss == 0, 1.0, poss)
    p = sigmoid(trees_eval(features(df, sport, side)))
    ph = np.where(side > 0, p, 1 - p)
    unk = poss == 0
    if unk.any():
        sub = df[unk]
        q = sigmoid(trees_eval(features(sub, sport, -np.ones(len(sub)))))
        ph[unk] = 0.5 * (ph[unk] + (1 - q))
    return ph
