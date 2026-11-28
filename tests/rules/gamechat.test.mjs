// Firestore rules tests for game chat: Terms (13+) and chat rules needed, text only, no links, 1 message per 5 s.
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, writeBatch, deleteDoc, collection, getDocs, serverTimestamp, Timestamp } from "firebase/firestore";

let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-scoreline-gamechat", firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8") } });
});
after(() => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    for (const u of ["ann", "bob", "kid", "modi"]) await setDoc(doc(db, "chatOk/" + u), { at: Timestamp.now() });
    for (const u of ["ann", "bob", "modi"]) await setDoc(doc(db, "ages/" + u), { is13plus: true, at: Timestamp.now() });
    await setDoc(doc(db, "ages/kid"), { is13plus: false, at: Timestamp.now() });
    await setDoc(doc(db, "roles/boss"), { role: "owner" });
    await setDoc(doc(db, "roles/modi"), { role: "mod", by: "boss", at: Timestamp.now() });
    await setDoc(doc(db, "gamechat/nba_401/msgs/old"), { from: "bob", text: "Let's go", at: Timestamp.now() });
  });
});
const as = (uid) => env.authenticatedContext(uid).firestore();
function say(uid, text, gid = "nba_401", id = "m" + Math.random().toString(36).slice(2)) {
  const db = as(uid), b = writeBatch(db);
  b.set(doc(db, "gcLast/" + uid), { at: serverTimestamp() });
  b.set(doc(db, "gamechat/" + gid + "/msgs/" + id), { from: uid, text, at: serverTimestamp() });
  return b.commit();
}

test("signed-in people can read a game chat", () => assertSucceeds(getDocs(collection(as("kid"), "gamechat/nba_401/msgs"))));
test("signed out can't read it", () => assertFails(getDocs(collection(env.unauthenticatedContext().firestore(), "gamechat/nba_401/msgs"))));
test("post a message", () => assertSucceeds(say("ann", "What a dunk 🔥")));
test("works for every sport", () => assertSucceeds(say("ann", "Box box", "f1_600041")));
test("unknown game id is refused", () => assertFails(say("ann", "hi", "soccer_1")));
test("needs the Terms agreement (13+)", () => assertFails(say("kid", "hi")));
test("needs the chat rules agreed", async () => {
  await env.withSecurityRulesDisabled((c) => deleteDoc(doc(c.firestore(), "chatOk/ann")));
  await assertFails(say("ann", "hi"));
});
test("no links", () => assertFails(say("ann", "watch here www.example.com")));
test("no link-like handles", () => assertFails(say("ann", "join my Discord")));
test("200 characters max", () => assertFails(say("ann", "a".repeat(201))));
test("can't post as someone else", () => {
  const db = as("ann"), b = writeBatch(db);
  b.set(doc(db, "gcLast/ann"), { at: serverTimestamp() });
  b.set(doc(db, "gamechat/nba_401/msgs/x"), { from: "bob", text: "hi", at: serverTimestamp() });
  return assertFails(b.commit());
});
test("must update the 5-second timer in the same write", () => assertFails(setDoc(doc(as("ann"), "gamechat/nba_401/msgs/y"), { from: "ann", text: "hi", at: serverTimestamp() })));
test("one message every 5 seconds", async () => {
  await assertSucceeds(say("ann", "one"));
  await assertFails(say("ann", "two"));
});
test("you can delete your own message", () => assertSucceeds(deleteDoc(doc(as("bob"), "gamechat/nba_401/msgs/old"))));
test("you can't delete someone else's", () => assertFails(deleteDoc(doc(as("ann"), "gamechat/nba_401/msgs/old"))));
test("a Mod can delete any message", () => assertSucceeds(deleteDoc(doc(as("modi"), "gamechat/nba_401/msgs/old"))));
test("messages can't be edited", () => assertFails(setDoc(doc(as("bob"), "gamechat/nba_401/msgs/old"), { from: "bob", text: "edited", at: serverTimestamp() })));
test("the timer is private", () => assertFails(getDoc(doc(as("ann"), "gcLast/ann"))));
