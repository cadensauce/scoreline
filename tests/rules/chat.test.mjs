// Firestore rules tests for chats: direct chats, group invites, sharing, the chat rules agreement, blocking and reports.
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, updateDoc, serverTimestamp, Timestamp, collection, addDoc, arrayRemove, arrayUnion } from "firebase/firestore";

let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-scoreline-chat", firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8") } });
});
after(() => env?.cleanup());
// ann and bob are friends; cat is a stranger. ann and bob agreed to the chat rules; cat did too.
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, "requests/ann_bob"), { from: "ann", to: "bob", status: "accepted", at: Timestamp.now() });
    await setDoc(doc(db, "chats/ann_bob"), { members: ["ann", "bob"], updatedAt: Timestamp.now() });
    for (const u of ["ann", "bob", "cat"]) await setDoc(doc(db, "chatOk/" + u), { at: Timestamp.now() });
    await setDoc(doc(db, "chats/g_group12345"), { group: true, name: "Niners", owner: "ann", members: ["ann", "bob"], invited: ["cat"], updatedAt: Timestamp.now() });
  });
});
const as = (uid) => env.authenticatedContext(uid).firestore();
const send = (uid, chat, data) => addDoc(collection(as(uid), "chats/" + chat + "/messages"), { from: uid, text: "hi", at: serverTimestamp(), ...data });

test("friends can open a direct chat", async () => {
  await env.withSecurityRulesDisabled((c) => deleteDoc(doc(c.firestore(), "chats/ann_bob")));
  await assertSucceeds(setDoc(doc(as("ann"), "chats/ann_bob"), { members: ["ann", "bob"], updatedAt: serverTimestamp() }));
});
test("strangers can't open a direct chat", () => assertFails(setDoc(doc(as("ann"), "chats/ann_cat"), { members: ["ann", "cat"], updatedAt: serverTimestamp() })));
test("friends can send a message", () => assertSucceeds(send("ann", "ann_bob")));
test("can't send as someone else", () => assertFails(addDoc(collection(as("ann"), "chats/ann_bob/messages"), { from: "bob", text: "hi", at: serverTimestamp() })));
test("outsiders can't read or send", async () => {
  await assertFails(send("cat", "ann_bob"));
  await assertFails(getDoc(doc(as("cat"), "chats/ann_bob")));
});
test("must agree to the chat rules before sending", async () => {
  await env.withSecurityRulesDisabled((c) => deleteDoc(doc(c.firestore(), "chatOk/ann")));
  await assertFails(send("ann", "ann_bob"));
  await assertSucceeds(setDoc(doc(as("ann"), "chatOk/ann"), { at: serverTimestamp() }));
  await assertSucceeds(send("ann", "ann_bob"));
});
test("chat rules agreement: only your own", () => assertFails(setDoc(doc(as("ann"), "chatOk/bob"), { at: serverTimestamp() })));
test("no messaging after you stop being friends", async () => {
  await env.withSecurityRulesDisabled((c) => deleteDoc(doc(c.firestore(), "requests/ann_bob")));
  await assertFails(send("ann", "ann_bob"));
});
test("blocked people can't message you", async () => {
  await assertSucceeds(setDoc(doc(as("bob"), "blocks/bob/people/ann"), { at: serverTimestamp() }));
  await assertFails(send("ann", "ann_bob"));
  await assertSucceeds(send("bob", "ann_bob"));
});
test("your block list is private", async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), "blocks/bob/people/ann"), { at: Timestamp.now() }));
  await assertFails(getDoc(doc(as("ann"), "blocks/bob/people/ann")));
  await assertFails(setDoc(doc(as("ann"), "blocks/bob/people/cat"), { at: serverTimestamp() }));
});
test("sharing a game works; junk shares don't", async () => {
  await assertSucceeds(send("ann", "ann_bob", { text: "", share: { k: "game", lg: "nfl", id: "401873077", t: "MIN @ SF" } }));
  await assertFails(send("ann", "ann_bob", { text: "", share: { k: "virus", id: "1", t: "x" } }));
  await assertFails(send("ann", "ann_bob", { text: "" }));
});
test("messages are 500 characters at most", () => assertFails(send("ann", "ann_bob", { text: "x".repeat(501) })));
test("the latest-message preview is yours and short", async () => {
  await assertSucceeds(updateDoc(doc(as("ann"), "chats/ann_bob"), { updatedAt: serverTimestamp(), last: { from: "ann", text: "hi", at: serverTimestamp() } }));
  await assertFails(updateDoc(doc(as("ann"), "chats/ann_bob"), { updatedAt: serverTimestamp(), last: { from: "bob", text: "hi", at: serverTimestamp() } }));
  await assertFails(updateDoc(doc(as("ann"), "chats/ann_bob"), { members: ["ann", "bob", "cat"] }));
});

