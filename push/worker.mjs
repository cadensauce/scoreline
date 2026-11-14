// Scoreline push worker. Runs on GitHub Actions (see .github/workflows/push.yml).
// Sends a small number of clear alerts, only about the teams each person follows:
//   games: starting, your team scores (basketball: end of quarter), close finish, final
//   news:  trades, major injuries, big moves (coach changes, suspensions, retirements, big contracts)
//
// Secret (repo Settings → Secrets → Actions): FIREBASE_SA (service account JSON). Push keys live in Firestore.

import webpush from "web-push";
import admin from "firebase-admin";

const RUN_FOR_MS = (Number(process.env.RUN_MINUTES) || 345) * 60_000;
const TICK_MS = 20_000;            // games
const NEWS_EVERY_MS = 5 * 60_000;  // team news
const SUBS_EVERY_MS = 60_000;
const NEWS_PER_TEAM_PER_DAY = 2;
const API = "https://site.api.espn.com/apis/site/v2/sports/";
const LEAGUES = {
  nfl: { name: "NFL", icon: "🏈", path: "football/nfl", league: 28 },
  cfb: { name: "CFB", icon: "🏈", path: "football/college-football", extra: "groups=80&limit=300", league: 23 },
  nba: { name: "NBA", icon: "🏀", path: "basketball/nba", league: 46 },
  mlb: { name: "MLB", icon: "⚾", path: "baseball/mlb", league: 10 },
};

// ---- setup -------------------------------------------------------------------------------
// Only one secret is needed: FIREBASE_SA (the Firebase service account JSON).
const saRaw = String(process.env.FIREBASE_SA || "");
let sa;
try { sa = JSON.parse(saRaw.slice(saRaw.indexOf("{"), saRaw.lastIndexOf("}") + 1)); }
catch (e) { console.log("FIREBASE_SA is not a full service-account JSON file: length " + saRaw.length + ", has { " + saRaw.includes("{") + ", has } " + saRaw.includes("}") + ", has private_key " + saRaw.includes("private_key")); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const stateDoc = db.collection("meta").doc("pushState"); // server-only: news already handled, daily caps

// Push (VAPID) keys: made once by the worker itself and kept in the database. The private key is in
// meta/vapid (server-only); the public key is published at public/push so the site can subscribe phones.
const vapidDoc = db.collection("meta").doc("vapid");
let vapid = (await vapidDoc.get()).data();
if (!vapid?.publicKey || !vapid?.privateKey) {
  vapid = webpush.generateVAPIDKeys();
  await vapidDoc.set(vapid);
  console.log("Made new push keys");
}
await db.collection("public").doc("push").set({ vapidPublic: vapid.publicKey });
webpush.setVapidDetails("https://cadensauce.github.io/scoreline/", vapid.publicKey, vapid.privateKey);
console.log("Push worker ready for project", sa.project_id);

// ---- subscribers -------------------------------------------------------------------------
let subs = [];
let subsAt = 0;
async function loadSubs() {
  const snap = await db.collection("pushSubs").get();
  subs = snap.docs.map((d) => {
    const x = d.data();
    return { id: d.id, sub: { endpoint: x.endpoint, keys: { p256dh: x.p256dh, auth: x.auth } }, favs: new Set(x.favs || []), prefs: x.prefs || {} };
  }).filter((s) => s.sub.endpoint && s.favs.size);
  subsAt = Date.now();
  console.log(new Date().toISOString(), "subscribers:", subs.length);
}

// Each person picks, per alert and per team: always / playoffs / champ (Super Bowl, Finals...) / off.
// Must match ALERT_DEFAULTS in index.html.
const DEFAULTS = { start: "always", score: "always", halftime: "playoffs", second: "off", close: "playoffs", final: "always", trades: "always", injuries: "always", bignews: "always" };
const asMode = (v) => (v === true ? "always" : v === false ? "off" : v);
const isChampionship = (ev) => /super bowl|nba finals|world series|national championship|cfp national|championship game/i.test([ev?.name, ev?.competitions?.[0]?.notes?.[0]?.headline].join(" "));
function wants(prefs, team, kind, ev) {
  const m = asMode(prefs[kind + "@" + team] ?? prefs[kind] ?? DEFAULTS[kind] ?? "off");
  if (!ev) return m !== "off";                                  // team news: on or off
  return m === "always" || (m === "playoffs" && ev.season?.type === 3) || (m === "champ" && isChampionship(ev));
}

// Send to everyone who follows `teamKey` and wants this alert for it. One alert per person per key.
const sentKeys = new Set();
const FCM_PREFIX = "https://fcm.native/";
async function send(teamKey, kind, title, body, dedupe, ev) {
  const targets = subs.filter((s) => s.favs.has(teamKey) && wants(s.prefs, teamKey, kind, ev) && !sentKeys.has(s.id + "|" + dedupe));
  if (!targets.length) return 0;
  const payload = JSON.stringify({ title, body, tag: dedupe, url: "./" });
  await Promise.all(targets.map(async (s) => {
    sentKeys.add(s.id + "|" + dedupe);
    const ttl = kind === "start" || kind === "score" ? 900 : 3600;
    const drop = async () => { await db.collection("pushSubs").doc(s.id).delete().catch(() => {}); subs = subs.filter((x) => x !== s); };
    // The installed Android app: its address is "https://fcm.native/<token>", sent through Firebase Cloud Messaging.
    if (s.sub.endpoint.startsWith(FCM_PREFIX)) {
      try {
        await admin.messaging().send({
          token: s.sub.endpoint.slice(FCM_PREFIX.length),
          data: { title, body, tag: String(dedupe) },
          android: { priority: "high", ttl: ttl * 1000 },
        });
      } catch (e) {
        if (/registration-token-not-registered|invalid-registration-token/.test(e.code || "")) await drop();
        else console.log("app push failed", e.code || e.message);
      }
      return;
    }
    try { await webpush.sendNotification(s.sub, payload, { TTL: ttl, urgency: "high" }); }
    catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await drop();
      else console.log("push failed", e.statusCode || e.message);
    }
  }));
  console.log(new Date().toISOString(), kind, "→", targets.length, "|", title, "|", body);
  return targets.length;
}

