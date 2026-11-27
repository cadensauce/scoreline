// Firestore rules tests for the Ideas board (one vote each, anonymous stays anonymous) and private suggestions.
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, writeBatch, serverTimestamp, Timestamp, updateDoc, collection, getDocs, addDoc } from "firebase/firestore";

let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-scoreline-ideas", firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8") } });
});
after(() => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, "profiles/ann"), { username: "ann" });
    await setDoc(doc(db, "roles/modi"), { role: "mod" });
    await setDoc(doc(db, "ideas/i1"), { text: "Add darts", name: "", at: Timestamp.now(), status: "open", up: 2, down: 0, lg: "" });
    await setDoc(doc(db, "ideaAuthors/i1"), { uid: "bob" });
    await setDoc(doc(db, "ideas/i1/votes/bob"), { v: 1 });
  });
});
const as = (uid) => env.authenticatedContext(uid).firestore();
const post = (uid, data, id = "i2", author = uid) => { const db = as(uid), b = writeBatch(db); b.set(doc(db, "ideas/" + id), { text: "Add ping pong", name: "", at: serverTimestamp(), status: "open", up: 0, down: 0, lg: "", ...data }); b.set(doc(db, "ideaAuthors/" + id), { uid: author }); return b.commit(); };
const vote = (uid, counts, v) => { const db = as(uid), b = writeBatch(db); b.update(doc(db, "ideas/i1"), counts); if (v) b.set(doc(db, "ideas/i1/votes/" + uid), { v }); else b.delete(doc(db, "ideas/i1/votes/" + uid)); return b.commit(); };

test("post an idea with your name or anonymously", async () => {
  await assertSucceeds(post("ann", { name: "ann" }));
  await assertSucceeds(post("ann", { name: "" }, "i3"));
});
test("can't post as someone else's name", () => assertFails(post("ann", { name: "bob" })));
test("can't post with fake votes or status", async () => {
  await assertFails(post("ann", { up: 50 }));
  await assertFails(post("ann", { status: "planned" }));
});
test("can't claim another person wrote it", () => assertFails(post("ann", {}, "i4", "bob")));
test("upvote adds exactly one", () => assertSucceeds(vote("ann", { up: 3, down: 0 }, 1)));
test("can't add more than one vote", () => assertFails(vote("ann", { up: 5, down: 0 }, 1)));
test("switch from up to down", () => assertSucceeds(vote("bob", { up: 1, down: 1 }, -1)));
test("take your vote back", () => assertSucceeds(vote("bob", { up: 1, down: 0 }, 0)));
test("anonymous stays anonymous: others can't see who wrote it", async () => {
  await assertFails(getDoc(doc(as("ann"), "ideaAuthors/i1")));
  await assertSucceeds(getDoc(doc(as("modi"), "ideaAuthors/i1")));
  await assertSucceeds(getDoc(doc(as("bob"), "ideaAuthors/i1")));
});
test("only Owner/Mods set status", async () => {
  await assertFails(updateDoc(doc(as("ann"), "ideas/i1"), { status: "done" }));
  await assertSucceeds(updateDoc(doc(as("modi"), "ideas/i1"), { status: "planned" }));
});
test("private suggestions: anyone sends, only the team reads", async () => {
  await assertSucceeds(addDoc(collection(as("ann"), "suggestions"), { text: "Please add darts", name: "", at: serverTimestamp() }));
  await assertFails(getDocs(collection(as("ann"), "suggestions")));
  await assertSucceeds(getDocs(collection(as("modi"), "suggestions")));
});
