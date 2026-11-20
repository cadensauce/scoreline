// Picks and Marks (Phase 5), run by the push worker.
// - Keeps games/{lg_eventId} up to date for the next week: kickoff time (= when picks lock, checked by the
//   Firestore rules with the server's clock), and the Upset bonus for each side, frozen at kickoff.
// - After the final, marks each pick won/lost and pays Marks. Each payment is a ledger entry with a fixed id
//   (pick_<pickId>) created in the same batch as the balance change, so paying twice is impossible.
// Marks are earned only: never bought, cashed out or traded. A pick costs nothing.

const API = "https://site.api.espn.com/apis/site/v2/sports/";
const LGS = { nfl: "football/nfl", cfb: "football/college-football", nba: "basketball/nba", mlb: "baseball/mlb" };
const PROJ_EVERY_MS = 60 * 60_000;     // refresh each game's pre-game win chance hourly
const SUMMARIES_PER_TICK = 15;         // spread the summary requests out
const SWEEP_EVERY_MS = 10 * 60_000;    // catch any finished game that wasn't settled (worker restarts, schedule roll-over)

const written = new Map();   // docId -> signature last written
const frozen = new Map();    // docId -> rewards frozen at kickoff
const proj = new Map();      // docId -> { at, p } (home team's pre-game win chance, 0-1, or null)
let sweepAt = 0;
const dayAt = new Map();     // lg+day -> last fetched
const DAY_EVERY_MS = 15 * 60_000;

const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
const getJSON = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(r.status + " " + u); return r.json(); };

// Upset bonus: favourite 10, toss-up 15, underdog 25. Without a pre-game win chance: 10 each.
export function tiers(pHome) {
  if (pHome == null || !Number.isFinite(pHome)) return { home: 10, away: 10 };
  if (pHome >= 0.6) return { home: 10, away: 25 };
  if (pHome <= 0.4) return { home: 25, away: 10 };
  return { home: 15, away: 15 };
}

async function homeChance(lg, id) {
  try {
    const s = await getJSON(API + LGS[lg] + "/summary?event=" + id);
    const v = Number(s.predictor?.homeTeam?.gameProjection);
    return Number.isFinite(v) && v > 0 && v < 100 ? v / 100 : null;
  } catch { return null; }
}

function side(c, ha) { return (c.competitors || []).find((x) => x.homeAway === ha) || {}; }

export async function picksTick(db, admin) {
  const now = Date.now(), FV = admin.firestore.FieldValue, TS = admin.firestore.Timestamp;
  let budget = SUMMARIES_PER_TICK;
  for (const [lg, path] of Object.entries(LGS)) {
    // One day at a time (football has no date ranges): yesterday and today every tick, the rest of the week every 15 min.
    const events = [];
    for (let k = -1; k <= 6; k++) {
      const day = ymd(new Date(now + k * 864e5)), key = lg + day;
      if (k > 0 && now - (dayAt.get(key) || 0) < DAY_EVERY_MS) continue;
      try { const d = await getJSON(API + path + "/scoreboard?limit=300&dates=" + day + (lg === "cfb" ? "&groups=80" : "")); dayAt.set(key, now); events.push(...(d.events || [])); } catch {}
    }
    for (const ev of events) {
      const c = ev.competitions?.[0]; if (!c) continue;
      const st = c.status?.type || {}, state = st.state, docId = lg + "_" + ev.id;
      const when = Date.parse(c.date || ev.date);
      if (!Number.isFinite(when) || when < now - 4 * 864e5 || when > now + 7 * 864e5) continue;   // ignore odd dates and far-off games
      const home = side(c, "home"), away = side(c, "away");
      if (!home.team || !away.team) continue;

      // Upset bonus: follows the pre-game win chance until kickoff, then frozen.
      let rewards = frozen.get(docId);
      if (!rewards) {
        if (state === "pre") {
          const pr = proj.get(docId);
          if ((!pr || now - pr.at > PROJ_EVERY_MS) && budget > 0) { budget--; proj.set(docId, { at: now, p: await homeChance(lg, ev.id) }); }
          rewards = tiers(proj.get(docId)?.p);
        } else {
          const cur = await db.collection("games").doc(docId).get().catch(() => null);   // keep what it was at kickoff
          rewards = cur?.exists && cur.data().rewards ? cur.data().rewards : tiers(proj.get(docId)?.p);
          frozen.set(docId, rewards);
        }
      }

      const hs = Number(home.score), as = Number(away.score);
      const winner = st.completed ? (hs > as ? "home" : as > hs ? "away" : "tie") : null;
      const sig = [state, rewards.home, rewards.away, winner, when].join("|");
      if (written.get(docId) !== sig) {
        await db.collection("games").doc(docId).set({
          lg, eventId: String(ev.id), lockAt: TS.fromMillis(when), state,
          home: { id: String(home.team.id), abbr: home.team.abbreviation || "" }, away: { id: String(away.team.id), abbr: away.team.abbreviation || "" },
          rewards, winner, ...(winner ? {} : { settled: false }), updatedAt: FV.serverTimestamp(),
        }, { merge: true }).then(() => written.set(docId, sig)).catch((e) => console.log("game write failed", docId, e.message));
      }
      if (winner) await settle(db, admin, docId, winner, rewards);
    }
  }
  if (now - sweepAt > SWEEP_EVERY_MS) { sweepAt = now; await sweep(db, admin); }
}

