// Scoreline accounts: sign in, sync ★ teams + alert settings, friends and chat (Firebase Auth + Firestore).
// Uses globals from index.html: state, store, teamNames, render, pushView, setBody, views, esc, toast, buzz, alertPrefs.

// Paste the firebaseConfig from Firebase console -> Project settings -> Your apps -> Web here.
// (This config is meant to be public; access is controlled by firestore.rules.)
const FIREBASE_CONFIG = null;

const V = "10.12.2";
let fb = null;        // loaded Firebase modules
let auth = null, db = null, user = null, profile = null;
let unsubs = [];
let friendState = { incoming: [], outgoing: [], friends: [] };
const names = {};     // uid -> username cache

async function boot() {
  if (!FIREBASE_CONFIG) return;
  const [app, a, f] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
  ]);
  fb = { ...app, ...a, ...f };
  const appInst = fb.initializeApp(FIREBASE_CONFIG);
  auth = fb.getAuth(appInst);
  db = fb.getFirestore(appInst);
  fb.onAuthStateChanged(auth, onUser);
}

/* ---------- auth ---------- */
async function onUser(u) {
  unsubs.forEach((f) => f()); unsubs = [];
  user = u; profile = null;
  friendState = { incoming: [], outgoing: [], friends: [] };
  if (u) {
    const p = await fb.getDoc(fb.doc(db, "profiles", u.uid));
    profile = p.exists() ? p.data() : null;
    if (profile) names[u.uid] = profile.username;
    await startSync();
    watchFriends();
  }
  syncButton();
  refreshAccountSheet();
}
function syncButton() {
  const b = document.getElementById("accountBtn");
  if (b) b.classList.toggle("on", !!user);
}
const cleanName = (s) => String(s || "").trim().toLowerCase();

async function signUp(email, password, username) {
  username = cleanName(username);
  if (!/^[a-z0-9_]{3,20}$/.test(username)) throw new Error("Usernames are 3–20 letters, numbers or _.");
  const taken = await fb.getDoc(fb.doc(db, "usernames", username));
  if (taken.exists()) throw new Error("That username is taken.");
  const cred = await fb.createUserWithEmailAndPassword(auth, email, password);
  try {
    await fb.setDoc(fb.doc(db, "usernames", username), { uid: cred.user.uid });
    await fb.setDoc(fb.doc(db, "profiles", cred.user.uid), { username, createdAt: fb.serverTimestamp() });
  } catch (e) {
    await cred.user.delete().catch(() => {});
    throw new Error("That username was just taken. Try another.");
  }
  profile = { username }; names[cred.user.uid] = username;
}

/* ---------- sync ★ teams and alert settings ---------- */
let pushing = false;
async function startSync() {
  const ref = fb.doc(db, "users", user.uid);
  const snap = await fb.getDoc(ref);
  const cloud = snap.exists() ? snap.data() : {};
  const favs = [...new Set([...(cloud.favs || []), ...state.favs])];
  const fnames = { ...(cloud.favNames || {}), ...teamNames };
  const prefs = { ...(cloud.alertPrefs || {}), ...store.get("alertPrefs", {}) };
  await fb.setDoc(ref, { favs, favNames: fnames, alertPrefs: prefs, updatedAt: fb.serverTimestamp() }, { merge: true });
  unsubs.push(fb.onSnapshot(ref, (d) => {
    if (pushing || !d.exists()) return;
    const x = d.data();
    state.favs = new Set(x.favs || []);
    store.set("favs", [...state.favs]);
    Object.assign(teamNames, x.favNames || {}); store.set("favNames", teamNames);
    if (x.alertPrefs) store.set("alertPrefs", x.alertPrefs);
    render();
  }));
}
async function pushSettings() {
  if (!user) return;
  pushing = true;
  try {
    await fb.setDoc(fb.doc(db, "users", user.uid), { favs: [...state.favs], favNames: teamNames, alertPrefs: store.get("alertPrefs", {}), updatedAt: fb.serverTimestamp() }, { merge: true });
  } catch {}
  setTimeout(() => { pushing = false; }, 400);
}
window.scorelineSettingsChanged = pushSettings;

