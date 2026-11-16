// Scoreline push worker. Runs on GitHub Actions (see .github/workflows/push.yml).
// Sends a small number of clear alerts, only about the teams each person follows:
//   games: starting, your team scores (basketball: end of quarter), close finish, final
//   news:  trades, major injuries, big moves (coach changes, suspensions, retirements, big contracts)
//
// Secret (repo Settings → Secrets → Actions): FIREBASE_SA (service account JSON). Push keys live in Firestore.

import webpush from "web-push";
import admin from "firebase-admin";
import nodemailer from "nodemailer";
import crypto from "node:crypto";

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
// Startup check that ESPN answers from this server (shown in public/push.espnCheck).
{
  const check = {};
  for (const [k, p] of [["nfl", "football/nfl"], ["nba", "basketball/nba"]]) {
    try { const r = await fetch("https://site.api.espn.com/apis/site/v2/sports/" + p + "/scoreboard"); const j = r.ok ? await r.json() : null; check[k] = r.status + (j ? " · " + (j.events || []).length + " games" : ""); }
    catch (e) { check[k] = "error: " + (e.cause?.code || e.message); }
  }
  check.at = new Date().toISOString();
  console.log("ESPN check", JSON.stringify(check));
  await db.collection("public").doc("push").set({ espnCheck: check }, { merge: true }).catch(() => {});
}

// ---- one-time sign-in codes (website → newly installed app) -----------------------------------
// A signed-in person creates signinCodes/{code} for their own uid (rules enforce that). We add a one-time
// Firebase sign-in token; the app reads it with the exact code, signs in, and deletes the code. Codes last 10 min.
const CODE_TTL = 10 * 60 * 1000;
db.collection("signinCodes").onSnapshot((snap) => {
  snap.docChanges().forEach(async (c) => {
    if (c.type !== "added") return;
    const x = c.doc.data();
    if (x.token || !x.uid) return;
    if (Date.now() - (x.createdAt?.toMillis?.() || 0) > CODE_TTL) { await c.doc.ref.delete().catch(() => {}); return; }
    try {
      // Creating a code needed a fully signed-in device, so the new device counts as verified for two-step too.
      const ts = (await db.collection("twoStep").doc(x.uid).get()).exists;
      await c.doc.ref.update({ token: await admin.auth().createCustomToken(x.uid, ts ? { ts: true } : undefined) });
      console.log(new Date().toISOString(), "sign-in code ready");
    }
    catch (e) { console.log("sign-in code failed", e.message); }
  });
}, (e) => console.log("sign-in code listener stopped", e.message));
setInterval(async () => {   // clean up codes nobody used
  const old = await db.collection("signinCodes").where("createdAt", "<", new Date(Date.now() - CODE_TTL)).get().catch(() => null);
  old?.docs.forEach((d) => d.ref.delete().catch(() => {}));
}, 5 * 60 * 1000);

// ---- two-step sign-in: emailed 6-digit codes ---------------------------------------------------
// Secrets SMTP_USER / SMTP_PASS: a Gmail account made for Scoreline and its app password.
const mailer = process.env.SMTP_USER && process.env.SMTP_PASS
  ? nodemailer.createTransport({ service: "gmail", auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }) : null;
