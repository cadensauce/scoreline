// Firestore rules tests for roles (Owner > Dev / Mod / Beta Tester) and who can read reports.
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp, Timestamp, collection, getDocs } from "firebase/firestore";

let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-scoreline-roles", firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8") } });
});
after(() => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, "roles/boss"), { role: "owner" });
    await setDoc(doc(db, "roles/modi"), { role: "mod", by: "boss", at: Timestamp.now() });
    await setDoc(doc(db, "reports/r1"), { from: "joe", about: "bad", reason: "spam", at: Timestamp.now() });
  });
});
const as = (uid) => env.authenticatedContext(uid).firestore();
const give = (who, uid, role, extra = {}) => setDoc(doc(as(who), "roles/" + uid), { role, by: who, at: serverTimestamp(), ...extra });

test("the owner can give Dev, Mod and Beta Tester", async () => {
  await assertSucceeds(give("boss", "ann", "dev"));
  await assertSucceeds(give("boss", "bob", "mod"));
  await assertSucceeds(give("boss", "cat", "tester"));
});
test("the owner can take a role away", () => assertSucceeds(deleteDoc(doc(as("boss"), "roles/modi"))));
test("nobody else can give roles", async () => {
  await assertFails(give("modi", "ann", "mod"));
  await assertFails(give("joe", "joe", "dev"));
  await assertFails(give("joe", "ann", "dev"));
});
test("no one can hand out Owner", () => assertFails(give("boss", "ann", "owner")));
test("the owner can't change their own role or another owner's", async () => {
  await assertFails(give("boss", "boss", "dev"));
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), "roles/boss2"), { role: "owner" }));
  await assertFails(give("boss", "boss2", "mod"));
  await assertFails(deleteDoc(doc(as("boss"), "roles/boss2")));
});
test("made-up roles and extra fields are refused", async () => {
  await assertFails(give("boss", "ann", "king"));
  await assertFails(give("boss", "ann", "dev", { power: 9 }));
});
test("mods can't remove roles", () => assertFails(deleteDoc(doc(as("modi"), "roles/boss"))));
test("everyone signed in can see role tags", () => assertSucceeds(getDoc(doc(as("joe"), "roles/modi"))));
test("the owner and mods can read reports; others can't", async () => {
  await assertSucceeds(getDocs(collection(as("boss"), "reports")));
  await assertSucceeds(getDocs(collection(as("modi"), "reports")));
  await assertFails(getDocs(collection(as("joe"), "reports")));
  await assertFails(deleteDoc(doc(as("boss"), "reports/r1")));
});

test("site switch: only the owner can change it; everyone can read it", async () => {
  await assertSucceeds(setDoc(doc(as("boss"), "public/site"), { mode: "readonly", msg: "brb", at: serverTimestamp(), by: "boss" }));
  await assertFails(setDoc(doc(as("modi"), "public/site"), { mode: "on", msg: "", at: serverTimestamp(), by: "modi" }));
  await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), "public/site")));
  await assertFails(setDoc(doc(as("boss"), "public/site"), { mode: "nuke", msg: "", at: serverTimestamp(), by: "boss" }));
});
test("read-only pauses friend requests but reports still work", async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), "public/site"), { mode: "readonly", msg: "", at: Timestamp.now(), by: "boss" }));
  await assertFails(setDoc(doc(as("joe"), "requests/joe_ann"), { from: "joe", to: "ann", status: "pending", at: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(as("joe"), "reports/r2"), { from: "joe", about: "bad", reason: "spam", at: serverTimestamp() }));
});

test("brackets: your own only, and locked once the playoffs start", async () => {
  const mine = { uid: "joe", lg: "nfl", season: 2026, picks: { "AFC|0|0": 2 }, seeds: { AFC: { "2": "17" } }, at: serverTimestamp() };
  await assertSucceeds(setDoc(doc(as("joe"), "brackets/joe_nfl_2026"), mine));
  await assertFails(setDoc(doc(as("ann"), "brackets/joe_nfl_2026"), mine));
  await assertFails(getDoc(doc(as("ann"), "brackets/joe_nfl_2026")));
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), "public/bracketLocks"), { nfl_2026: Timestamp.fromMillis(Date.now() - 1000) }));
  await assertFails(setDoc(doc(as("joe"), "brackets/joe_nfl_2026"), mine));
});
