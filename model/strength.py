"""Pre-game strength input, mirrored in models/wp.js (strengthLogit)."""
import math

import numpy as np


def strh_from_state(state, elo):
    """Home pre-game strength as a logit. Uses state.pregameHomeWP when given (any source, e.g. ESPN's
    matchup predictor), else Scoreline's own Elo ratings exported with the model."""
    p = state.get("pregameHomeWP")
    if p is not None:
        p = min(0.99, max(0.01, float(p)))
        return math.log(p / (1 - p))
    if not elo:
        return 0.0
    base = elo.get("base", 1500.0)
    bases = elo.get("bases") or {}

    def rating(tid):
        b = bases.get(str(tid), base)
        r = elo["ratings"].get(str(tid))
        if r is None:
            return b
        val, season = r
        if state.get("season") is not None and int(state["season"]) > int(season):
            val = b + (val - b) * (1 - elo["revert"])
        return val

    d = rating(state.get("homeTeamId")) - rating(state.get("awayTeamId"))
    if not state.get("neutral"):
        d += elo["hfa"]
    return d / 400 * math.log(10)


def strh_array(states, elo):
    return np.array([strh_from_state(s, elo) for s in states], dtype=float)