test("make a group: you're the only member, others are invited", async () => {
  await assertSucceeds(setDoc(doc(as("ann"), "chats/g_newgroup99"), { group: true, name: "Squad", owner: "ann", members: ["ann"], invited: ["bob", "cat"], updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(as("ann"), "chats/g_newgroup98"), { group: true, name: "Squad", owner: "ann", members: ["ann", "bob"], invited: ["cat"], updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(as("ann"), "chats/g_newgroup97"), { group: true, name: "Squad", owner: "bob", members: ["ann"], invited: ["cat"], updatedAt: serverTimestamp() }));
});
test("invited people can see the invite but not the messages", async () => {
  await assertSucceeds(getDoc(doc(as("cat"), "chats/g_group12345")));
  await assertFails(send("cat", "g_group12345"));
});
test("accept an invite, then chat", async () => {
  await assertSucceeds(updateDoc(doc(as("cat"), "chats/g_group12345"), { invited: arrayRemove("cat"), members: arrayUnion("cat"), updatedAt: serverTimestamp() }));
  await assertSucceeds(send("cat", "g_group12345"));
});
test("decline an invite", () => assertSucceeds(updateDoc(doc(as("cat"), "chats/g_group12345"), { invited: arrayRemove("cat"), updatedAt: serverTimestamp() })));
test("can't accept for someone else or add yourself uninvited", async () => {
  await assertFails(updateDoc(doc(as("bob"), "chats/g_group12345"), { invited: arrayRemove("cat"), members: arrayUnion("cat") }));
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), "chatOk/dan"), { at: Timestamp.now() }));
  await assertFails(updateDoc(doc(as("dan"), "chats/g_group12345"), { members: arrayUnion("dan") }));
});
test("leave a group", async () => {
  await assertSucceeds(updateDoc(doc(as("bob"), "chats/g_group12345"), { members: arrayRemove("bob"), updatedAt: serverTimestamp() }));
  await assertFails(send("bob", "g_group12345"));
});
test("only the owner renames, invites or removes", async () => {
  await assertSucceeds(updateDoc(doc(as("ann"), "chats/g_group12345"), { name: "Faithful", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as("bob"), "chats/g_group12345"), { name: "Mine now" }));
  await assertSucceeds(updateDoc(doc(as("ann"), "chats/g_group12345"), { members: ["ann"], updatedAt: serverTimestamp() }));
});
test("the owner can't add people straight in", () => assertFails(updateDoc(doc(as("ann"), "chats/g_group12345"), { members: ["ann", "bob", "cat"] })));

test("send a report; nobody can read reports in the app", async () => {
  await assertSucceeds(addDoc(collection(as("ann"), "reports"), { from: "ann", about: "cat", chat: "g_group12345", text: "mean message", reason: "bullying", at: serverTimestamp() }));
  await assertFails(addDoc(collection(as("ann"), "reports"), { from: "bob", about: "cat", reason: "bullying", at: serverTimestamp() }));
  await assertFails(addDoc(collection(as("ann"), "reports"), { from: "ann", about: "cat", reason: "made-up", at: serverTimestamp() }));
});

// Chat photos: a small JPEG saved inside the message (no file storage on the free plan).
const JPEG = "data:image/jpeg;base64," + "A".repeat(2000);
test("friends can send a photo", () => assertSucceeds(send("ann", "ann_bob", { text: "", img: JPEG })));
test("photos must be a JPEG data address", async () => {
  await assertFails(send("ann", "ann_bob", { text: "", img: "data:image/png;base64,AAAA" }));
  await assertFails(send("ann", "ann_bob", { text: "", img: "https://example.com/x.jpg" }));
  await assertFails(send("ann", "ann_bob", { text: "", img: "data:image/jpeg;base64,<script>" }));
});
test("photos can't be too big", () => assertFails(send("ann", "ann_bob", { text: "", img: "data:image/jpeg;base64," + "A".repeat(300001) })));
test("strangers can't send photos", () => assertFails(send("cat", "ann_bob", { text: "", img: JPEG })));
test("a banned person can't send messages", async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), "bans/ann"), { by: "x", reason: "spam", until: null, at: Timestamp.now() }));
  await assertFails(send("ann", "ann_bob"));
});
test("an ended ban doesn't block", async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), "bans/ann"), { by: "x", reason: "spam", until: Timestamp.fromMillis(Date.now() - 60000), at: Timestamp.now() }));
  await assertSucceeds(send("ann", "ann_bob"));
});
