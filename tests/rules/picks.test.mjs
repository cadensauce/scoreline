// Firestore rules tests for picks and Marks (run on the Firestore emulator in GitHub Actions; see test.yml).
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, updateDoc, serverTimestamp, Timestamp, collection, getDocs, query, where, writeBatch, increment } from "firebase/firestore";

let env;
const HOUR = 3600e3;
before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-scoreline", firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8") } });
});
after(() => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, "games/nfl_1"), { lockAt: Timestamp.fromMillis(Date.now() + HOUR), rewards: { home: 10, away: 25 } });   // upcoming
    await setDoc(doc(db, "games/nfl_2"), { lockAt: Timestamp.fromMillis(Date.now() - HOUR), rewards: { home: 15, away: 15 } });   // started
    await setDoc(doc(db, "ages/teen"), { is13plus: true, at: Timestamp.now() });
    await setDoc(doc(db, "ages/kid"), { is13plus: false, at: Timestamp.now() });
    await setDoc(doc(db, "shopItems/t_sharp"), { kind: "title", name: "Sharp", price: 75, order: 1 });
    await setDoc(doc(db, "shopItems/b_gold"), { kind: "banner", name: "Gold", price: 500, order: 2 });
    await setDoc(doc(db, "wallets/teen"), { balance: 100 });
    await setDoc(doc(db, "wallets/kid"), { balance: 100 });
    await setDoc(doc(db, "picks/teen_nfl_2"), { uid: "teen", gameId: "nfl_2", side: "home", updatedAt: Timestamp.fromMillis(Date.now() - 2 * HOUR) });
  });
});
const as = (uid) => env.authenticatedContext(uid).firestore();
const pick = (uid, gameId, side = "home", extra = {}) => setDoc(doc(as(uid), "picks/" + uid + "_" + gameId), { uid, gameId, side, updatedAt: serverTimestamp(), ...extra });

test("agreed can pick before kickoff", () => assertSucceeds(pick("teen", "nfl_1")));
test("13+ can change and clear a pick before kickoff", async () => {
  await assertSucceeds(pick("teen", "nfl_1", "home"));
  await assertSucceeds(pick("teen", "nfl_1", "away"));
  await assertSucceeds(deleteDoc(doc(as("teen"), "picks/teen_nfl_1")));
});
test("no pick after kickoff", () => assertFails(pick("teen", "nfl_2")));
test("no clearing a pick after kickoff", () => assertFails(deleteDoc(doc(as("teen"), "picks/teen_nfl_2"))));
test("people who said no can still pick (just for fun)", () => assertSucceeds(pick("kid", "nfl_1")));
test("people who never agreed can still pick (just for fun)", () => assertSucceeds(pick("newbie", "nfl_1")));
test("signed out can't pick", () => assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), "picks/x_nfl_1"), { uid: "x", gameId: "nfl_1", side: "home", updatedAt: serverTimestamp() })));
test("no pick for a game that isn't open", () => assertFails(pick("teen", "nfl_999")));
test("can't pick for someone else", () => assertFails(setDoc(doc(as("teen"), "picks/other_nfl_1"), { uid: "other", gameId: "nfl_1", side: "home", updatedAt: serverTimestamp() })));
test("can't mark your own pick as won", () => assertFails(pick("teen", "nfl_1", "home", { result: "won", reward: 100 })));
test("side must be home or away", () => assertFails(pick("teen", "nfl_1", "draw")));
test("phone clock can't be used as the pick time", () => assertFails(setDoc(doc(as("teen"), "picks/teen_nfl_1"), { uid: "teen", gameId: "nfl_1", side: "home", updatedAt: Timestamp.fromMillis(Date.now() - HOUR) })));
test("can't read someone else's pick", () => assertFails(getDoc(doc(as("other"), "picks/teen_nfl_2"))));
test("can read your own picks", () => assertSucceeds(getDocs(query(collection(as("teen"), "picks"), where("uid", "==", "teen")))));
test("can't give yourself Marks", () => assertFails(setDoc(doc(as("teen"), "wallets/teen"), { balance: 1000 })));
test("can't write your own ledger", () => assertFails(setDoc(doc(as("teen"), "ledger/teen/entries/x"), { amount: 1000 })));
test("can read your own balance, not others'", async () => {
  await assertSucceeds(getDoc(doc(as("teen"), "wallets/teen")));
  await assertFails(getDoc(doc(as("other"), "wallets/teen")));
});
test("games are public to read, nobody writes them", async () => {
  await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), "games/nfl_1")));
  await assertFails(updateDoc(doc(as("teen"), "games/nfl_1"), { lockAt: Timestamp.fromMillis(Date.now() + 99 * HOUR) }));
});
test("age: answered once, then can't change", async () => {
  await assertSucceeds(setDoc(doc(as("newbie"), "ages/newbie"), { is13plus: true, at: serverTimestamp() }));
  await assertFails(setDoc(doc(as("kid"), "ages/kid"), { is13plus: true, at: serverTimestamp() }));
  await assertFails(updateDoc(doc(as("kid"), "ages/kid"), { is13plus: true }));
});
test("age: you can withdraw your own agreement, not someone else's", async () => {
  await assertFails(deleteDoc(doc(as("other"), "ages/teen")));
  await assertSucceeds(deleteDoc(doc(as("teen"), "ages/teen")));
  await assertSucceeds(setDoc(doc(as("teen"), "ages/teen"), { is13plus: true, at: serverTimestamp() }));   // and agree again
});
test("age: only true/false is stored", () => assertFails(setDoc(doc(as("newbie"), "ages/newbie"), { is13plus: true, at: serverTimestamp(), birthYear: 2010 })));
test("age: only your own", () => assertFails(setDoc(doc(as("newbie"), "ages/someone"), { is13plus: true, at: serverTimestamp() })));