/* ---------- friends ---------- */
async function nameOf(uid) {
  if (names[uid]) return names[uid];
  const p = await fb.getDoc(fb.doc(db, "profiles", uid)).catch(() => null);
  names[uid] = p?.exists() ? p.data().username : "player";
  return names[uid];
}
function watchFriends() {
  const col = fb.collection(db, "requests");
  const apply = async (key, snap) => {
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    await Promise.all(rows.map((r) => nameOf(r.from === user.uid ? r.to : r.from)));
    if (key === "in") {
      friendState.incoming = rows.filter((r) => r.status === "pending");
      friendState.inAccepted = rows.filter((r) => r.status === "accepted").map((r) => r.from);
    } else {
      friendState.outgoing = rows.filter((r) => r.status === "pending");
      friendState.outAccepted = rows.filter((r) => r.status === "accepted").map((r) => r.to);
    }
    friendState.friends = [...new Set([...(friendState.inAccepted || []), ...(friendState.outAccepted || [])])];
    const badge = document.getElementById("accountBtn");
    if (badge) badge.dataset.count = friendState.incoming.length || "";
    refreshAccountSheet();
  };
  unsubs.push(fb.onSnapshot(fb.query(col, fb.where("to", "==", user.uid)), (s) => apply("in", s)));
  unsubs.push(fb.onSnapshot(fb.query(col, fb.where("from", "==", user.uid)), (s) => apply("out", s)));
}
async function addFriend(username) {
  username = cleanName(username).replace(/^@/, "");
  const u = await fb.getDoc(fb.doc(db, "usernames", username));
  if (!u.exists()) throw new Error("No one has that username.");
  const to = u.data().uid;
  if (to === user.uid) throw new Error("That's you!");
  if (friendState.friends.includes(to)) throw new Error("You're already friends.");
  const back = friendState.incoming.find((r) => r.from === to);
  if (back) return fb.updateDoc(fb.doc(db, "requests", back.id), { status: "accepted" });
  names[to] = username;
  await fb.setDoc(fb.doc(db, "requests", user.uid + "_" + to), { from: user.uid, to, status: "pending", at: fb.serverTimestamp() });
}
const reqId = (a, b) => a + "_" + b;
async function removeFriend(uid) {
  await Promise.all([fb.deleteDoc(fb.doc(db, "requests", reqId(user.uid, uid))).catch(() => {}), fb.deleteDoc(fb.doc(db, "requests", reqId(uid, user.uid))).catch(() => {})]);
}

/* ---------- chat ---------- */
const chatId = (a, b) => [a, b].sort().join("_");
async function openChat(uid) {
  const id = chatId(user.uid, uid);
  const ref = fb.doc(db, "chats", id);
  const ex = await fb.getDoc(ref).catch(() => null);
  if (!ex?.exists()) await fb.setDoc(ref, { members: [user.uid, uid].sort(), updatedAt: fb.serverTimestamp() });
  const v = { kind: "chat" };
  pushView(v);
  const name = await nameOf(uid);
  setBody(v, "@" + name, '<div class="chat-log" data-chatlog></div><form class="chat-form" data-chatform><input maxlength="500" placeholder="Message @' + esc(name) + '" autocomplete="off"><button class="pill-btn" type="submit">Send</button></form>');
  v.el.querySelector(".src-note")?.remove();
  v.el.classList.add("chat-sheet");
  const log = v.el.querySelector("[data-chatlog]");
  const q = fb.query(fb.collection(db, "chats", id, "messages"), fb.orderBy("at", "asc"), fb.limitToLast(150));
  const stop = fb.onSnapshot(q, (s) => {
    if (!v.el.isConnected) return stop();
    log.innerHTML = s.docs.map((d) => {
      const m = d.data(), mine = m.from === user.uid;
      const when = m.at?.toDate ? m.at.toDate().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
      return '<div class="msg' + (mine ? " me" : "") + '"><p>' + esc(m.text) + "</p><small>" + esc(when) + "</small></div>";
    }).join("") || '<div class="g-note" style="text-align:center;margin-top:30px">Say hi 👋</div>';
    log.scrollTop = log.scrollHeight;
  });
  v.el.querySelector("[data-chatform]").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = e.target.querySelector("input"), text = input.value.trim();
    if (!text) return;
    input.value = "";
    buzz();
    try {
      await fb.addDoc(fb.collection(db, "chats", id, "messages"), { from: user.uid, text, at: fb.serverTimestamp() });
      fb.updateDoc(ref, { updatedAt: fb.serverTimestamp() }).catch(() => {});
    } catch { toast("Message didn't send."); input.value = text; }
  });
}

