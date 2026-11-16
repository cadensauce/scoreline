/* Scoreline win-probability models (plain JS, no libraries).
 *
 *   <script src="models/wp.js"></script>
 *   await ScorelineWP.ready("nfl");            // fetches models/wp-nfl.json once (also: "nba", "cfb", "f1")
 *   ScorelineWP.nfl(state)                      // -> home win probability 0..1, or null
 *
 * Every function returns null when the model file is not loaded yet (it starts loading on first call)
 * or when a required input is missing. Models are trained and backtested by .github/workflows/winprob.yml;
 * see reports/winprob/REPORT.md for accuracy versus ESPN and which sports should show ours.
 *
 * ---------------------------------------------------------------------------------------------
 * nfl(state) / cfb(state)  -> home team win probability
 *   homeScore, awayScore   numbers (required)
 *   period                 1-4, 5+ = overtime (required)           ESPN: status.period
 *   clock                  seconds left in the period, or "MM:SS" (required)  ESPN: status.displayClock
 *   possession             "home" | "away" | null                    ESPN: situation.possession (team id) mapped
 *                          to home/away. null = unknown (we average both sides).
 *   down                   1-4; 0/null for a kickoff or extra point  ESPN: situation.down
 *                          (then possession = the KICKING team, as ESPN reports it)
 *   distance               yards to go                               ESPN: situation.distance
 *   yardsToEndzone         yards from the ball to the end zone the possession team is attacking (1-99)
 *                          ESPN summary: latest play .end.yardsToEndzone (or .start of the next play);
 *                          ESPN scoreboard: situation.yardsToEndzone, else derive from possessionText
 *                          "KC 24": 100-24 if KC has the ball, else 24.
 *   homeTimeouts, awayTimeouts  0-3 (NFL only; default 3)            ESPN: situation.homeTimeouts/awayTimeouts
 *   neutral                true at a neutral site                    ESPN: competitions[0].neutralSite
 *   strength (one of):
 *     pregameHomeWP        pre-game home win probability from any source (e.g. ESPN predictor
 *                          homeTeam.gameProjection / 100), or
 *     homeTeamId, awayTeamId  ESPN team ids -> Scoreline's own Elo shipped in the model file
 *     season               (optional) season year; if newer than the Elo ratings, they are regressed to the mean
 *   With neither, both teams are treated as equal (plus home edge).
 *
 * nba(state)  -> home team win probability
 *   homeScore, awayScore, period (5+ = OT), clock (seconds left in period or "MM:SS"), neutral,
 *   possession "home" | "away" | null   (use ScorelineWP.nbaPossession(summary.plays, homeId, awayId))
 *   strength as above (pregameHomeWP, or homeTeamId/awayTeamId [+season]).
 *
 * f1(state)  -> see the F1 section at the bottom (per-driver win probabilities).
 */