const settled = new Set();
export async function settle(db, admin, docId, winner, rewards) {
  if (settled.has(docId)) return;
  const FV = admin.firestore.FieldValue;
  const g = await db.collection("games").doc(docId).get().catch(() => null);
  if (g?.exists && g.data().settled) { settled.add(docId); return; }
  const picks = await db.collection("picks").where("gameId", "==", docId).get();
  const open = picks.docs.filter((p) => !p.data().result);
  // Marks only for people who agreed to the Terms (13+). Everyone else's picks are just for fun.
  const agreed = {};
  await Promise.all([...new Set(open.map((p) => p.data().uid))].map(async (uid) => {
    const a = await db.collection("ages").doc(uid).get().catch(() => null);
    agreed[uid] = a?.exists && a.data().is13plus === true;
  }));
  for (let i = 0; i < open.length; i += 150) {
    const batch = db.batch();
    for (const p of open.slice(i, i + 150)) {
      const d = p.data(), won = d.side === winner, amount = won && agreed[d.uid] ? Number(rewards[d.side]) || 0 : 0;
      batch.update(p.ref, { result: won ? "won" : winner === "tie" ? "tie" : "lost", reward: amount });
      if (won && amount > 0) {
        batch.create(db.doc("ledger/" + d.uid + "/entries/pick_" + p.id), { amount, reason: "pick", refId: docId, createdAt: FV.serverTimestamp() });
        batch.set(db.doc("wallets/" + d.uid), { balance: FV.increment(amount), updatedAt: FV.serverTimestamp() }, { merge: true });
      }
    }
    try { await batch.commit(); } catch (e) { console.log("settle batch failed", docId, e.message); return; }
  }
  await db.collection("games").doc(docId).set({ settled: true, settledAt: FV.serverTimestamp() }, { merge: true });
  settled.add(docId);
  if (open.length) console.log("settled", docId, open.length, "picks");
}

// Finished games that weren't settled (for example the scoreboard moved on to next week first).
async function sweep(db, admin) {
  let snap;
  try { snap = await db.collection("games").where("settled", "==", false).limit(50).get(); } catch { return; }
  for (const g of snap.docs) {
    const d = g.data();
    if (d.lockAt?.toMillis?.() > Date.now() - 2 * 3600e3) continue;
    try {
      const s = await getJSON(API + LGS[d.lg] + "/summary?event=" + d.eventId);
      const c = s.header?.competitions?.[0]; if (!c?.status?.type?.completed) continue;
      const home = side(c, "home"), away = side(c, "away"), hs = Number(home.score), as = Number(away.score);
      const winner = hs > as ? "home" : as > hs ? "away" : "tie";
      await db.collection("games").doc(g.id).set({ state: "post", winner }, { merge: true });
      await settle(db, admin, g.id, winner, d.rewards || tiers(null));
    } catch {}
  }
}

// Deleted accounts: the site can't remove picks, Marks, the ledger, shop items or the Terms answer (the rules don't let it),
// so the worker removes them for any account that no longer exists. Runs at the start of each shift, then every 6 hours.
// Safety: if the account list can't be read (or comes back empty), nothing is deleted.
export async function cleanupDeleted(db, admin) {
  const alive = new Set();
  try {
    let page;
    do { const r = await admin.auth().listUsers(1000, page); r.users.forEach((u) => alive.add(u.uid)); page = r.pageToken; } while (page);
  } catch (e) { console.log("cleanup: couldn't list accounts", e.message); return; }
  if (!alive.size) return;
  let n = 0;
  const gone = (uid) => uid && !alive.has(uid);
  for (const col of ["ages", "wallets"]) {
    const snap = await db.collection(col).select().get().catch(() => null);
    for (const d of snap?.docs || []) if (gone(d.id)) { await d.ref.delete().catch(() => {}); n++; }
  }
  const picks = await db.collection("picks").select("uid").get().catch(() => null);
  for (const d of picks?.docs || []) if (gone(d.get("uid"))) { await d.ref.delete().catch(() => {}); n++; }
  const lineups = await db.collection("fentries").select("uid").get().catch(() => null);   // fantasy lineups
  for (const d of lineups?.docs || []) if (gone(d.get("uid"))) { await d.ref.delete().catch(() => {}); n++; }
  for (const top of ["ledger", "inventory"]) {
    const refs = await db.collection(top).listDocuments().catch(() => []);
    for (const ref of refs) if (gone(ref.id)) { await db.recursiveDelete(ref).catch(() => {}); n++; }
  }
  if (n) console.log("cleanup: removed", n, "items from deleted accounts");
}

// Shop: titles and banners you unlock with Marks. In-app only, no real-world value. The worker publishes the list
// (shopItems/{id}); the rules read prices from it when you buy. Ids must stay the same once published.
export const SHOP = [
  ["t_rookie", "title", "Rookie", 25], ["t_sharp", "title", "Sharp", 75], ["t_upset", "title", "Upset Hunter", 150],
  ["t_clutch", "title", "Clutch", 250], ["t_filmroom", "title", "Film Room", 350], ["t_hof", "title", "Hall of Famer", 600], ["t_goat", "title", "GOAT", 1000],
  ["b_midnight", "banner", "Midnight", 50], ["b_gridiron", "banner", "Gridiron", 150], ["b_hardwood", "banner", "Hardwood", 150],
  ["b_diamond", "banner", "Diamond", 150], ["b_pitlane", "banner", "Pit Lane", 200], ["b_aurora", "banner", "Aurora", 300], ["b_gold", "banner", "Gold", 500],
];
export async function seedShop(db) {
  const batch = db.batch();
  SHOP.forEach(([id, kind, name, price], order) => batch.set(db.collection("shopItems").doc(id), { kind, name, price, order }));
  await batch.commit().catch((e) => console.log("shop seed failed", e.message));
}