/* ---------- trust + privacy ---------- */
const TRUST = '<div class="trust"><div class="trust-h">🔒 What Scoreline stores</div><ul>' +
  "<li><b>Your username</b>: the only thing other people can see.</li>" +
  "<li><b>Your email</b>: private, only used to log in and reset your password. Never shown to anyone or sold.</li>" +
  "<li><b>Your ★ teams and alert settings</b>: so they sync to your other devices.</li>" +
  "<li><b>Chats</b>: only you and your friend can read them in the app.</li></ul>" +
  '<div class="trust-f">Passwords are encrypted by Google Firebase and nobody, including Scoreline, can see them. No ads, no tracking, and you can delete your account anytime.</div></div>';
const PRIVACY = '<div class="privacy"><p><b>Scoreline is a free, independent fan app.</b> This page explains exactly what happens to your information.</p>' +
  "<h4>What we collect</h4><ul><li>Email and password, to log you in. Passwords are stored encrypted by Google Firebase; no one can read them.</li><li>A username you choose. It's the only thing visible to other users.</li><li>Your ★ teams and alert settings.</li><li>Friend connections and chat messages you send.</li></ul>" +
  "<h4>Who can see it</h4><ul><li>Other users see only your username.</li><li>Chats are visible only to the two people in them inside the app.</li><li>The app's developer can access the database to keep it running and safe (for example, to remove abuse), like any app's admin.</li></ul>" +
  "<h4>What we never do</h4><ul><li>No ads, no selling or sharing your data, no tracking across other apps or sites.</li><li>We never ask for payment info. Fantasy, when it comes, uses points only, never real money.</li></ul>" +
  "<h4>Your controls</h4><ul><li>Remove friends anytime, and only friends can message you.</li><li>Delete your account from the Account screen. This erases your profile, settings, friends and the messages you sent.</li></ul>" +
  "<h4>Where it's stored</h4><p>Google Firebase (Authentication and Firestore), which encrypts data in transit and at rest.</p></div>";
function openPrivacy() { const v = { kind: "privacy" }; pushView(v); setBody(v, "Privacy", PRIVACY); }

async function deleteAccount() {
  const uid = user.uid, uname = profile?.username;
  // Remove messages I sent, friend links, profile, username and settings, then the login itself.
  for (const f of friendState.friends) {
    const id = chatId(uid, f);
    const mine = await fb.getDocs(fb.query(fb.collection(db, "chats", id, "messages"), fb.where("from", "==", uid))).catch(() => null);
    if (mine) await Promise.all(mine.docs.map((d) => fb.deleteDoc(d.ref).catch(() => {})));
  }
  const reqs = [...friendState.incoming.map((r) => r.id), ...friendState.outgoing.map((r) => r.id), ...friendState.friends.flatMap((f) => [reqId(uid, f), reqId(f, uid)])];
  await Promise.all(reqs.map((r) => fb.deleteDoc(fb.doc(db, "requests", r)).catch(() => {})));
  await fb.deleteDoc(fb.doc(db, "users", uid)).catch(() => {});
  await fb.deleteDoc(fb.doc(db, "profiles", uid)).catch(() => {});
  if (uname) await fb.deleteDoc(fb.doc(db, "usernames", uname)).catch(() => {});
  await user.delete();
}