// ---- Shop ----
const buy = (uid, item, price, { charge = price, ledger = true } = {}) => {
  const db = as(uid), b = writeBatch(db), at = serverTimestamp();
  b.set(doc(db, "inventory/" + uid + "/items/" + item), { price, at });
  b.update(doc(db, "wallets/" + uid), { balance: increment(-charge), updatedAt: at });
  if (ledger) b.set(doc(db, "ledger/" + uid + "/entries/shop_" + item), { amount: -price, reason: "shop", refId: item, createdAt: at });
  return b.commit();
};
const card = (uid, extra) => setDoc(doc(as(uid), "cards/" + uid), { avatar: "", bio: "", teams: [], show: "friends", updatedAt: serverTimestamp(), ...extra });
test("shop: buy a title with enough Marks", () => assertSucceeds(buy("teen", "t_sharp", 75)));
test("shop: not enough Marks", () => assertFails(buy("teen", "b_gold", 500)));
test("shop: wrong price", () => assertFails(buy("teen", "t_sharp", 1, { charge: 1 })));
test("shop: Marks must actually come off", () => assertFails(buy("teen", "t_sharp", 75, { charge: 1 })));
test("shop: needs the ledger entry", () => assertFails(buy("teen", "t_sharp", 75, { ledger: false })));
test("shop: can't buy the same thing twice", async () => {
  await assertSucceeds(buy("teen", "t_sharp", 75));
  await assertFails(buy("teen", "t_sharp", 75));
});
test("shop: only people who agreed (13+)", () => assertFails(buy("kid", "t_sharp", 75)));
test("shop: can't raise your own balance", () => assertFails(updateDoc(doc(as("teen"), "wallets/teen"), { balance: 5000 })));
test("shop: can't add a ledger entry without the item", () => assertFails(setDoc(doc(as("teen"), "ledger/teen/entries/shop_t_sharp"), { amount: -75, reason: "shop", refId: "t_sharp", createdAt: serverTimestamp() })));
test("shop: show a title you own", async () => {
  await assertSucceeds(buy("teen", "t_sharp", 75));
  await assertSucceeds(card("teen", { title: "t_sharp", banner: "" }));
});
test("shop: can't show a title you don't own", () => assertFails(card("teen", { title: "t_sharp" })));
test("shop: profile card without shop fields still saves", () => assertSucceeds(card("teen", {})));