// ---- games -------------------------------------------------------------------------------
const teamsOf = (ev) => (ev.competitions?.[0]?.competitors || []).slice().sort((a) => (a.homeAway === "away" ? -1 : 1));
const keyOf = (t) => t.team?.uid || t.team?.id;
const nick = (t) => t.team?.name || t.team?.shortDisplayName || t.team?.abbreviation;
const scoreLine = (ev) => teamsOf(ev).map((t) => (t.team?.abbreviation || nick(t)) + " " + (t.score ?? 0)).join(" – ");
const tv = (ev) => (ev.competitions?.[0]?.broadcasts || []).flatMap((b) => b.names || [])[0];
const footballScore = (pts) => (pts >= 6 ? "touchdown" : pts === 3 ? "field goal" : pts === 2 ? "safety" : pts === 1 ? "extra point" : "score");
const seen = new Map();      // event id -> { st, scores:[a,h], period }
const closeSent = new Set();
let firstPass = true;

async function checkGames() {
  for (const [lg, L] of Object.entries(LEAGUES)) {
    let data;
    try { data = await (await fetch(API + L.path + "/scoreboard" + (L.extra ? "?" + L.extra : ""))).json(); } catch { continue; }
    for (const ev of data.events || []) {
      const teams = teamsOf(ev);
      if (teams.length !== 2) continue;
      const st = ev.status?.type?.state, period = ev.status?.period || 0, clock = ev.status?.type?.shortDetail || "";
      const sc = teams.map((t) => Number(t.score) || 0);
      const prev = seen.get(ev.id);
      seen.set(ev.id, { st, sc, period, clock });
      if (firstPass || !prev) continue;

      for (let i = 0; i < 2; i++) {
        const me = teams[i], opp = teams[1 - i], key = keyOf(me), mine = sc[i], theirs = sc[1 - i];
        // Game starting
        const lead = (mine > theirs ? nick(me) + " lead " : mine < theirs ? nick(me) + " trail " : "Tied ") + Math.max(mine, theirs) + "–" + Math.min(mine, theirs);
        if (prev.st === "pre" && st === "in")
          await send(key, "start", L.icon + " " + nick(me) + " vs " + nick(opp) + " is starting", [tv(ev), "Tap to follow along"].filter(Boolean).join(" · "), "start-" + ev.id, ev);
        // Your team scores (basketball: end of Q1 and Q3 instead of every basket; Q2 is "halftime")
        if (st === "in" && lg !== "nba" && mine > prev.sc[i]) {
          const pts = mine - prev.sc[i];
          const what = lg === "mlb" ? (pts === 1 ? "scores a run" : "scores " + pts + " runs") : footballScore(pts);
          await send(key, "score", L.icon + " " + nick(me) + " " + what, scoreLine(ev) + " · " + clock, "score-" + ev.id + "-" + i + "-" + mine, ev);
        }
        if (lg === "nba" && st === "in" && period > prev.period && prev.period >= 1 && prev.period !== 2)
          await send(key, "score", L.icon + " End of Q" + prev.period + ": " + lead, scoreLine(ev), "q-" + ev.id + "-" + prev.period, ev);
        // Halftime and second-half start (not baseball)
        if (lg !== "mlb" && st === "in" && /halftime/i.test(clock) && !/halftime/i.test(prev.clock || ""))
          await send(key, "halftime", L.icon + " Halftime: " + lead, scoreLine(ev), "half-" + ev.id, ev);
        if (lg !== "mlb" && st === "in" && prev.period === 2 && period === 3)
          await send(key, "second", L.icon + " Second half: " + nick(me) + " vs " + nick(opp), scoreLine(ev), "second-" + ev.id, ev);
        // Final
        if (st === "post" && prev.st !== "post") {
          const res = mine > theirs ? "win" : mine < theirs ? "lose" : "tie";
          await send(key, "final", L.icon + " Final: " + nick(me) + " " + res + " " + Math.max(mine, theirs) + "–" + Math.min(mine, theirs), "vs " + (opp.team?.displayName || nick(opp)), "final-" + ev.id, ev);
        }
      }
      // Close finish, once per game
      const diff = Math.abs(sc[0] - sc[1]);
      const late = lg === "mlb" ? period >= 9 && diff <= 1 : lg === "nba" ? period >= 4 && diff <= 5 && /^[0-2]:\d\d/.test(clock) : period >= 4 && diff <= 8 && /^[0-4]:\d\d/.test(clock);
      if (st === "in" && late && !closeSent.has(ev.id)) {
        closeSent.add(ev.id);
        for (const t of teams) await send(keyOf(t), "close", L.icon + " Close finish: " + nick(teams[0]) + " vs " + nick(teams[1]), scoreLine(ev) + " · " + clock, "close-" + ev.id, ev);
      }
    }
  }
  firstPass = false;
}

