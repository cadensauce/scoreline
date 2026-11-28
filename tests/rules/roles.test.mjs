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

test("recovery email: only your own, and it must look like an email", async () => {
  await assertSucceeds(setDoc(doc(as("joe"), "recovery/joe"), { email: "joe@example.com", at: serverTimestamp() }));
  await assertFails(getDoc(doc(as("ann"), "recovery/joe")));
  await assertFails(setDoc(doc(as("ann"), "recovery/joe"), { email: "x@y.com", at: serverTimestamp() }));
  await assertFails(setDoc(doc(as("ann"), "recovery/ann"), { email: "not an email", at: serverTimestamp() }));
});
test("forgot password: anyone can ask, nobody can read the requests", async () => {
  const anon = env.unauthenticatedContext().firestore();
  await assertSucceeds(setDoc(doc(anon, "resetRequests/r1"), { username: "joe", at: serverTimestamp() }));
  await assertFails(getDoc(doc(as("joe"), "resetRequests/r1")));
  await assertFails(setDoc(doc(anon, "resetRequests/r2"), { username: "JOE!!", at: serverTimestamp() }));
});
test("brackets: your own only, and locked once the playoffs start", async () => {
  const mine = { uid: "joe", lg: "nfl", season: 2026, picks: { "AFC|0|0": 2 }, seeds: { AFC: { "2": "17" } }, at: serverTimestamp() };
  await assertSucceeds(setDoc(doc(as("joe"), "brackets/joe_nfl_2026"), mine));
  await assertFails(setDoc(doc(as("ann"), "brackets/joe_nfl_2026"), mine));
  await assertFails(getDoc(doc(as("ann"), "brackets/joe_nfl_2026")));
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), "public/bracketLocks"), { nfl_2026: Timestamp.fromMillis(Date.now() - 1000) }));
  await assertFails(setDoc(doc(as("joe"), "brackets/joe_nfl_2026"), mine));
});

// Mod tools: bans and warnings.
const ban = (who, uid, extra = {}) => setDoc(doc(as(who), "bans/" + uid), { by: who, reason: "spam", until: null, at: serverTimestamp(), ...extra });
const warn = (who, to, extra = {}) => setDoc(doc(as(who), "warnings/w_" + who + "_" + to), { to, by: who, reason: "be nice", at: serverTimestamp(), ...extra });
test("mods and the owner can ban and warn regular people", async () => {
  await assertSucceeds(ban("modi", "joe"));
  await assertSucceeds(ban("boss", "ann", { until: Timestamp.fromMillis(Date.now() + 86400000) }));
  await assertSucceeds(warn("modi", "cat"));
  await assertSucceeds(warn("boss", "cat2"));
});
test("regular people can't ban or warn", async () => {
  await assertFails(ban("joe", "ann"));
  await assertFails(warn("joe", "ann"));
});
test("mods can't ban the owner, other mods or devs; the owner can", async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), "roles/devi"), { role: "dev", by: "boss", at: Timestamp.now() }));
  await assertFails(ban("modi", "boss"));
  await assertFails(ban("modi", "devi"));
  await assertFails(warn("modi", "devi"));
  await assertSucceeds(ban("boss", "devi"));
  await assertFails(ban("modi", "modi"));
});
test("a paused mod can't moderate", async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), "roles/modi"), { role: "mod", by: "boss", at: Timestamp.now(), paused: true }));
  await assertFails(ban("modi", "joe"));
  await assertFails(warn("modi", "joe"));
});
test("a ban needs a reason and can't be faked", async () => {
  await assertFails(ban("modi", "joe", { reason: "" }));
  await assertFails(ban("modi", "joe", { by: "boss" }));
  await assertFails(ban("modi", "joe", { power: 1 }));
});
test("you can see your own ban and warnings, and mark a warning seen", async () => {
  await assertSucceeds(ban("modi", "joe"));
  await assertSucceeds(warn("modi", "joe"));
  await assertSucceeds(getDoc(doc(as("joe"), "bans/joe")));
  await assertSucceeds(getDoc(doc(as("joe"), "warnings/w_modi_joe")));
  await assertFails(getDoc(doc(as("ann"), "warnings/w_modi_joe")));
  await assertSucceeds(setDoc(doc(as("joe"), "warnings/w_modi_joe"), { seen: true }, { merge: true }));
  await assertFails(setDoc(doc(as("joe"), "warnings/w_modi_joe"), { reason: "nothing" }, { merge: true }));
  await assertFails(deleteDoc(doc(as("joe"), "bans/joe")));
});
test("only you can link your phones for chat alerts, and nobody reads them", async () => {
  const dev = "a".repeat(64);
  await assertSucceeds(setDoc(doc(as("joe"), "chatPush/joe/devices/" + dev), { at: serverTimestamp() }));
  await assertFails(setDoc(doc(as("ann"), "chatPush/joe/devices/" + dev), { at: serverTimestamp() }));
  await assertFails(setDoc(doc(as("joe"), "chatPush/joe/devices/short"), { at: serverTimestamp() }));
  await assertFails(getDoc(doc(as("joe"), "chatPush/joe/devices/" + dev)));
  await assertSucceeds(deleteDoc(doc(as("joe"), "chatPush/joe/devices/" + dev)));
});