// Dev accounts: give Marks by username (devs/<uid> is set by hand in the console).
const DEV_SETUP = () => env.withSecurityRulesDisabled(async (c) => { const db = c.firestore(); await setDoc(doc(db, "devs/devname"), { note: "owner" }); await setDoc(doc(db, "usernames/devname"), { uid: "dev" }); await setDoc(doc(db, "usernames/teenname"), { uid: "teen" }); });
const grant = (by, uid, amount, o = {}) => {
  const db = as(by), id = o.id || "grant_" + Math.random().toString(36).slice(2, 14), at = serverTimestamp(), b = writeBatch(db);
  if (o.ledger !== false) b.set(doc(db, "ledger/" + uid + "/entries/" + id), { amount: o.logged ?? amount, reason: "dev", by: o.byField || by, dev: o.devName ?? (by === "dev" ? "devname" : "teenname"), createdAt: at });
  b.set(doc(db, "wallets/" + uid), { balance: increment(amount), updatedAt: at, lastGrant: id }, { merge: true });
  return b.commit();
};
test("dev: give Marks to someone 13+", async () => { await DEV_SETUP(); await assertSucceeds(grant("dev", "teen", 500)); });
test("dev: give Marks to yourself (if 13+)", async () => {
  await DEV_SETUP();
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), "ages/dev"), { is13plus: true, at: Timestamp.now() }));
  await assertSucceeds(grant("dev", "dev", 50));   // no wallet yet: created with the gift
});
test("dev: not to people who didn't agree (13+)", async () => { await DEV_SETUP(); await assertFails(grant("dev", "kid", 50)); });
test("dev: amount must match the ledger entry", async () => { await DEV_SETUP(); await assertFails(grant("dev", "teen", 5000, { logged: 5 })); });
test("dev: needs the ledger entry", async () => { await DEV_SETUP(); await assertFails(grant("dev", "teen", 50, { ledger: false })); });
test("dev: at most 10,000 at a time", async () => { await DEV_SETUP(); await assertFails(grant("dev", "teen", 10001)); });
test("dev: gift is signed with the real dev", async () => { await DEV_SETUP(); await assertFails(grant("dev", "teen", 50, { byField: "someone" })); });
test("non-dev can't give Marks, even to themselves", () => assertFails(grant("teen", "teen", 50)));
test("can't make yourself a dev", () => assertFails(setDoc(doc(as("teen"), "devs/teen"), { note: "me" })));
test("dev: can't borrow a dev's username", async () => { await DEV_SETUP(); await assertFails(grant("teen", "teen", 50, { devName: "devname" })); });
test("dev: a dev can read their own devs entry, others can't", async () => {
  await DEV_SETUP();
  await assertSucceeds(getDoc(doc(as("dev"), "devs/devname")));
  await assertFails(getDoc(doc(as("teen"), "devs/devname")));
});

// Security limits: settings, friend requests, chats and messages only take what the app writes.
test("settings: normal save works, junk fields don't", async () => {
  await assertSucceeds(setDoc(doc(as("teen"), "users/teen"), { favs: ["nfl|1"], favNames: { "nfl|1": "Team" }, alertPrefs: { finals: true }, updatedAt: serverTimestamp() }, { merge: true }));
  await assertFails(setDoc(doc(as("teen"), "users/teen"), { hack: "x".repeat(1000) }, { merge: true }));
  await assertFails(setDoc(doc(as("teen"), "users/teen"), { favs: Array.from({ length: 500 }, (_, i) => "t" + i) }, { merge: true }));
  await assertFails(getDoc(doc(as("other"), "users/teen")));
});
test("friend request: only from/to/status/at", async () => {
  await assertSucceeds(setDoc(doc(as("teen"), "requests/teen_other"), { from: "teen", to: "other", status: "pending", at: serverTimestamp() }));
  await assertFails(setDoc(doc(as("teen"), "requests/teen_kid"), { from: "teen", to: "kid", status: "pending", at: serverTimestamp(), extra: "x" }));
});
test("messages: server time only, no extra fields", async () => {
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, "requests/teen_other"), { from: "teen", to: "other", status: "accepted" });
    await setDoc(doc(db, "chats/other_teen"), { members: ["other", "teen"], updatedAt: Timestamp.now() });
    await setDoc(doc(db, "chatOk/teen"), { at: Timestamp.now() });   // agreed to the chat rules
  });
  await assertSucceeds(setDoc(doc(as("teen"), "chats/other_teen/messages/m1"), { from: "teen", text: "hi", at: serverTimestamp() }));
  await assertFails(setDoc(doc(as("teen"), "chats/other_teen/messages/m2"), { from: "teen", text: "hi", at: Timestamp.fromMillis(Date.now() - 864e5) }));
  await assertFails(setDoc(doc(as("teen"), "chats/other_teen/messages/m3"), { from: "teen", text: "hi", at: serverTimestamp(), html: "<b>x</b>" }));
  await assertFails(updateDoc(doc(as("teen"), "chats/other_teen"), { junk: "x" }));
});

