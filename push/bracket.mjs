// Bracket predictions (NFL): lock brackets when the playoffs start, then pay Marks for correct picks once each round
// is final. Only accounts that agreed to the Terms (13+) get Marks. Each round pays once per person: a ledger entry
// with a fixed id (bracket_nfl_<season>_r<round>), created only if it doesn't exist yet, plus the same amount added
// to the wallet in one batch — exactly like Picks, so the Marks check (ledger sum = balance) keeps working.
const PAY = [10, 20, 40, 80];                       // per correct pick: Wild Card, Divisional, Conference, champion
const WEEKS = [1, 2, 3, 5];                          // ESPN postseason weeks for those rounds
const get = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);

export async function bracketTick(db, admin) {
  const FV = admin.firestore.FieldValue, now = new Date();
  const season = now.getMonth() < 7 ? now.getFullYear() - 1 : now.getFullYear();   // Jan–Jul belong to last year's season
  const rounds = await Promise.all(WEEKS.map((w) => get(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=3&week=${w}&dates=${season}`)));
  // Lock: brackets can't change once the first playoff game kicks off.
  const first = (rounds[0]?.events || []).map((e) => Date.parse(e.date)).filter(Boolean).sort((a, b) => a - b)[0];
  if (first) await db.doc("public/bracketLocks").set({ ["nfl_" + season]: admin.firestore.Timestamp.fromMillis(first) }, { merge: true }).catch(() => {});
  for (let r = 0; r < 4; r++) {
    const evs = (rounds[r]?.events || []).filter((e) => (e.competitions?.[0]?.competitors || []).every((c) => c.team?.id && !/TBD/i.test(c.team?.displayName || "")));
    if (!evs.length || !evs.every((e) => e.status?.type?.completed)) continue;
    const winners = new Set(evs.map((e) => String(e.competitions[0].competitors.find((c) => c.winner)?.team?.id || "")).filter(Boolean));
    const bs = await db.collection("brackets").where("lg", "==", "nfl").where("season", "==", season).get().catch(() => null);
    for (const b of bs?.docs || []) {
      const x = b.data(), uid = x.uid; if (!uid) continue;
      const entry = db.doc(`ledger/${uid}/entries/bracket_nfl_${season}_r${r}`);
      if ((await entry.get()).exists) continue;
      const age = await db.doc("ages/" + uid).get();
      if (!(age.exists && age.data().is13plus === true)) continue;
      const team = (conf, seed) => String(x.seeds?.[conf]?.[seed] || "");
      let n = 0;
      if (r < 3) Object.entries(x.picks || {}).forEach(([k, seed]) => { const [conf, rr] = k.split("|"); if (Number(rr) === r && winners.has(team(conf, seed))) n++; });
      else { const conf = x.picks?.final; if (conf && winners.has(team(conf, x.picks?.[conf + "|2|0"]))) n = 1; }
      const amount = n * PAY[r], batch = db.batch();
      batch.create(entry, { amount, reason: "bracket", refId: `nfl_${season}_r${r}`, createdAt: FV.serverTimestamp() });
      if (amount) batch.set(db.doc("wallets/" + uid), { balance: FV.increment(amount), updatedAt: FV.serverTimestamp() }, { merge: true });
      await batch.commit().catch(() => {});
    }
  }
}