// ---- Formula 1 (followed as a whole, key "f1"): session starting + results ------------------
const F1_SESSIONS = { FP1: "Practice 1", FP2: "Practice 2", FP3: "Practice 3", Qual: "Qualifying", SQ: "Sprint Qualifying", SS: "Sprint Shootout", Sprint: "Sprint", Race: "Race" };
const f1Seen = new Map();
let f1First = true;
async function checkF1() {
  let ev;
  try { ev = (await (await fetch(API + "racing/f1/scoreboard")).json()).events?.[0]; } catch { return; }
  for (const c of ev?.competitions || []) {
    const ab = c.type?.abbreviation || "", name = F1_SESSIONS[ab] || ab, st = c.status?.type?.state, key = "f1-" + (c.id || ab + c.date);
    const prev = f1Seen.get(key);
    f1Seen.set(key, st);
    if (f1First || !prev || prev === st || !/^(Qual|SQ|SS|Sprint|Race)$/.test(ab)) continue;
    if (prev === "pre" && st === "in") await send("f1", "start", "🏁 " + name + " is starting", ev.name, "start-" + key);
    if (prev !== "post" && st === "post" && /^(Qual|Race|Sprint)$/.test(ab)) {
      const top = (c.competitors || []).slice().sort((a, b) => (a.order || 99) - (b.order || 99)).slice(0, 3).map((d) => d.athlete?.shortName || d.athlete?.displayName);
      await send("f1", "final", "🏁 " + (ab === "Qual" ? "Pole: " + top[0] : name + " result: " + top[0] + " wins"), ab === "Qual" ? ev.name : top.map((n, k) => "P" + (k + 1) + " " + n).join(" · "), "final-" + key);
    }
  }
  f1First = false;
}