// Fantasy: Free mode for anyone signed in; Marks mode only with the Terms agreement (13+); lineups lock at first game.
const FSETUP = () => env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  await setDoc(doc(db, "fcontests/nfl_w_1"), { lg: "nfl", fmt: "w", lockAt: Timestamp.fromMillis(Date.now() + HOUR), pool: { p1: { n: "A", t: "SF", p: "QB" }, p2: { n: "B", t: "SF", p: "RB" } } });
  await setDoc(doc(db, "fcontests/nfl_w_0"), { lg: "nfl", fmt: "w", lockAt: Timestamp.fromMillis(Date.now() - HOUR), pool: { p1: { n: "A", t: "SF", p: "QB" } } });
});
const lineup = (uid, cid, mode, lu) => setDoc(doc(as(uid), "fentries/" + cid + "_" + mode + "_" + uid), { uid, contestId: cid, mode, lineup: lu, updatedAt: serverTimestamp() });
test("fantasy: free mode works without the Terms agreement", async () => { await FSETUP(); await assertSucceeds(lineup("newbie", "nfl_w_1", "free", { qb: "p1", rb1: "p2" })); });
test("fantasy: marks mode works with the agreement", async () => { await FSETUP(); await assertSucceeds(lineup("teen", "nfl_w_1", "marks", { qb: "p1" })); });
test("fantasy: marks mode blocked without the agreement", async () => { await FSETUP(); await assertFails(lineup("newbie", "nfl_w_1", "marks", { qb: "p1" })); await assertFails(lineup("kid", "nfl_w_1", "marks", { qb: "p1" })); });
test("fantasy: locked after first game", async () => { await FSETUP(); await assertFails(lineup("teen", "nfl_w_0", "free", { qb: "p1" })); });
test("fantasy: only players from the contest, no repeats", async () => {
  await FSETUP();
  await assertFails(lineup("teen", "nfl_w_1", "free", { qb: "zzz" }));
  await assertFails(lineup("teen", "nfl_w_1", "free", { qb: "p1", rb1: "p1" }));
});
test("fantasy: can't write a score or someone else's lineup", async () => {
  await FSETUP();
  await assertFails(setDoc(doc(as("teen"), "fentries/nfl_w_1_free_teen"), { uid: "teen", contestId: "nfl_w_1", mode: "free", lineup: {}, updatedAt: serverTimestamp(), score: 999 }));
  await assertFails(setDoc(doc(as("teen"), "fentries/nfl_w_1_free_other"), { uid: "other", contestId: "nfl_w_1", mode: "free", lineup: {}, updatedAt: serverTimestamp() }));
});
test("fantasy: contests are public, nobody writes them", async () => {
  await FSETUP();
  await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), "fcontests/nfl_w_1")));
  await assertFails(setDoc(doc(as("teen"), "fcontests/x"), { lockAt: Timestamp.now() }));
});
test("withdrawn: can't show a title or banner (frozen), can still clear them", async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), "inventory/kid/items/t_sharp"), { price: 75, at: Timestamp.now() }));
  await assertFails(card("kid", { title: "t_sharp" }));
  await assertSucceeds(card("kid", { title: "", banner: "" }));
});