/* ---------- account sheet UI ---------- */
let sheetView = null, mode = "login";
function openAccount() {
  sheetView = { kind: "account" };
  pushView(sheetView);
  refreshAccountSheet();
}
function refreshAccountSheet() {
  const v = sheetView;
  if (!v?.el?.isConnected) return;
  let h;
  if (!FIREBASE_CONFIG) h = '<div class="empty">Accounts are coming soon.</div>';
  else if (!fb) h = '<div class="skel" style="height:200px"></div>';
  else if (!user) {
    h = '<div class="seg"><button type="button" data-amode="login" class="' + (mode === "login" ? "active" : "") + '">Log in</button><button type="button" data-amode="signup" class="' + (mode === "signup" ? "active" : "") + '">Create account</button></div>' +
      '<form class="acct-form" data-acct>' + (mode === "signup" ? '<label>Username<input name="username" maxlength="20" autocomplete="username" placeholder="e.g. niners_fan"></label>' : "") +
      '<label>Email<input name="email" type="email" autocomplete="email" required></label><label>Password<input name="password" type="password" minlength="6" autocomplete="' + (mode === "signup" ? "new-password" : "current-password") + '" required></label>' +
      '<div class="acct-err" data-err></div><button class="pill-btn dl acct-go" type="submit">' + (mode === "signup" ? "Create account" : "Log in") + "</button>" +
      (mode === "login" ? '<button type="button" class="acct-link" data-forgot>Forgot password?</button>' : "") + "</form>" +
      TRUST + '<button type="button" class="acct-link" data-privacy>Read the full privacy page</button>';
  } else {
    const F = friendState;
    const person = (uid, actions) => '<div class="opt"><span><b>@' + esc(names[uid] || "…") + "</b></span><span class=\"acct-acts\">" + actions + "</span></div>";
    h = '<div class="acct-me"><div class="avatar">' + esc((profile?.username || "?")[0].toUpperCase()) + "</div><div><b>@" + esc(profile?.username || "") + "</b><small>" + esc(user.email || "") + '</small></div><button class="pill-btn" type="button" data-logout>Log out</button></div>' +
      '<div class="g-note">★ teams and alert settings are synced.</div>' +
      '<div class="g-label" style="margin-top:18px">Add a friend</div><form class="acct-add" data-addf><input placeholder="Username" maxlength="21" autocomplete="off"><button class="pill-btn" type="submit">Add</button></form><div class="acct-err" data-err></div>' +
      (F.incoming.length ? '<div class="g-label" style="margin-top:16px">Friend requests</div><div class="panel">' + F.incoming.map((r) => person(r.from, '<button class="pill-btn" type="button" data-accept="' + esc(r.id) + '">Accept</button><button class="pill-btn" type="button" data-decline="' + esc(r.id) + '">✕</button>')).join("") + "</div>" : "") +
      '<div class="g-label" style="margin-top:16px">Friends</div><div class="panel">' + (F.friends.length ? F.friends.map((uid) => person(uid, '<button class="pill-btn" type="button" data-chat="' + esc(uid) + '">Chat</button><button class="pill-btn" type="button" data-unfriend="' + esc(uid) + '" aria-label="Remove friend">✕</button>')).join("") : '<div class="g-note">No friends yet. Add someone by their username.</div>') + "</div>" +
      (F.outgoing.length ? '<div class="g-label" style="margin-top:16px">Sent</div><div class="panel">' + F.outgoing.map((r) => person(r.to, '<span class="muted">Pending</span><button class="pill-btn" type="button" data-decline="' + esc(r.id) + '">✕</button>')).join("") + "</div>" : "") +
      '<div class="acct-foot"><button type="button" class="acct-link" data-privacy>Privacy</button><button type="button" class="acct-link danger" data-delacct>Delete my account</button></div><div class="acct-err" data-err></div>';
  }
  setBody(v, user ? "Account" : "Scoreline account", h);
}
const errBox = (el, msg) => { const b = el.closest(".sheet")?.querySelector("[data-err]"); if (b) b.textContent = msg; };
const niceErr = (e) => {
  const c = e?.code || "";
  if (/invalid-credential|wrong-password|user-not-found/.test(c)) return "Wrong email or password.";
  if (/email-already-in-use/.test(c)) return "That email already has an account. Log in instead.";
  if (/weak-password/.test(c)) return "Use at least 6 characters for your password.";
  if (/invalid-email/.test(c)) return "That email doesn't look right.";
  if (/too-many-requests/.test(c)) return "Too many tries. Wait a minute and try again.";
  return e?.message || "Something went wrong.";
};

