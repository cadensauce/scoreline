// Chat alerts + Mod safety, run by the push worker.
//
// 1. Chat alerts: when a chat's `last` message changes, tell the other members on their phones
//    (chatPush/{uid}/devices/{deviceId} → the same pushSubs entry used for score alerts). Skips people who
//    blocked the sender, turned Messages off, or are in quiet hours.
// 2. Mod safety: a Mod who bans or warns too many people too fast is paused (roles/{uid}.paused = true) until the
//    Owner unpauses them in Dev tools. The Owner is never paused.

const BURST_WINDOW = 10 * 60_000;   // 10 minutes
const BURST_LIMIT = 5;              // more than 5 bans/warnings in 10 minutes by one Mod → pause

export function startChatMod(db, admin, { getSub, deliver, quietNow }) {
  const start = admin.firestore.Timestamp.fromMillis(Date.now());
  const seen = new Map();   // chatId → last message time already handled
  const names = new Map();
  const nameOf = async (uid) => {
    if (!names.has(uid)) names.set(uid, (await db.collection("profiles").doc(uid).get().catch(() => null))?.data()?.username || "someone");
    return names.get(uid);
  };

  db.collection("chats").where("updatedAt", ">", start).onSnapshot((snap) => {
    snap.docChanges().forEach(async (c) => {
      if (c.type === "removed") return;
      const x = c.doc.data(), l = x.last;
      const at = l?.at?.toMillis?.() || 0;
      if (!l?.from || !at || at < start.toMillis() || (seen.get(c.doc.id) || 0) >= at) return;
      seen.set(c.doc.id, at);
      try {
        const who = await nameOf(l.from);
        const title = x.group ? "💬 " + String(x.name || "Group").slice(0, 40) + " · @" + who : "💬 @" + who;
        const body = String(l.text || "New message").slice(0, 120);
        for (const m of x.members || []) {
          if (m === l.from) continue;
          if ((await db.collection("blocks").doc(m).collection("people").doc(l.from).get().catch(() => null))?.exists) continue;
          const devs = await db.collection("chatPush").doc(m).collection("devices").get().catch(() => null);
          for (const d of devs?.docs || []) {
            const s = getSub(d.id);
            if (!s || s.prefs.chat === "off" || quietNow(s.prefs)) continue;
            await deliver(s, title, body, "chat-" + c.doc.id, 3600, "#c=" + c.doc.id);
          }
        }
      } catch (e) { console.log("chat alert failed", e.message); }
    });
  }, (e) => console.log("chat watch error", e.message));

  // Mod safety: count each Mod's bans and warnings in the last 10 minutes.
  const acts = new Map();   // uid → [times]
  const note = async (by, what) => {
    if (!by) return;
    const now = Date.now(), list = (acts.get(by) || []).filter((t) => now - t < BURST_WINDOW);
    list.push(now); acts.set(by, list);
    if (list.length <= BURST_LIMIT) return;
    const ref = db.collection("roles").doc(by), r = (await ref.get().catch(() => null))?.data();
    if (!r || r.role === "owner" || r.paused) return;
    await ref.update({ paused: true, pausedWhy: list.length + " " + what + " in 10 minutes", pausedAt: admin.firestore.FieldValue.serverTimestamp() }).catch(() => {});
    console.log(new Date().toISOString(), "paused a mod for", list.length, what);
  };
  db.collection("bans").where("at", ">", start).onSnapshot((snap) => {
    snap.docChanges().forEach((c) => { if (c.type !== "removed") note(c.doc.data().by, "bans"); });
  }, (e) => console.log("ban watch error", e.message));
  db.collection("warnings").where("at", ">", start).onSnapshot((snap) => {
    snap.docChanges().forEach((c) => { if (c.type === "added") note(c.doc.data().by, "warnings"); });
  }, (e) => console.log("warning watch error", e.message));
}