// Season leagues: create, join (friends of the owner), snake draft turns, starters from your own roster.
const LSETUP = () => env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  await setDoc(doc(db, "fpool/f1"), { players: { d1: { n: "A", t: "", p: "D" }, d2: { n: "B", t: "", p: "D" }, d3: { n: "C", t: "", p: "D" }, d4: { n: "D", t: "", p: "D" }, d5: { n: "E", t: "", p: "D" }, d6: { n: "F", t: "", p: "D" } } });
  await setDoc(doc(db, "requests/teen_pal"), { from: "teen", to: "pal", status: "accepted" });
});
const newLeague = (uid, extra = {}) => setDoc(doc(as(uid), "leagues/L1"), { name: "Friends", lg: "f1", mode: "free", owner: uid, members: [uid], invites: ["pal", "stranger"], status: "forming", rosterSize: 3, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...extra });
const leagueAs = async (state) => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), "leagues/L1"), { name: "Friends", lg: "f1", mode: "free", owner: "teen", invites: [], rosterSize: 3, createdAt: Timestamp.now(), ...state }));
test("league: create (free), and Marks leagues need the agreement", async () => {
  await LSETUP();
  await assertSucceeds(newLeague("teen"));
  await assertFails(setDoc(doc(as("newbie"), "leagues/L2"), { name: "x", lg: "f1", mode: "marks", owner: "newbie", members: ["newbie"], invites: [], status: "forming", rosterSize: 3, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
});
test("league: invited friend can join, invited non-friend can't", async () => {
  await LSETUP(); await assertSucceeds(newLeague("teen"));
  await assertSucceeds(updateDoc(doc(as("pal"), "leagues/L1"), { members: ["teen", "pal"], invites: ["stranger"], updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as("stranger"), "leagues/L1"), { members: ["teen", "pal", "stranger"], invites: [], updatedAt: serverTimestamp() }));
});
test("league: only the owner starts the draft, with exactly the members", async () => {
  await LSETUP(); await leagueAs({ members: ["teen", "pal"], status: "forming" });
  await assertFails(updateDoc(doc(as("pal"), "leagues/L1"), { status: "drafting", order: ["pal", "teen"], pick: 0, taken: {}, invites: [], updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as("teen"), "leagues/L1"), { status: "drafting", order: ["teen", "zed"], pick: 0, taken: {}, invites: [], updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(as("teen"), "leagues/L1"), { status: "drafting", order: ["pal", "teen"], pick: 0, taken: {}, invites: [], updatedAt: serverTimestamp() }));
});
const pickAs = (uid, pick, who, pid, taken, extra = {}) => updateDoc(doc(as(uid), "leagues/L1"), { pick, last: { uid: who, pid }, taken, status: "drafting", updatedAt: serverTimestamp(), ...extra });
test("league draft: your turn only, one free player from the list", async () => {
  await LSETUP(); await leagueAs({ members: ["teen", "pal"], status: "drafting", order: ["pal", "teen"], pick: 0, taken: {} });
  await assertFails(pickAs("teen", 1, "teen", "d1", { d1: "teen" }));          // not teen's turn (pal is first)
  await assertFails(pickAs("pal", 1, "pal", "zz", { zz: "pal" }));             // not a real player
  await assertSucceeds(pickAs("pal", 1, "pal", "d1", { d1: "pal" }));
  await assertFails(pickAs("teen", 2, "teen", "d1", { d1: "teen" }));          // already taken
  await assertSucceeds(pickAs("teen", 2, "teen", "d2", { d1: "pal", d2: "teen" }));
  await assertSucceeds(pickAs("teen", 3, "teen", "d3", { d1: "pal", d2: "teen", d3: "teen" }));   // snake: teen again
});
test("league draft: owner can pick for whoever's turn it is; last pick starts the season", async () => {
  await LSETUP(); await leagueAs({ members: ["teen", "pal"], status: "drafting", order: ["pal", "teen"], pick: 5, taken: { d1: "pal", d2: "teen", d3: "teen", d4: "pal", d5: "pal" } });
  // pick 5: round 2 (even) -> order[1] = teen. Owner (teen) makes it; it's the last pick (2 x 3 = 6).
  await assertFails(pickAs("teen", 6, "teen", "d6", { d1: "pal", d2: "teen", d3: "teen", d4: "pal", d5: "pal", d6: "teen" }));   // must start the season
  await assertSucceeds(pickAs("teen", 6, "teen", "d6", { d1: "pal", d2: "teen", d3: "teen", d4: "pal", d5: "pal", d6: "teen" }, { status: "active", startedAt: serverTimestamp() }));
});
test("league starters: only your own drafted players, only the sport's spots", async () => {
  await LSETUP(); await leagueAs({ members: ["teen", "pal"], status: "active", order: ["pal", "teen"], pick: 6, taken: { d1: "pal", d2: "teen", d3: "teen" } });
  const st = (uid, lineup) => setDoc(doc(as(uid), "lstarts/L1_" + uid), { uid, leagueId: "L1", lineup, updatedAt: serverTimestamp() });
  await assertSucceeds(st("teen", { d1: "d2", d2: "d3" }));
  await assertFails(st("teen", { d1: "d1" }));       // pal's driver
  await assertFails(st("teen", { qb: "d2" }));       // not an F1 spot
  await assertFails(st("stranger", { d1: "d2" }));   // not in the league
});

// ---- profiles: name, theme, favourites, decorations; stats only from the worker ----
const fullCard = (uid, extra) => card(uid, { name: "Caden", theme: "field", sports: ["nfl", "f1"], favTeams: [{ lg: "nfl", id: "25", n: "San Francisco 49ers", a: "SF", l: "https://a.espncdn.com/i/teamlogos/nfl/500/sf.png" }], favPlayers: [{ lg: "nfl", id: "4361741", n: "Brock Purdy", t: "SF", p: "QB" }], ...extra });
test("profile: name, theme, sports, teams and players save", () => assertSucceeds(fullCard("teen")));
test("profile: works without agreeing to the Terms (no Shop extras)", () => assertSucceeds(fullCard("newbie")));
test("profile: unknown theme is refused", () => assertFails(fullCard("teen", { theme: "neon" })));
test("profile: unknown sport is refused", () => assertFails(fullCard("teen", { sports: ["nfl", "cricket"] })));
test("profile: at most 20 favourite players", () => assertFails(fullCard("teen", { favPlayers: Array.from({ length: 21 }, (_, i) => ({ lg: "nba", id: String(i), n: "P" + i })) })));
test("profile: at most 12 favourite teams", () => assertFails(fullCard("teen", { favTeams: Array.from({ length: 13 }, (_, i) => ({ lg: "nba", id: String(i), n: "T" + i })) })));
test("profile: display name at most 30 characters", () => assertFails(fullCard("teen", { name: "x".repeat(31) })));
test("profile: no extra fields", () => assertFails(fullCard("teen", { email: "a@b.c" })));
test("profile: decoration you don't own is refused", () => assertFails(fullCard("teen", { deco: "d_ring" })));
test("profile: decoration you own shows (13+ and agreed)", async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), "inventory/teen/items/d_ring"), { price: 0, at: Timestamp.now() }));
  await assertSucceeds(fullCard("teen", { deco: "d_ring" }));
});
test("profile: decoration needs the Terms agreement even if owned", async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), "inventory/kid/items/d_ring"), { price: 0, at: Timestamp.now() }));
  await assertFails(fullCard("kid", { deco: "d_ring" }));
});
test("profile: friends can see it, strangers can't", async () => {
  await fullCard("teen");
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), "requests/teen_pal"), { from: "teen", to: "pal", status: "accepted" }));
  await assertSucceeds(getDoc(doc(as("pal"), "cards/teen")));
  await assertFails(getDoc(doc(as("other"), "cards/teen")));
});
test("stats: nobody can write their own", async () => {
  await assertFails(setDoc(doc(as("teen"), "pstats/teen"), { picks: { w: 999, l: 0 } }));
  await assertFails(setDoc(doc(as("pal"), "pstats/teen"), { picks: { w: 0, l: 999 } }));
});
test("stats: you and your friends can read them; strangers and 'Only me' profiles can't", async () => {
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, "pstats/teen"), { picks: { w: 3, l: 1 }, at: Date.now() });
    await setDoc(doc(db, "requests/teen_pal"), { from: "teen", to: "pal", status: "accepted" });
  });
  await fullCard("teen");
  await assertSucceeds(getDoc(doc(as("teen"), "pstats/teen")));
  await assertSucceeds(getDoc(doc(as("pal"), "pstats/teen")));
  await assertFails(getDoc(doc(as("other"), "pstats/teen")));
  await fullCard("teen", { show: "me" });
  await assertFails(getDoc(doc(as("pal"), "pstats/teen")));
});
test("roles: anyone signed in can see a badge; nobody can give themselves one", async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), "roles/teen"), { role: "owner" }));
  await assertSucceeds(getDoc(doc(as("other"), "roles/teen")));
  await assertFails(setDoc(doc(as("other"), "roles/other"), { role: "owner" }));
  await assertFails(updateDoc(doc(as("teen"), "roles/teen"), { role: "admin" }));
});
