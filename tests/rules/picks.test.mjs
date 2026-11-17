// Firestore rules tests for picks and Marks (run on the Firestore emulator in GitHub Actions; see test.yml).
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, updateDoc, serverTimestamp, Timestamp, collection, getDocs, query, where } from "firebase/firestore";

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
  await assertFails(deleteDoc(doc(as("kid"), "ages/kid")));
});
test("age: only true/false is stored", () => assertFails(setDoc(doc(as("newbie"), "ages/newbie"), { is13plus: true, at: serverTimestamp(), birthYear: 2010 })));
test("age: only your own", () => assertFails(setDoc(doc(as("newbie"), "ages/someone"), { is13plus: true, at: serverTimestamp() })));
