// Fantasy, run by the push worker. Two modes share the same contests:
// - Free Fantasy: no currency at all.
// - Marks Fantasy: free to enter (never costs Marks); finishing higher earns Marks, only for accounts that agreed to the
//   Terms (13+). Marks are NOT real money.
// Formats: Weekly lineup and Daily lineup (Season leagues come later). Every sport: NFL, CFB, NBA, MLB, F1 (F1 is weekly only).
//
// What the worker writes (the site can only read these; rules check lineups against them):
//   fcontests/{id}  one contest: sport, format, label, lockAt (first game), games, slots, pool {playerId: {n, t, p}},
//                   points {playerId: fantasy points} (live), status open|live|final, settled
//   fboard/{lg}_{fmt}  the list of recent and upcoming contests for that sport and format
// Players' lineups are fentries/{contestId}_{mode}_{uid} (written by the site before lockAt). At the end the worker adds
// score, rank and (Marks mode) the Marks earned, paid with a ledger entry fantasy_<entryId> in the same batch.

const API = "https://site.api.espn.com/apis/site/v2/sports/";
const LGS = { nfl: "football/nfl", cfb: "football/college-football", nba: "basketball/nba", mlb: "baseball/mlb" };
const getJSON = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(r.status + " " + u); return r.json(); };

// Lineup spots per sport: [spot, player group]. Groups: QB RB WR TE (football), G F C (NBA), H P (MLB hitter/pitcher), D (F1 driver).
export const SLOTS = {
  nfl: [["qb", "QB"], ["rb1", "RB"], ["rb2", "RB"], ["wr1", "WR"], ["wr2", "WR"], ["te", "TE"]],
  cfb: [["qb", "QB"], ["rb1", "RB"], ["rb2", "RB"], ["wr1", "WR"], ["wr2", "WR"], ["te", "TE"]],
  nba: [["g1", "G"], ["g2", "G"], ["f1", "F"], ["f2", "F"], ["c", "C"]],
  mlb: [["h1", "H"], ["h2", "H"], ["h3", "H"], ["p", "P"]],
  f1: [["d1", "D"], ["d2", "D"], ["d3", "D"]],
};
// Marks earned in Marks Fantasy by finishing place (top 10% / 25% / 50% / any other full lineup that scored).
const REWARDS = { w: [50, 30, 15, 5], d: [20, 12, 6, 2] };
const F1_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

const etDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d).replace(/-/g, "");
const addDays = (s, n) => { const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8) + n, 12)); return d.toISOString().slice(0, 10).replace(/-/g, ""); };
const mondayOf = (s) => { const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), 12)); return addDays(s, -((d.getUTCDay() + 6) % 7)); };
const nice = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), 12)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

function group(lg, pos) {
  const p = String(pos || "").toUpperCase();
  if (lg === "nfl" || lg === "cfb") return ["QB", "RB", "WR", "TE"].includes(p) ? p : (p === "FB" ? "RB" : null);
  if (lg === "nba") return p.startsWith("G") || p === "PG" || p === "SG" ? "G" : p.startsWith("F") || p === "SF" || p === "PF" ? "F" : p.startsWith("C") ? "C" : null;
  if (lg === "mlb") return /^(P|SP|RP)$/.test(p) ? "P" : p ? "H" : null;
  return null;
}

