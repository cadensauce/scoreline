// Profile stats: counted here (never by the app) so nobody can change their own. Written to pstats/{uid}, which only
// the worker can write and only you and your friends can read (when your profile is shown to friends).
//   picks:   w / l (ties don't count), streak = current run of won picks, best = longest run
//   fantasy: n = contests entered that have finished, top3 = finished 1st-3rd
//   leagues: season leagues you're in;  friends: accepted friends;  marksEarned: Marks you've won (not spent)
// Only documents that changed are rewritten, to keep database writes low.

const stable = (o) => (o && typeof o === "object" ? "{" + Object.keys(o).sort().map((k) => k + ":" + stable(o[k])).join(",") + "}" : JSON.stringify(o));

export async function profileStats(db, admin) {
  const uids = new Set((await db.collection("profiles").select().get()).docs.map((d) => d.id));
  if (!uids.size) return;
  const S = {};
  const of = (u) => (S[u] ||= { picks: { w: 0, l: 0, streak: 0, best: 0 }, fantasy: { n: 0, top3: 0 }, leagues: 0, friends: 0, marksEarned: 0 });

  // Picks, oldest game first, for the streaks.
  const games = {};
  (await db.collection("games").select("lockAt").get()).docs.forEach((g) => { games[g.id] = g.get("lockAt")?.toMillis?.() || 0; });
  const picks = (await db.collection("picks").select("uid", "gameId", "result").get()).docs
    .map((d) => d.data()).filter((p) => uids.has(p.uid) && (p.result === "won" || p.result === "lost"))
    .sort((a, b) => (games[a.gameId] || 0) - (games[b.gameId] || 0));
  const run = {};
  for (const p of picks) {
    const s = of(p.uid).picks;
    if (p.result === "won") { s.w++; run[p.uid] = (run[p.uid] || 0) + 1; s.best = Math.max(s.best, run[p.uid]); } else { s.l++; run[p.uid] = 0; }
    s.streak = run[p.uid];
  }

  (await db.collection("fentries").select("uid", "rank").get()).docs.forEach((d) => {
    const u = d.get("uid"), r = d.get("rank");
    if (!uids.has(u) || !r) return;
    of(u).fantasy.n++; if (r <= 3) of(u).fantasy.top3++;
  });
  (await db.collection("leagues").select("members").get()).docs.forEach((d) => (d.get("members") || []).forEach((u) => { if (uids.has(u)) of(u).leagues++; }));
  (await db.collection("requests").where("status", "==", "accepted").select("from", "to").get()).docs.forEach((d) => {
    for (const u of [d.get("from"), d.get("to")]) if (uids.has(u)) of(u).friends++;
  });
  (await db.collectionGroup("entries").select("amount").get()).docs.forEach((d) => {
    const u = d.ref.parent.parent?.id, a = Number(d.get("amount")) || 0;
    if (d.ref.parent.parent?.parent?.id === "ledger" && uids.has(u) && a > 0) of(u).marksEarned += a;
  });

  const old = {};
  (await db.collection("pstats").get()).docs.forEach((d) => { const { at, ...rest } = d.data(); old[d.id] = stable(rest); });
  let batch = db.batch(), n = 0, changed = 0;
  for (const u of uids) {
    const s = of(u);
    if (old[u] === stable(s)) continue;
    batch.set(db.collection("pstats").doc(u), { ...s, at: Date.now() });
    changed++;
    if (++n === 400) { await batch.commit(); batch = db.batch(); n = 0; }
  }
  if (n) await batch.commit();
  console.log("profile stats:", uids.size, "profiles,", changed, "updated");
}
