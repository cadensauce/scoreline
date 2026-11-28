// Firestore rules tests for reactions: one per person per item, counts can't be faked.
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, writeBatch, deleteDoc } from "firebase/firestore";

let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-scoreline-react", firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8") } });
});
after(() => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, "reactions/play_1"), { c: { fire: 3 } });
    await setDoc(doc(db, "reactions/play_1/by/bob"), { e: "fire" });
  });
});
const as = (uid) => env.authenticatedContext(uid).firestore();
// React (or change / remove) the way the app does: both docs in one batch.
function react(uid, item, counts, e) {
  const db = as(uid), b = writeBatch(db);
  b.set(doc(db, "reactions/" + item), { c: counts });
  if (e) b.set(doc(db, "reactions/" + item + "/by/" + uid), { m: Array.isArray(e) ? e : [e] }); else b.delete(doc(db, "reactions/" + item + "/by/" + uid));
  return b.commit();
}

test("anyone can see the counts", () => assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), "reactions/play_1"))));
test("react: your reaction adds exactly one", () => assertSucceeds(react("ann", "play_1", { fire: 4 }, "fire")));
test("first reaction on a new item", () => assertSucceeds(react("ann", "news_9", { lol: 1 }, "lol")));
test("can't add more than one", () => assertFails(react("ann", "play_1", { fire: 10 }, "fire")));
test("can't change counts without your own reaction", () => assertFails(setDoc(doc(as("ann"), "reactions/play_1"), { c: { fire: 4 } })));
test("can't react twice with the same emoji", async () => {
  await assertSucceeds(react("ann", "play_1", { fire: 4 }, "fire"));
  await assertFails(react("ann", "play_1", { fire: 5 }, "fire"));
});
test("switching emoji moves your one count", () => assertSucceeds(react("bob", "play_1", { fire: 2, goat: 1 }, "goat")));
test("removing your reaction takes one off", () => assertSucceeds(react("bob", "play_1", { fire: 2 }, null)));
test("can't take off more than yours", () => assertFails(react("bob", "play_1", { fire: 0 }, null)));
test("can't react as someone else", () => assertFails(setDoc(doc(as("ann"), "reactions/play_1/by/carl"), { m: ["fire"] })));
test("only the six emojis", () => assertFails(react("ann", "play_1", { fire: 3, poop: 1 }, "poop")));
test("your reaction is private", () => assertFails(getDoc(doc(as("ann"), "reactions/play_1/by/bob"))));
test("signed out can't react", () => assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), "reactions/play_1"), { c: { fire: 4 } })));
test("several reactions at once: each emoji counts once", () => assertSucceeds(react("ann", "play_1", { fire: 4, lol: 1 }, ["fire", "lol"])));
test("an older single reaction can add a second emoji", () => assertSucceeds(react("bob", "play_1", { fire: 3, goat: 1 }, ["fire", "goat"])));
test("can't list the same emoji twice", () => assertFails(react("ann", "play_1", { fire: 5 }, ["fire", "fire"])));
test("several reactions: counts must match exactly", () => assertFails(react("ann", "play_1", { fire: 4, lol: 2 }, ["fire", "lol"])));
test("removing one of several keeps the rest", async () => {
  await assertSucceeds(react("ann", "play_1", { fire: 4, lol: 1 }, ["fire", "lol"]));
  await assertSucceeds(react("ann", "play_1", { fire: 3, lol: 1 }, ["lol"]));
});