(function () {
  "use strict";
  const BASE = (function () {
    try {
      const src = document.currentScript && document.currentScript.src;
      return src ? src.replace(/[^/]*$/, "") : "models/";
    } catch (e) { return "models/"; }
  })();
  const models = {};
  const loading = {};

  function ready(sport) {
    if (models[sport]) return Promise.resolve(models[sport]);
    if (!loading[sport]) {
      loading[sport] = fetch(BASE + "wp-" + sport + ".json")
        .then((r) => { if (!r.ok) throw new Error("wp model " + sport + " " + r.status); return r.json(); })
        .then((m) => (models[sport] = m))
        .catch((e) => { delete loading[sport]; throw e; });
    }
    return loading[sport];
  }
  function model(sport) {
    if (!models[sport]) ready(sport).catch(() => {});
    return models[sport] || null;
  }

  /* ---------- shared ---------- */
  const num = (v) => (v === null || v === undefined || v === "" || typeof v === "boolean" ? NaN : Number(v));
  function parseClock(c) {
    if (c === null || c === undefined) return NaN;
    if (typeof c === "number") return c;
    const s = String(c).trim();
    if (s.indexOf(":") >= 0) {
      const i = s.indexOf(":");
      const m = parseInt(s.slice(0, i), 10), sec = parseFloat(s.slice(i + 1));
      return Number.isFinite(m) && Number.isFinite(sec) ? m * 60 + sec : NaN;
    }
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : NaN;
  }
  const sigmoid = (x) => 1 / (1 + Math.exp(-x));
  const clip = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  function raw(trees, x) {
    let total = 0;
    for (let k = 0; k < trees.length; k++) {
      const t = trees[k];
      if (!t.s.length) { total += t.v[0]; continue; }
      let n = 0;
      for (;;) {
        const c = x[t.s[n]] <= t.t[n] ? t.l[n] : t.r[n];
        if (c < 0) { total += t.v[-c - 1]; break; }
        n = c;
      }
    }
    return total;
  }

  function strengthLogit(s, elo) {
    if (s.pregameHomeWP !== null && s.pregameHomeWP !== undefined && Number.isFinite(Number(s.pregameHomeWP))) {
      const p = clip(Number(s.pregameHomeWP), 0.01, 0.99);
      return Math.log(p / (1 - p));
    }
    if (!elo) return 0;
    const base = elo.base !== undefined ? elo.base : 1500;
    const bases = elo.bases || {};
    const rating = (id) => {
      const key = String(id);
      const b = bases[key] !== undefined ? bases[key] : base;
      const r = elo.ratings[key];
      if (!r) return b;
      let v = r[0];
      if (s.season !== null && s.season !== undefined && parseInt(s.season, 10) > parseInt(r[1], 10)) v = b + (v - b) * (1 - elo.revert);
      return v;
    };
    let d = rating(s.homeTeamId) - rating(s.awayTeamId);
    if (!s.neutral) d += elo.hfa;
    return d / 400 * Math.log(10);
  }

  /* ---------- football (NFL + college) ---------- */
  const KICK = { 1: 1, 2: 1, 3: 1, 4: 1 };
  function footballFrame(s, sport) {
    const hs = num(s.homeScore), as = num(s.awayScore), per = num(s.period), clk = parseClock(s.clock);
    if (![hs, as, per, clk].every(Number.isFinite)) return null;
    let poss = s.possession === "home" ? 1 : s.possession === "away" ? -1 : 0;
    let down = num(s.down); if (!Number.isFinite(down)) down = 0;
    let dist = num(s.distance); if (!Number.isFinite(dist)) dist = 0;
    let ytg = num(s.yardsToEndzone); if (!Number.isFinite(ytg)) ytg = 75;
    let hto = num(s.homeTimeouts); if (!Number.isFinite(hto)) hto = 3;
    let ato = num(s.awayTimeouts); if (!Number.isFinite(ato)) ato = 3;
    if (!KICK[down]) {            // kickoff / extra point: receiving team's ball
      poss = -poss;
      if (sport === "nfl") { ytg = ytg >= 50 ? 100 - ytg : 35; down = 0; dist = 0; }
      else { ytg = 75; down = 1; dist = 10; }
    }
    ytg = clip(ytg, 1, 99); dist = clip(dist, 0, 99);
    return { hs, as, per, clk, poss, down, dist, ytg, hto, ato, neutral: s.neutral ? 1 : 0 };
  }
  function footballX(f, sport, side, strh, names) {
    const reg = f.per <= 4;
    const sec = clip(reg ? (4 - f.per) * 900 + f.clk : (sport === "cfb" ? 0 : f.clk), 0, 3600);
    const half = clip(f.per <= 2 ? (2 - f.per) * 900 + f.clk : (reg ? (4 - f.per) * 900 + f.clk : sec), 0, 1800);
    const diff = side * (f.hs - f.as);
    const strp = side * strh;
    const elapsed = reg ? (3600 - sec) / 3600 : 1;
    const decay = Math.exp(-4 * elapsed);
    const c = {
      diff, sec, half_sec: half, ot: reg ? 0 : 1, down: f.down, dist: f.dist, ytg: f.ytg,
      pos_home: f.neutral > 0.5 ? 0.5 : (side > 0 ? 1 : 0), str: strp, str_time: strp * decay,
      diff_time: diff / decay, period: f.per,
      pos_to: side > 0 ? f.hto : f.ato, def_to: side > 0 ? f.ato : f.hto,
    };
    return names.map((n) => c[n]);
  }
  function football(sport) {
    return function (state) {
      const m = model(sport);
      if (!m || !state) return null;
      const f = footballFrame(state, sport);
      if (!f) return null;
      const strh = strengthLogit(state, m.elo);
      const side = f.poss === 0 ? 1 : f.poss;
      const p = sigmoid(raw(m.trees, footballX(f, sport, side, strh, m.features)));
      let ph = side > 0 ? p : 1 - p;
      if (f.poss === 0) {
        const q = sigmoid(raw(m.trees, footballX(f, sport, -1, strh, m.features)));
        ph = 0.5 * (ph + (1 - q));
      }
      return ph;
    };
  }

  /* ---------- NBA ---------- */
  const TURNOVER_WORDS = ["turnover", "traveling", "offensive foul", "offensive charge", "offensive goaltending",
    "double dribble", "discontinued dribble", "palming", "3-second", "backcourt", "back court", "kicked ball"];
  function possUpdate(prev, typeText, side, scoring, shooting) {
    const t = String(typeText || "").toLowerCase();
    if (side === 0) return (t.indexOf("end period") >= 0 || t.indexOf("end game") >= 0 || t.indexOf("end of") >= 0) ? 0 : prev;
    if (t.indexOf("rebound") >= 0) return side;
    if (t.indexOf("free throw") >= 0) {
      if (t.indexOf("technical") >= 0) return prev;
      const m = /(\d) of (\d)/.exec(t);
      if (m && m[1] === m[2]) return scoring ? -side : 0;
      return side;
    }
    if (scoring) return -side;
    if (TURNOVER_WORDS.some((w) => t.indexOf(w) >= 0)) return -side;
    if (t.indexOf("jump ball") >= 0 || t === "jumpball") return 0;
    if (shooting) return 0;
    return prev;
  }
  /* plays = ESPN summary .plays (oldest first). Returns "home" | "away" | null. */
  function nbaPossession(plays, homeId, awayId) {
    let poss = 0;
    for (const p of plays || []) {
      const tid = String((p.team || {}).id);
      const side = tid === String(homeId) ? 1 : tid === String(awayId) ? -1 : 0;
      poss = possUpdate(poss, (p.type || {}).text, side, !!p.scoringPlay, !!p.shootingPlay);
    }
    return poss > 0 ? "home" : poss < 0 ? "away" : null;
  }
  function nba(state) {
    const m = model("nba");
    if (!m || !state) return null;
    const hs = num(state.homeScore), as = num(state.awayScore), per = num(state.period), clk0 = parseClock(state.clock);
    if (![hs, as, per, clk0].every(Number.isFinite)) return null;
    const clk = clip(clk0, 0, 720);
    const reg = per <= 4;
    const sec = reg ? (4 - per) * 720 + clk : Math.min(clk, 300);
    const diff = hs - as;
    const strh = strengthLogit(state, m.elo);
    const c = {
      diff, sec, ot: reg ? 0 : 1, poss: state.possession === "home" ? 1 : state.possession === "away" ? -1 : 0,
      str: strh, str_time: strh * sec / 2880, diff_scaled: diff / Math.sqrt(sec / 2880 + 0.0025), period: per,
    };
    return sigmoid(raw(m.trees, m.features.map((n) => c[n])));
  }

  /* ---------- F1 ---------- */
  /* f1(state) -> { [driverId]: win probability } over the drivers still running (sums to 1), or null.
   *   lap          laps completed by the leader (0 = before the start)      OpenF1 /laps or ESPN status
   *   totalLaps    scheduled race distance in laps
   *   safetyCar    true while a safety car, virtual safety car or red flag is out (OpenF1 /race_control)
   *   drivers[]    { id, position, gapToLeader (seconds; leader 0; null if lapped / unknown),
   *                  pitStops (stops made so far), gridPosition (0 = pit lane), running (false = retired) }
   *                OpenF1 /position, /intervals (gap_to_leader), /pit (count), starting grid. */
  function f1(state) {
    const m = model("f1");
    if (!m || !state || !Array.isArray(state.drivers)) return null;
    const total = num(state.totalLaps), lap = num(state.lap);
    if (!Number.isFinite(total) || !Number.isFinite(lap) || total <= 0) return null;
    const ds = state.drivers.filter((d) => d && d.running !== false && Number.isFinite(num(d.position)));
    if (!ds.length) return null;
    const r = lap / total, left = Math.max(total - lap, 0), sc = state.safetyCar ? 1 : 0, cap = m.gapCap;
    let leader = ds[0];
    for (const d of ds) if (num(d.position) < num(leader.position)) leader = d;
    const lst = leader.pitStops || 0;
    const sc0 = ds.map((d) => {
      const pos = Math.max(1, num(d.position));
      let g = d.gapToLeader;
      g = (g === null || g === undefined || !Number.isFinite(Number(g))) ? cap : clip(Number(g), 0, cap);
      const grid = (!d.gridPosition || d.gridPosition < 1) ? 20 : Number(d.gridPosition);
      const sv = (d.pitStops || 0) - lst, gpl = g / (left + 1);
      const c = { lpos: Math.log(pos), lpos_r: Math.log(pos) * r, gap_per_lap: gpl, gap_per_lap_sc: gpl * sc,
        lgrid: Math.log(grid), lgrid_left: Math.log(grid) * (1 - r), stops_vs_leader: sv, stops_vs_leader_r: sv * r,
        gap10: g / 10, gap10_sc: g / 10 * sc };
      return m.features.reduce((acc, n, i) => acc + m.weights[i] * c[n], 0);
    });
    const mx = Math.max(...sc0);
    const e = sc0.map((v) => Math.exp(v - mx));
    const z = e.reduce((a, b) => a + b, 0);
    const out = {};
    ds.forEach((d, i) => { out[d.id] = e[i] / z; });
    return out;
  }

  const api = { ready, nfl: football("nfl"), cfb: football("cfb"), nba, f1, nbaPossession, parseClock,
    _set: (sport, json) => { models[sport] = json; } };
  (typeof window !== "undefined" ? window : globalThis).ScorelineWP = api;
})();