// ---- team news ---------------------------------------------------------------------------
// Only big, clear-cut stories. Each rule needs a strong keyword; routine items are filtered out.
const NEWS_RULES = [
  { kind: "trades", label: "Trade", re: /\b(trade[sd]?|traded|acquires?|acquired|blockbuster|deal sends)\b/i },
  { kind: "injuries", label: "Injury", re: /\b(torn|tears|ACL|Achilles|season-ending|out for (the )?season|injured reserve|placed on IR|to IR|surgery|fracture[sd]?|broken)\b/i },
  { kind: "bignews", label: "News", re: /\b(fired|hires|hired|names? .* head coach|new head coach|suspended|suspension|retires|retirement|retiring|extension|signs? .*(year|\$|million)|agree[sd]? to .*(year|\$|million))\b/i },
];
const SKIP = /\b(practice squad|minor league|optioned|two-way contract|g league|mock draft|fantasy|betting|odds|picks|predictions|rankings|power rankings|takeaways|grades|what we learned|questionable|probable|game-time decision|day-to-day)\b/i;
let newsState = { seen: [], caps: {} };
const teamNames = {};   // team key -> ["49ers", "San Francisco", ...]
let newsAt = 0;

async function checkNews() {
  newsAt = Date.now();
  const teams = new Set(subs.flatMap((s) => [...s.favs]));
  const today = new Date().toISOString().slice(0, 10);
  const seenSet = new Set(newsState.seen);
  const firstRun = !newsState.seen.length;
  for (const key of teams) {
    const m = String(key).match(/l:(\d+)~t:(\d+)/);
    if (!m) continue;
    const L = Object.values(LEAGUES).find((x) => String(x.league) === m[1]);
    if (!L) continue;
    let data;
    try { data = await (await fetch(API + L.path + "/news?team=" + m[2] + "&limit=15")).json(); } catch { continue; }
    // The team feed mixes in league-wide stories; only keep ones that actually name this team.
    if (!teamNames[key]) {
      try { const t = (await (await fetch(API + L.path + "/teams/" + m[2])).json()).team || {}; teamNames[key] = [t.name, t.location, t.shortDisplayName, t.abbreviation].filter((x) => x && x.length > 1); } catch { teamNames[key] = []; }
    }
    const names = teamNames[key];
    for (const a of data.articles || []) {
      const id = String(a.id || a.dataSourceIdentifier || a.headline);
      if (seenSet.has(id)) continue;
      seenSet.add(id); newsState.seen.push(id);
      if (firstRun) continue;                                   // first run: just remember what's out there
      const ageH = (Date.now() - new Date(a.published || a.lastModified || 0)) / 3600000;
      if (!(ageH < 6)) continue;                               // only fresh news
      const text = (a.headline || "") + " " + (a.description || "");
      if (SKIP.test(text)) continue;
      if (!names.some((nm) => new RegExp("\\b" + nm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(text))) continue;
      const rule = NEWS_RULES.find((r) => r.re.test(text));
      if (!rule) continue;
      const capKey = today + "|" + key;
      if ((newsState.caps[capKey] || 0) >= NEWS_PER_TEAM_PER_DAY) continue;
      const n = await send(key, rule.kind, L.icon + " " + rule.label + ": " + (a.headline || "").slice(0, 110), (a.description || "").slice(0, 140), "news-" + id);
      if (n) newsState.caps[capKey] = (newsState.caps[capKey] || 0) + 1;
    }
  }
  newsState.seen = newsState.seen.slice(-3000);
  for (const k of Object.keys(newsState.caps)) if (!k.startsWith(today)) delete newsState.caps[k];
  await stateDoc.set(newsState).catch((e) => console.log("state save failed", e.message));
}

// ---- main loop ---------------------------------------------------------------------------
try { const d = await stateDoc.get(); if (d.exists) newsState = { seen: d.data().seen || [], caps: d.data().caps || {} }; } catch {}
const until = Date.now() + RUN_FOR_MS;
console.log("Push worker running until", new Date(until).toISOString());
while (Date.now() < until) {
  const t0 = Date.now();
  try {
    if (Date.now() - subsAt > SUBS_EVERY_MS) await loadSubs();
    await checkGames();
    await checkF1();
    if (Date.now() - newsAt > NEWS_EVERY_MS) await checkNews();
  } catch (e) { console.log("tick error", e.message); }
  await new Promise((r) => setTimeout(r, Math.max(1000, TICK_MS - (Date.now() - t0))));
}
console.log("Push worker finished this shift");
process.exit(0);
