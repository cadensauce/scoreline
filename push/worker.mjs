// Scoreline push worker. Runs on GitHub Actions (see .github/workflows/push.yml).
// Every 20 seconds it checks ESPN scoreboards and sends web-push alerts to phones that
// added Scoreline to their home screen and turned on alerts for their ★ teams.
//
// Secrets (repo Settings → Secrets → Actions): VAPID_PUBLIC, VAPID_PRIVATE, FIREBASE_SA (service account JSON).

import webpush from "web-push";
import admin from "firebase-admin";

const RUN_FOR_MS = (Number(process.env.RUN_MINUTES) || 345) * 60_000;
const TICK_MS = 20_000;
const SUBS_EVERY_MS = 60_000;
const API = "https://site.api.espn.com/apis/site/v2/sports/";
const LEAGUES = {
  nfl: { name: "NFL", path: "football/nfl" },
  cfb: { name: "CFB", path: "football/college-football", extra: "groups=80&limit=300" },
  nba: { name: "NBA", path: "basketball/nba" },
  mlb: { name: "MLB", path: "baseball/mlb" },
};

// Pasted secrets can pick up spaces, line breaks or a "Value:" label, so clean them first.
// A VAPID private key is exactly 43 URL-safe base64 characters; pick that out of whatever was pasted.
const clean = (s) => { const t = String(s || ""); const m = t.match(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/); if (!m) console.log("VAPID_PRIVATE looks wrong: length " + t.trim().length); return m ? m[0] : t.trim(); };
const VAPID_PUBLIC = "BE7gMA0rXlZpDBtTAGdfyabXR8ZeNQwgB8WnaPD6GsfNjWkwN39pVqaEJLIPS7mVERZtbWdSg8xhO_vU8ZRwxM0"; // public, same as in index.html
webpush.setVapidDetails("https://cadensauce.github.io/scoreline/", VAPID_PUBLIC, clean(process.env.VAPID_PRIVATE));
// The service account JSON may have been pasted with extra text around it; take the {...} part.
const saRaw = String(process.env.FIREBASE_SA || "");
const sa = JSON.parse(saRaw.slice(saRaw.indexOf("{"), saRaw.lastIndexOf("}") + 1));
admin.initializeApp({ credential: admin.credential.cert(sa) });
console.log("Push worker ready for project", sa.project_id);
const db = admin.firestore();

let subs = [];          // { id, sub, favs:Set, prefs }
let subsAt = 0;
const seen = new Map(); // event id -> "state|away-home"
const closeSent = new Set();
let firstPass = true;

async function loadSubs() {
  const snap = await db.collection("pushSubs").get();
  subs = snap.docs.map((d) => {
    const x = d.data();
    return { id: d.id, sub: { endpoint: x.endpoint, keys: { p256dh: x.p256dh, auth: x.auth } }, favs: new Set(x.favs || []), prefs: x.prefs || {} };
  }).filter((s) => s.sub.endpoint && s.favs.size);
  subsAt = Date.now();
  console.log(new Date().toISOString(), "subscribers:", subs.length);
}

const teamsOf = (ev) => (ev.competitions?.[0]?.competitors || []).slice().sort((a) => (a.homeAway === "away" ? -1 : 1));
const keyOf = (t) => t.team?.uid || t.team?.id;
const line = (ev) => teamsOf(ev).map((t) => (t.team?.abbreviation || t.team?.shortDisplayName) + " " + (t.score ?? "")).join(" – ");

async function send(ev, kind, title, body) {
  const keys = teamsOf(ev).map(keyOf);
  const targets = subs.filter((s) => keys.some((k) => s.favs.has(k)) && s.prefs[kind] !== false);
  if (!targets.length) return;
  const payload = JSON.stringify({ title, body, tag: "ev-" + ev.id, url: "./" });
  await Promise.all(targets.map(async (s) => {
    try { await webpush.sendNotification(s.sub, payload, { TTL: 600, urgency: "high" }); }
    catch (e) {
      // Phone unsubscribed or uninstalled: clean it up.
      if (e.statusCode === 404 || e.statusCode === 410) { await db.collection("pushSubs").doc(s.id).delete().catch(() => {}); subs = subs.filter((x) => x !== s); }
      else console.log("push failed", e.statusCode || e.message);
    }
  }));
  console.log(new Date().toISOString(), kind, "→", targets.length, "|", title, "|", body);
}

async function tick() {
  if (Date.now() - subsAt > SUBS_EVERY_MS) await loadSubs().catch((e) => console.log("subs error", e.message));
  for (const [lg, L] of Object.entries(LEAGUES)) {
    let data;
    try { data = await (await fetch(API + L.path + "/scoreboard" + (L.extra ? "?" + L.extra : ""))).json(); } catch { continue; }
    for (const ev of data.events || []) {
      const st = ev.status?.type?.state;
      const sc = teamsOf(ev).map((t) => Number(t.score) || 0);
      const sig = st + "|" + sc.join("-");
      const prev = seen.get(ev.id);
      seen.set(ev.id, sig);
      if (firstPass || !prev || prev === sig) continue;
      const pst = prev.split("|")[0], detail = ev.status?.type?.shortDetail || "";
      if (pst === "pre" && st === "in") await send(ev, "start", L.name + ": Game on", ev.name);
      else if (st === "post" && pst !== "post") await send(ev, "final", L.name + ": Final", line(ev));
      else if (st === "in") await send(ev, "score", L.name + ": Score update", line(ev) + " · " + detail);
      // Close game, once: late in the game and within one score.
      const per = ev.status?.period || 0, diff = Math.abs(sc[0] - sc[1]);
      const late = lg === "mlb" ? per >= 8 && diff <= 2 : lg === "nba" ? per >= 4 && diff <= 6 : per >= 4 && diff <= 8;
      if (st === "in" && late && !closeSent.has(ev.id)) { closeSent.add(ev.id); await send(ev, "close", L.name + ": Close game", line(ev) + " · " + detail); }
    }
  }
  firstPass = false;
}

const until = Date.now() + RUN_FOR_MS;
console.log("Push worker running until", new Date(until).toISOString());
while (Date.now() < until) {
  const t0 = Date.now();
  try { await tick(); } catch (e) { console.log("tick error", e.message); }
  await new Promise((r) => setTimeout(r, Math.max(1000, TICK_MS - (Date.now() - t0))));
}
console.log("Push worker finished this shift");
process.exit(0);
