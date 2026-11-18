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
const DEV_SETUP = () => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), "devs/dev"), { note: "owner" }));
const grant = (by, uid, amount, o = {}) => {
  const db = as(by), id = o.id || "grant_" + Math.random().toString(36).slice(2, 14), at = serverTimestamp(), b = writeBatch(db);
  if (o.ledger !== false) b.set(doc(db, "ledger/" + uid + "/entries/" + id), { amount: o.logged ?? amount, reason: "dev", by: o.byField || by, createdAt: at });
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