const OTP_TTL = 10 * 60 * 1000;
const hashCode = (uid, code) => crypto.createHash("sha256").update(uid + ":" + code).digest("hex");
const answer = (uid, data) => db.collection("otpResults").doc(uid).set({ ...data, at: admin.firestore.FieldValue.serverTimestamp() });
db.collection("otpRequests").onSnapshot((snap) => {
  snap.docChanges().forEach(async (c) => {
    if (c.type === "removed") return;
    const uid = c.doc.id, x = c.doc.data();
    if (Date.now() - (x.createdAt?.toMillis?.() || 0) > 2 * 60 * 1000) return;          // stale request
    if (!mailer) { await answer(uid, { error: "Email codes aren't set up yet." }); return; }
    try {
      const u = await admin.auth().getUser(uid);
      if (!u.email) { await answer(uid, { error: "This account has no email address." }); return; }
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      await db.collection("otpCodes").doc(uid).set({ hash: hashCode(uid, code), expires: Date.now() + OTP_TTL, tries: 0, purpose: x.purpose === "enable" ? "enable" : "signin" });
      await mailer.sendMail({
        from: `"Scoreline" <${process.env.SMTP_USER}>`, to: u.email,
        subject: `${code} is your Scoreline code`,
        text: `Your Scoreline sign-in code is ${code}\n\nIt works for 10 minutes. If you didn't try to sign in, you can ignore this email; someone may know your password, so consider changing it.`,
      });
      console.log(new Date().toISOString(), "two-step code sent");
    } catch (e) { console.log("two-step email failed", e.message); await answer(uid, { error: "Couldn't send the email. Try again in a minute." }); }
  });
}, (e) => console.log("otp request listener stopped", e.message));
db.collection("otpAttempts").onSnapshot((snap) => {
  snap.docChanges().forEach(async (c) => {
    if (c.type === "removed") return;
    const uid = c.doc.id, typed = String(c.doc.data().code || "");
    const ref = db.collection("otpCodes").doc(uid);
    try {
      const rec = (await ref.get()).data();
      if (!rec) { await answer(uid, { error: "Ask for a new code." }); return; }
      if (Date.now() > rec.expires) { await ref.delete(); await answer(uid, { error: "That code expired. Ask for a new one." }); return; }
      if (rec.tries >= 5) { await ref.delete(); await answer(uid, { error: "Too many tries. Ask for a new code." }); return; }
      if (!crypto.timingSafeEqual(Buffer.from(hashCode(uid, typed)), Buffer.from(rec.hash))) {
        await ref.update({ tries: rec.tries + 1 }); await answer(uid, { error: "That code isn't right." }); return;
      }
      await ref.delete();
      if (rec.purpose === "enable") await db.collection("twoStep").doc(uid).set({ since: admin.firestore.FieldValue.serverTimestamp() });
      await answer(uid, { token: await admin.auth().createCustomToken(uid, { ts: true }), purpose: rec.purpose });
      console.log(new Date().toISOString(), "two-step verified");
    } catch (e) { console.log("two-step check failed", e.message); await answer(uid, { error: "Something went wrong. Try again." }); }
    c.doc.ref.delete().catch(() => {});
  });
}, (e) => console.log("otp attempt listener stopped", e.message));
// ---- subscribers -------------------------------------------------------------------------
let subs = [];
let subsAt = 0;
let lastTest = null;   // shown in public/push.status so a test can be checked without logs
async function loadSubs() {
  const snap = await db.collection("pushSubs").get();
  const all = snap.docs.map((d) => {
    const x = d.data();
    return { id: d.id, sub: { endpoint: x.endpoint, keys: { p256dh: x.p256dh, auth: x.auth } }, favs: new Set(x.favs || []), prefs: x.prefs || {} };
  }).filter((s) => s.sub.endpoint);
  // "Send test notification" in the app sets prefs.testAt; answer each new request once, within 10 minutes.
  for (const s of all) {
    const at = Date.parse(s.prefs.testAt || "");
    if (at && Date.now() - at < 600000 && !sentKeys.has(s.id + "|test|" + at)) {
      sentKeys.add(s.id + "|test|" + at);
      const result = await deliver(s, "✅ Scoreline alerts work", "This test came from the alert server, so alerts reach you even when the app is closed.", "test", 600);
      lastTest = { at: new Date().toISOString(), result };
      console.log(new Date().toISOString(), "test →", s.id.slice(0, 8), result);
    }
  }
  subs = all.filter((s) => s.favs.size);
  subsAt = Date.now();
  console.log(new Date().toISOString(), "subscribers:", subs.length);
  // Health check anyone can read: just counts, no addresses or teams.
  const apps = subs.filter((s) => s.sub.endpoint.startsWith("https://fcm.native/")).length;
  // Setup health: how many phones reported each code in the last 2 days (e.g. "ok", "C: …", "off").
  const since = Date.now() - 2 * 86400000, codes = {};
  try { (await db.collection("diag").get()).docs.forEach((d) => { const x = d.data(); if (x.at?.toMillis?.() > since) { const k = (x.app || "?") + " | " + x.code; codes[k] = (codes[k] || 0) + 1; } }); } catch {}
  await db.collection("public").doc("push").update({ status: { phones: subs.length, androidApp: apps, homeScreen: subs.length - apps, setup: codes, lastTest, checkedAt: new Date().toISOString() } }).catch(() => {});
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
// Deliver one alert to one phone: the Android app via Firebase Cloud Messaging, home-screen installs via web push.
async function deliver(s, title, body, tag, ttl) {
  const drop = async () => { await db.collection("pushSubs").doc(s.id).delete().catch(() => {}); subs = subs.filter((x) => x !== s); };
  if (s.sub.endpoint.startsWith(FCM_PREFIX)) {
    try {
      const id = await admin.messaging().send({
        token: s.sub.endpoint.slice(FCM_PREFIX.length),
        // A "notification" message is shown by Android itself when the app is closed (no app code has to wake up);
        // when the app is open, the app's own service gets it and shows it the same way.
        notification: { title, body },
        data: { title, body, tag: String(tag) },
        android: { priority: "high", ttl: ttl * 1000, notification: { channelId: "scores", tag: String(tag), icon: "ic_stat_scoreline", defaultSound: true } },
      });
      return "app: sent " + String(id).split("/").pop();
    } catch (e) {
      if (/registration-token-not-registered|invalid-registration-token/.test(e.code || "")) { await drop(); return "app: " + e.code; }
      console.log("app push failed", e.code || e.message); return "app: " + (e.code || e.message);
    }
  }
  try { await webpush.sendNotification(s.sub, JSON.stringify({ title, body, tag, url: "./" }), { TTL: ttl, urgency: "high" }); return "web: sent"; }
  catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) { await drop(); return "web: gone"; }
    console.log("push failed", e.statusCode || e.message); return "web: " + (e.statusCode || e.message);
  }
}
async function send(teamKey, kind, title, body, dedupe, ev) {
  const targets = subs.filter((s) => s.favs.has(teamKey) && wants(s.prefs, teamKey, kind, ev) && !sentKeys.has(s.id + "|" + dedupe));
  if (!targets.length) return 0;
  await Promise.all(targets.map(async (s) => {
    sentKeys.add(s.id + "|" + dedupe);
    await deliver(s, title, body, dedupe, kind === "start" || kind === "score" ? 900 : 3600);
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