// ---------- scoring from a game's box score ----------
const num = (v) => { const n = parseFloat(String(v).replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : 0; };
function boxPoints(lg, summary) {
  const out = {};
  for (const team of summary?.boxscore?.players || []) {
    for (const cat of team.statistics || []) {
      const keys = cat.keys || [], k = (re) => keys.findIndex((x) => re.test(x));
      for (const a of cat.athletes || []) {
        const id = a.athlete?.id; if (!id || a.didNotPlay) continue;
        const s = a.stats || [], v = (re) => { const i = k(re); return i < 0 ? 0 : num(s[i]); };
        let pts = 0;
        if (lg === "nfl" || lg === "cfb") {
          if (cat.name === "passing") pts += v(/^passingYards$/) * 0.04 + v(/^passingTouchdowns$/) * 4 - v(/^interceptions$/) * 2;
          else if (cat.name === "rushing") pts += v(/^rushingYards$/) * 0.1 + v(/^rushingTouchdowns$/) * 6;
          else if (cat.name === "receiving") pts += v(/^receptions$/) + v(/^receivingYards$/) * 0.1 + v(/^receivingTouchdowns$/) * 6;
          else if (cat.name === "fumbles") pts -= v(/^fumblesLost$/) * 2;
          else if (cat.name === "kickReturns") pts += v(/^kickReturnTouchdowns$/) * 6;
          else if (cat.name === "puntReturns") pts += v(/^puntReturnTouchdowns$/) * 6;
        } else if (lg === "nba") {
          pts += v(/^points$/) + v(/^rebounds$/) * 1.2 + v(/^assists$/) * 1.5 + v(/^steals$/) * 3 + v(/^blocks$/) * 3 - v(/^turnovers$/);
        } else if (lg === "mlb") {
          if (/bat/i.test(cat.name || cat.type || "") || k(/^atBats$/) >= 0) pts += v(/^hits$/) * 3 + v(/^runs$/) * 2 + v(/^RBIs?$/i) * 2 + v(/^homeRuns$/) * 4 + v(/^walks$/) * 2;
          else if (/pitch/i.test(cat.name || cat.type || "") || k(/innings/i) >= 0) {
            const ip = String(s[k(/innings/i)] || "0").split("."), outs = num(ip[0]) * 3 + num(ip[1] || 0);
            pts += (outs / 3) * 2.25 + v(/^strikeouts$/) * 2 - v(/^earnedRuns$/) * 2;
          }
        }
        if (pts) out[id] = Math.round(((out[id] || 0) + pts) * 10) / 10;
      }
    }
  }
  return out;
}

// ---------- building contests ----------
const rosterAt = new Map();   // lg|teamId -> { at, players }
async function roster(lg, teamId) {
  const key = lg + "|" + teamId, c = rosterAt.get(key);
  if (c && Date.now() - c.at < 12 * 3600e3) return c.players;
  let players = [];
  try {
    const r = await getJSON(API + LGS[lg] + "/teams/" + teamId + "/roster");
    const list = (r.athletes || []).flatMap((x) => (x.items ? x.items : [x]));
    players = list.filter((a) => a.id && a.status?.type !== "inactive").map((a) => ({ id: String(a.id), n: a.displayName || a.fullName || "", p: group(lg, a.position?.abbreviation) })).filter((a) => a.p);
  } catch {}
  rosterAt.set(key, { at: Date.now(), players });
  return players;
}
async function poolFor(lg, events) {
  const pool = {};
  const teams = new Map();
  for (const e of events) for (const c of e.competitions?.[0]?.competitors || []) if (c.team?.id) teams.set(String(c.team.id), c.team.abbreviation || c.team.shortDisplayName || "");
  for (const [id, abbr] of teams) for (const p of await roster(lg, id)) pool[p.id] = { n: p.n, t: abbr, p: p.p };
  return pool;
}
const scoreboard = async (lg, q) => (await getJSON(API + LGS[lg] + "/scoreboard" + (q ? "?" + q : ""))).events || [];
const firstStart = (events) => Math.min(...events.map((e) => Date.parse(e.date)).filter(Number.isFinite));

async function planContests(lg) {
  const out = [], today = etDate(new Date());
  if (lg === "nfl" || lg === "cfb") {
    const now = await getJSON(API + LGS[lg] + "/scoreboard").catch(() => null);
    const wk = now?.week?.number, type = now?.season?.type, yr = now?.season?.year;
    if (!wk) return out;
    for (const w of [wk, wk + 1]) {
      const events = w === wk ? now.events || [] : await scoreboard(lg, "seasontype=" + type + "&week=" + w).catch(() => []);
      if (!events.length) continue;
      out.push({ id: lg + "_w_" + yr + "-" + type + "-" + w, fmt: "w", label: "Week " + w, events });
      const days = {};
      for (const e of events) (days[etDate(new Date(e.date))] ||= []).push(e);
      for (const [d, evs] of Object.entries(days)) if (d >= today) out.push({ id: lg + "_d_" + d, fmt: "d", label: nice(d), events: evs });
    }
  } else if (lg === "nba" || lg === "mlb") {
    for (const d of [today, addDays(today, 1)]) {
      const events = await scoreboard(lg, "dates=" + d).catch(() => []);
      if (events.length) out.push({ id: lg + "_d_" + d, fmt: "d", label: nice(d), events });
    }
    for (const mon of [mondayOf(today), addDays(mondayOf(today), 7)]) {
      const events = (await Promise.all([0, 1, 2, 3, 4, 5, 6].map((i) => scoreboard(lg, "dates=" + addDays(mon, i)).catch(() => [])))).flat();
      if (events.length) out.push({ id: lg + "_w_" + mon, fmt: "w", label: "Week of " + nice(mon), events });
    }
  }
  return out;
}

async function f1Contest() {
  const sb = await getJSON(API + "racing/f1/scoreboard").catch(() => null);
  const ev = sb?.events?.[0]; if (!ev) return null;
  const comps = ev.competitions || [], qual = comps.find((c) => /qual/i.test(c.type?.abbreviation || "")), race = comps.find((c) => /race/i.test(c.type?.abbreviation || ""));
  if (!race) return null;
  const drivers = {};
  for (const c of comps) for (const d of c.competitors || []) if (d.id) drivers[String(d.id)] = { n: d.athlete?.displayName || "", t: d.team?.abbreviation || "", p: "D" };
  if (!Object.keys(drivers).length) {
    const st = await getJSON("https://site.api.espn.com/apis/v2/sports/racing/f1/standings").catch(() => null);
    for (const e of st?.children?.[0]?.standings?.entries || []) if (e.athlete?.id) drivers[String(e.athlete.id)] = { n: e.athlete.displayName || "", t: "", p: "D" };
  }
  return { id: "f1_w_" + ev.id, fmt: "w", label: ev.shortName || ev.name || "Race weekend", lockAt: Date.parse((qual || race).date), pool: drivers, games: [ev.id], race };
}

const lastPlan = new Map();   // lg -> time contests were last (re)built
export async function fantasyTick(db, admin) {
  const FV = admin.firestore.FieldValue, TS = admin.firestore.Timestamp;
  for (const lg of ["nfl", "cfb", "nba", "mlb", "f1"]) {
    // 1) Publish upcoming contests (and refresh their player lists) every 30 minutes until they lock.
    if (Date.now() - (lastPlan.get(lg) || 0) > 30 * 60_000) {
      lastPlan.set(lg, Date.now());
      try {
        const plans = lg === "f1" ? [await f1Contest()].filter(Boolean) : await planContests(lg);
        for (const p of plans) {
          const ref = db.collection("fcontests").doc(p.id), cur = await ref.get();
          const lockAt = p.lockAt || firstStart(p.events);
          if (!Number.isFinite(lockAt)) continue;
          if (cur.exists && (cur.data().lockAt?.toMillis?.() || 0) <= Date.now()) continue;   // locked: player list frozen
          if (lockAt <= Date.now()) continue;                                                  // started before we saw it
          const pool = p.pool || await poolFor(lg, p.events);
          if (!Object.keys(pool).length) continue;
          await ref.set({ lg, fmt: p.fmt, label: p.label, lockAt: TS.fromMillis(lockAt), games: p.games || p.events.map((e) => String(e.id)),
            slots: SLOTS[lg].map(([k, g]) => k + ":" + g), pool, status: "open", settled: false, updatedAt: FV.serverTimestamp() }, { merge: true });
        }
        await board(db, lg);
      } catch (e) { console.log("fantasy plan", lg, e.message); }
    }
  }
  await leaguesTick(db, admin).catch((e) => console.log("leagues", e.message));
  // 2) Live points for locked contests, then results.
  const live = await db.collection("fcontests").where("settled", "==", false).get().catch(() => null);
  const summaries = new Map();
  for (const c of live?.docs || []) {
    const d = c.data();
    if ((d.lockAt?.toMillis?.() || 0) > Date.now()) continue;
    try {
      const points = {}; let allDone = true;
      if (d.lg === "f1") {
        const sb = await getJSON(API + "racing/f1/scoreboard").catch(() => null);
        const ev = (sb?.events || []).find((e) => String(e.id) === d.games[0]);
        const race = ev?.competitions?.find((x) => /race/i.test(x.type?.abbreviation || ""));
        if (!race) { allDone = !ev && Date.now() - d.lockAt.toMillis() > 4 * 864e5; }   // event rolled off the scoreboard: close it
        else {
          for (const r of race.competitors || []) { const pos = Number(r.order); if (pos >= 1 && pos <= 10 && race.status?.type?.state !== "pre") points[String(r.id)] = F1_POINTS[pos - 1]; }
          allDone = race.status?.type?.state === "post";
        }
      } else {
        for (const g of d.games || []) {
          const key = d.lg + "|" + g;
          if (!summaries.has(key)) summaries.set(key, await getJSON(API + LGS[d.lg] + "/summary?event=" + g).catch(() => null));
          const s = summaries.get(key), st = s?.header?.competitions?.[0]?.status?.type;
          if (!st) { allDone = false; continue; }
          if (st.state !== "pre") Object.assign(points, boxPoints(d.lg, s));
          if (!st.completed && !/postponed|canceled|cancelled/i.test(st.name || "")) allDone = false;
        }
      }
      const kept = {}; for (const [id, v] of Object.entries(points)) if (d.pool?.[id]) kept[id] = v;
      await c.ref.update({ points: kept, status: allDone ? "final" : "live", updatedAt: FV.serverTimestamp() });
      if (allDone) await settleContest(db, admin, c.ref, { ...d, points: kept });
    } catch (e) { console.log("fantasy live", c.id, e.message); }
  }
}

async function board(db, lg) {
  for (const fmt of ["w", "d"]) {
    const snap = await db.collection("fcontests").where("lg", "==", lg).get().catch(() => null);
    const list = (snap?.docs || []).map((x) => ({ id: x.id, ...x.data() })).filter((x) => x.fmt === fmt)
      .sort((a, b) => b.lockAt.toMillis() - a.lockAt.toMillis()).slice(0, 8)
      .map((x) => ({ id: x.id, label: x.label, lockAt: x.lockAt, status: x.status || "open" }));
    await db.collection("fboard").doc(lg + "_" + fmt).set({ contests: list });
  }
}

async function settleContest(db, admin, ref, d) {
  const FV = admin.firestore.FieldValue;
  const snap = await db.collection("fentries").where("contestId", "==", ref.id).get();
  const slots = (d.slots || []).map((s) => s.split(":"));
  const score = (lineup) => Math.round(slots.reduce((t, [k, g]) => { const id = lineup?.[k]; return t + (id && d.pool?.[id]?.p === g ? d.points?.[id] || 0 : 0); }, 0) * 10) / 10;
  const full = (lineup) => slots.every(([k]) => lineup?.[k]);
  const byMode = { free: [], marks: [] };
  for (const e of snap.docs) if (byMode[e.data().mode]) byMode[e.data().mode].push({ ref: e.ref, id: e.id, d: e.data(), s: score(e.data().lineup) });
  const agreed = {};
  await Promise.all([...new Set(byMode.marks.map((e) => e.d.uid))].map(async (uid) => {
    const a = await db.collection("ages").doc(uid).get().catch(() => null);
    agreed[uid] = a?.exists && a.data().is13plus === true;   // Marks only for accounts that agreed to the Terms (13+)
  }));
  for (const [mode, list] of Object.entries(byMode)) {
    list.sort((a, b) => b.s - a.s);
    const of = list.length;
    for (let i = 0; i < list.length; i += 150) {
      const batch = db.batch();
      list.slice(i, i + 150).forEach((e, j) => {
        const rank = 1 + list.findIndex((x) => x.s === e.s), pct = rank / of, tier = REWARDS[d.fmt] || REWARDS.d;
        const amount = mode === "marks" && agreed[e.d.uid] && full(e.d.lineup) && e.s > 0 ? (pct <= 0.1 ? tier[0] : pct <= 0.25 ? tier[1] : pct <= 0.5 ? tier[2] : tier[3]) : 0;
        batch.update(e.ref, { score: e.s, rank, of, reward: amount });
        if (amount > 0) {
          batch.create(db.doc("ledger/" + e.d.uid + "/entries/fantasy_" + e.id), { amount, reason: "fantasy", refId: ref.id, createdAt: FV.serverTimestamp() });
          batch.set(db.doc("wallets/" + e.d.uid), { balance: FV.increment(amount), updatedAt: FV.serverTimestamp() }, { merge: true });
        }
      });
      try { await batch.commit(); } catch (err) { console.log("fantasy settle batch failed", ref.id, err.message); return; }
    }
  }
  await ref.update({ settled: true, status: "final", settledAt: FV.serverTimestamp() });
  await board(db, d.lg).catch(() => {});
  console.log("fantasy settled", ref.id, snap.size, "lineups");
}

// ---------- Season leagues (with friends, with a draft) ----------
// The site handles creating, joining and the draft (the rules check every step). The worker:
//   - publishes fpool/{lg}: every player a league can draft (NFL, NBA, MLB: all teams; CFB: the AP Top 25 teams; F1: drivers)
//   - at each week's lock, copies every member's current starters into the league (locked.{contestId})
//   - when that week's contest is final, scores the starters with the same points as the weekly contest, adds them to the
//     season totals, and in Marks leagues gives the week's top score LEAGUE_WIN Marks (agreed accounts only).
export const ROSTER = { nfl: 8, cfb: 8, nba: 7, mlb: 6, f1: 3 };
const LEAGUE_WIN = 20;
const poolAt = new Map();
async function publishPool(db, admin, lg) {
  if (Date.now() - (poolAt.get(lg) || 0) < 12 * 3600e3) return;
  poolAt.set(lg, Date.now());
  const players = {};
  try {
    if (lg === "f1") {
      const st = await getJSON("https://site.api.espn.com/apis/v2/sports/racing/f1/standings");
      for (const e of st?.children?.[0]?.standings?.entries || []) if (e.athlete?.id) players[String(e.athlete.id)] = { n: e.athlete.displayName || "", t: "", p: "D" };
    } else {
      let teams = [];
      if (lg === "cfb") {
        const rk = await getJSON(API + LGS.cfb + "/rankings");
        const ap = (rk.rankings || []).find((r) => /AP/.test(r.name || "")) || rk.rankings?.[0];
        teams = (ap?.ranks || []).map((r) => ({ id: String(r.team?.id), t: r.team?.abbreviation || "" })).filter((x) => x.id);
      } else {
        const j = await getJSON(API + LGS[lg] + "/teams");
        teams = (j.sports?.[0]?.leagues?.[0]?.teams || []).map((x) => ({ id: String(x.team?.id), t: x.team?.abbreviation || "" })).filter((x) => x.id);
      }
      for (const tm of teams) for (const p of await roster(lg, tm.id)) players[p.id] = { n: p.n, t: tm.t, p: p.p };
    }
    if (Object.keys(players).length) await db.collection("fpool").doc(lg).set({ players, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  } catch (e) { console.log("fantasy pool", lg, e.message); poolAt.set(lg, Date.now() - 11 * 3600e3); }   // try again in an hour
}

export async function leaguesTick(db, admin) {
  for (const lg of Object.keys(ROSTER)) await publishPool(db, admin, lg);
  const FV = admin.firestore.FieldValue;
  const snap = await db.collection("leagues").where("status", "==", "active").get().catch(() => null);
  for (const L of snap?.docs || []) {
    const d = L.data(), start = d.startedAt?.toMillis?.() || 0;
    try {
      const cs = await db.collection("fcontests").where("lg", "==", d.lg).get();
      const weeks = cs.docs.map((x) => ({ id: x.id, ...x.data() })).filter((x) => x.fmt === "w" && (x.lockAt?.toMillis?.() || 0) > start && x.lockAt.toMillis() <= Date.now())
        .sort((a, b) => a.lockAt.toMillis() - b.lockAt.toMillis());
      const locked = d.locked || {}, scored = new Set(d.scored || []);
      for (const w of weeks) {
        if (!locked[w.id]) {   // week just locked: freeze everyone's current starters for it
          const lu = {};
          await Promise.all((d.members || []).map(async (uid) => { const s = await db.collection("lstarts").doc(L.id + "_" + uid).get().catch(() => null); lu[uid] = s?.exists ? s.data().lineup || {} : {}; }));
          locked[w.id] = lu;
          await L.ref.update({ ["locked." + w.id]: lu, ["labels." + w.id]: w.label || w.id });
        }
        if (w.settled && !scored.has(w.id)) {   // week is final: score it
          const slots = (w.slots || []).map((s) => s.split(":"));
          const pool = (await db.collection("fpool").doc(d.lg).get()).data()?.players || {};
          const scores = {};
          for (const [uid, lu] of Object.entries(locked[w.id] || {})) {
            scores[uid] = Math.round(slots.reduce((t, [k, g]) => { const id = lu?.[k]; const grp = pool[id]?.p || w.pool?.[id]?.p; return t + (id && d.taken?.[id] === uid && grp === g ? w.points?.[id] || 0 : 0); }, 0) * 10) / 10;
          }
          const batch = db.batch(), top = Math.max(0, ...Object.values(scores));
          const upd = { ["weeks." + w.id]: scores, scored: FV.arrayUnion(w.id) };
          for (const [uid, s] of Object.entries(scores)) upd["totals." + uid] = FV.increment(s);
          batch.update(L.ref, upd);
          if (d.mode === "marks" && top > 0) {
            for (const [uid, s] of Object.entries(scores)) {
              if (s !== top) continue;
              const a = await db.collection("ages").doc(uid).get().catch(() => null);
              if (!(a?.exists && a.data().is13plus === true)) continue;   // Marks only with the Terms agreement
              batch.create(db.doc("ledger/" + uid + "/entries/league_" + L.id + "_" + w.id), { amount: LEAGUE_WIN, reason: "league", refId: L.id, createdAt: FV.serverTimestamp() });
              batch.set(db.doc("wallets/" + uid), { balance: FV.increment(LEAGUE_WIN), updatedAt: FV.serverTimestamp() }, { merge: true });
            }
          }
          await batch.commit();
          scored.add(w.id);
          console.log("league week scored", L.id, w.id);
        }
      }
    } catch (e) { console.log("league", L.id, e.message); }
  }
}