document.addEventListener("submit", async (e) => {
  const f = e.target;
  if (f.matches("[data-acct]")) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    const btn = f.querySelector(".acct-go"); btn.disabled = true; errBox(f, "");
    try {
      if (mode === "signup") await signUp(d.email.trim(), d.password, d.username);
      else await fb.signInWithEmailAndPassword(auth, d.email.trim(), d.password);
      buzz(12); toast(mode === "signup" ? "Account created" : "Logged in");
    } catch (err) { errBox(f, niceErr(err)); }
    btn.disabled = false;
  }
  if (f.matches("[data-addf]")) {
    e.preventDefault();
    const input = f.querySelector("input"); errBox(f, "");
    try { await addFriend(input.value); input.value = ""; toast("Friend request sent"); } catch (err) { errBox(f, niceErr(err)); }
  }
});
document.addEventListener("click", async (e) => {
  const t = e.target;
  if (t.closest("#accountBtn")) { e.stopPropagation(); return openAccount(); }
  const m = t.closest("[data-amode]");
  if (m) { mode = m.dataset.amode; return refreshAccountSheet(); }
  if (t.closest("[data-privacy]")) return openPrivacy();
  const del = t.closest("[data-delacct]");
  if (del) {
    if (!del.dataset.sure) {
      del.dataset.sure = "1"; del.textContent = "Tap again to permanently delete";
      setTimeout(() => { if (del.isConnected) { delete del.dataset.sure; del.textContent = "Delete my account"; } }, 4000);
      return;
    }
    del.textContent = "Deleting…";
    try { await deleteAccount(); toast("Your account was deleted"); }
    catch (err) {
      errBox(del, /requires-recent-login/.test(err?.code || "") ? "For safety, log out and log back in, then delete again." : "Couldn't delete. Try again.");
      del.textContent = "Delete my account"; delete del.dataset.sure;
    }
    return;
  }
  if (t.closest("[data-logout]")) { await fb.signOut(auth); toast("Logged out"); return; }
  if (t.closest("[data-forgot]")) {
    const email = t.closest("form")?.querySelector('[name="email"]')?.value.trim();
    if (!email) return errBox(t, "Type your email above first.");
    try { await fb.sendPasswordResetEmail(auth, email); toast("Password reset email sent"); } catch (err) { errBox(t, niceErr(err)); }
    return;
  }
  const acc = t.closest("[data-accept]");
  if (acc) { buzz(); return fb.updateDoc(fb.doc(db, "requests", acc.dataset.accept), { status: "accepted" }).catch(() => toast("Couldn't accept.")); }
  const dec = t.closest("[data-decline]");
  if (dec) return fb.deleteDoc(fb.doc(db, "requests", dec.dataset.decline)).catch(() => {});
  const un = t.closest("[data-unfriend]");
  if (un) {
    if (un.dataset.sure) return removeFriend(un.dataset.unfriend);
    un.dataset.sure = "1"; un.textContent = "Remove?"; un.classList.add("on");
    setTimeout(() => { if (un.isConnected) { delete un.dataset.sure; un.textContent = "✕"; un.classList.remove("on"); } }, 3000);
    return;
  }
  const ch = t.closest("[data-chat]");
  if (ch) return openChat(ch.dataset.chat);
}, true);

boot().catch(() => {});
