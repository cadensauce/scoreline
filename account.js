// Scoreline accounts: sign in, sync ★ teams + alert settings, friends and chat (Firebase Auth + Firestore).
// Uses globals from index.html: state, store, teamNames, render, pushView, setBody, views, esc, toast, buzz, alertPrefs.

// Paste the firebaseConfig from Firebase console -> Project settings -> Your apps -> Web here.
// (This config is meant to be public; access is controlled by firestore.rules.)
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAGyc1udyqVakTuZJ0Iqb8Lb9uy4IHdO2w",
  authDomain: "scoreline-41f14.firebaseapp.com",
  projectId: "scoreline-41f14",
  storageBucket: "scoreline-41f14.firebasestorage.app",
  messagingSenderId: "1040992391318",
  appId: "1:1040992391318:web:e81c4da4942a8e351eb2b7",
};

const V = "10.12.2";
let fb = null;        // loaded Firebase modules
let auth = null, db = null, user = null, profile = null;
let unsubs = [];
const APP_CHECK_KEY = "6LcfWyouAAAAAAuoOwM2PIf6SVBsYC0RoTbzzqz9";   // public reCAPTCHA Enterprise site key (meant to be in the page)
let appCheck = null;
// For the page's direct database calls (alert sign-ups): the App Check token to send along, or null.
window.scorelineAppCheck = async () => {
  if (location.hostname !== "cadensauce.github.io") return null;   // the key only works on the real site (not tests/previews)
  await startFirebase();
  if (!appCheck || !fb?.getAppCheckToken) return null;
  return (await fb.getAppCheckToken(appCheck, false).catch(() => null))?.token || null;
};
// Resolves once Firebase has said who is signed in (first onUser finished), so "signed in?" is never answered too early.
let authDone; const authReady = new Promise((r) => { authDone = r; });
let friendState = { incoming: [], outgoing: [], friends: [] };
const names = {};     // uid -> username cache

/* ---------- several accounts on one device (like TikTok) ----------
   Each account is its own Firebase app ("slot") with its own saved sign-in, so switching needs no password:
   remember which slot is active, clear this device's copy of the last account's teams/alerts, and reload.
   The list (username + photo only) is kept on this device; logging out removes that account from it. */
const MAX_ACCTS = 5;
const SLOT = (() => { const s = store.get("acctSlot", "main"); return /^[a-z0-9]{1,12}$/.test(s) ? s : "main"; })();
const savedAccts = () => (store.get("accounts", []) || []).filter((a) => a && /^[a-z0-9]{1,12}$/.test(a.slot) && a.username);
function rememberAcct() {
  if (!user || !profile?.username) return;
  const av = String(myCard?.avatar || ""), list = savedAccts().filter((a) => a.slot !== SLOT && a.uid !== user.uid);
  list.unshift({ slot: SLOT, uid: user.uid, username: profile.username, avatar: av.length < 70000 ? av : "", deco: myCard?.deco || "" });
  store.set("accounts", list.slice(0, MAX_ACCTS));
}
const forgetSlot = (slot) => store.set("accounts", savedAccts().filter((a) => a.slot !== slot));
function switchTo(slot) {
  store.set("acctSlot", slot);
  // This device's copy of the old account's ★ teams, alert settings and You page: the next account loads its own.
  store.set("favs", []); store.set("favNames", {}); store.set("alertPrefs", {}); store.set("youCache", {});
  location.reload();
}
function addAccount() {
  const used = new Set([SLOT, ...savedAccts().map((a) => a.slot)]);
  if (used.size > MAX_ACCTS) return toast("You can keep up to " + MAX_ACCTS + " accounts here. Log out of one first.");
  let n = 2; while (used.has("a" + n)) n++;
  switchTo("a" + n);
}
function acctListHtml() {
  const list = savedAccts();
  return '<div class="panel">' + list.map((a) => '<button type="button" class="opt soc-row acct-pick" data-acct-slot="' + esc(a.slot) + '">' +
      '<span class="soc-who">' + avatarHtml(a.avatar, a.username, "", a.deco) + "<span><b>@" + esc(a.username) + "</b>" + (a.slot === SLOT && user ? "<small>Using now</small>" : "") + "</span></span>" +
      (a.slot === SLOT && user ? '<span class="acct-check-on" aria-label="Current account">✓</span>' : '<span class="chev">›</span>') + "</button>").join("") +
    (list.length < MAX_ACCTS ? '<button type="button" class="opt soc-row acct-pick" data-acct-add><span class="soc-who"><span class="avatar acct-plus">+</span><span><b>Add account</b><small>Sign in or create another account</small></span></span></button>' : "") +
    "</div>";
}
function openSwitcher() {
  const v = { kind: "accounts", key: "accounts" };
  if (!pushView(v)) return;
  setBody(v, "Switch account", acctListHtml() + '<div class="g-note">Accounts stay signed in on this device. Switching reloads Scoreline with that account.</div>');
}

async function boot() {
  if (!FIREBASE_CONFIG) return;
  const [app, a, f] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
  ]);
  fb = { ...app, ...a, ...f };
  const appInst = SLOT === "main" ? fb.initializeApp(FIREBASE_CONFIG) : fb.initializeApp(FIREBASE_CONFIG, "acct-" + SLOT);   // each account slot keeps its own sign-in
  // App Check: proves requests come from the real Scoreline site (invisible reCAPTCHA Enterprise score, no puzzles).
  // Set up before the other services so their requests carry it. If it can't load (blocked), everything still works.
  if (location.hostname === "cadensauce.github.io") try {
    const ac = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app-check.js`);
    appCheck = ac.initializeAppCheck(appInst, { provider: new ac.ReCaptchaEnterpriseProvider(APP_CHECK_KEY), isTokenAutoRefreshEnabled: true });
    fb.getAppCheckToken = ac.getToken;
  } catch {}
  auth = fb.getAuth(appInst);
  db = fb.getFirestore(appInst);
  fb.onAuthStateChanged(auth, onUser);
}

/* ---------- auth ---------- */
async function onUser(u) {
  unsubs.forEach((f) => f()); unsubs = [];
  window.scorelineDevCheck?.(u?.email || "");   // developer tools (phone preview) for the owner's account only
  user = u; profile = null;
  friendState = { incoming: [], outgoing: [], friends: [] };
  chatState = { chats: [], invites: [] }; chatOk = null; blocked = new Set(); emitChats();
  pending2 = false; twoStepOn = false; otpUnsub?.(); otpUnsub = null;
  if (u) {
    // Two-step sign-in: with it on, this device needs the emailed code before it can use the account.
    const verifiedHere = (await u.getIdTokenResult().catch(() => null))?.claims?.ts === true;
    twoStepOn = !!(await fb.getDoc(fb.doc(db, "twoStep", u.uid)).catch(() => null))?.exists();
    if (twoStepOn && !verifiedHere) {
      pending2 = true; watchOtp(); requestCode("signin");
      syncButton(); if (!sheetView?.el?.isConnected) openAccount(); else refreshAccountSheet();
      authDone();
      return;
    }
    const p = await fb.getDoc(fb.doc(db, "profiles", u.uid));
    profile = p.exists() ? p.data() : null;
    if (profile) names[u.uid] = profile.username;
    myCard = (await fb.getDoc(fb.doc(db, "cards", u.uid)).catch(() => null))?.data() || { avatar: "", bio: "", show: "friends" };
    rememberAcct();
    await startSync();
    watchFriends();
    watchChats();
  }
  if (!u) forgetSlot(SLOT);   // this slot has no one signed in: not in the switch list
  syncButton();
  refreshAccountSheet();
  authDone();
  window.dispatchEvent(new Event("scoreline-user"));   // picks and Marks refresh on sign-in/out
}
function syncButton() {
  const b = document.getElementById("accountBtn");
  if (b) b.classList.toggle("on", !!user);
}
const cleanName = (s) => String(s || "").trim().toLowerCase();

async function signUp(email, password, username, teen) {
  username = cleanName(username);
  if (!/^[a-z0-9_]{3,20}$/.test(username)) throw new Error("Usernames are 3–20 letters, numbers or _.");
  const cred = await fb.createUserWithEmailAndPassword(auth, email, password);
  try {
    await fb.setDoc(fb.doc(db, "usernames", username), { uid: cred.user.uid });
    await fb.setDoc(fb.doc(db, "profiles", cred.user.uid), { username, createdAt: fb.serverTimestamp() });
  } catch (e) {
    await cred.user.delete().catch(() => {});
    throw new Error("That username was just taken. Try another.");
  }
  profile = { username }; names[cred.user.uid] = username;
  if (teen) agreeTerms(cred.user.uid);
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
    state.favs = new Set((window.cleanFavs || ((a) => a))(x.favs || []));
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
    window.dispatchEvent(new Event("scoreline-social"));   // the Social tab redraws with the new requests and friends
    refreshAccountSheet();
  };
  unsubs.push(fb.onSnapshot(fb.query(col, fb.where("to", "==", user.uid)), (s) => apply("in", s)));
  unsubs.push(fb.onSnapshot(fb.query(col, fb.where("from", "==", user.uid)), (s) => apply("out", s)));
}
// Returns what happened, in words for the person ("Friend request sent to @x"). The @ is optional.
async function addFriend(username) {
  username = cleanName(username).replace(/^@+\s*/, "");
  if (!username) throw new Error("Type a username first.");
  if (!/^[a-z0-9_]{3,20}$/.test(username)) throw new Error("No account called @" + username + ". Usernames are 3–20 letters, numbers or _.");
  const u = await fb.getDoc(fb.doc(db, "usernames", username));
  if (!u.exists()) throw new Error("No account called @" + username + ".");
  const to = u.data().uid;
  if (to === user.uid) throw new Error("That's you!");
  if (friendState.friends.includes(to)) throw new Error("You're already friends with @" + username + ".");
  if (friendState.outgoing.some((r) => r.to === to)) throw new Error("You already sent @" + username + " a request.");
  names[to] = username;
  const back = friendState.incoming.find((r) => r.from === to);
  if (back) { await fb.updateDoc(fb.doc(db, "requests", back.id), { status: "accepted" }); return "You're now friends with @" + username; }
  await fb.setDoc(fb.doc(db, "requests", user.uid + "_" + to), { from: user.uid, to, status: "pending", at: fb.serverTimestamp() });
  return "Friend request sent to @" + username;
}
// The last add-a-friend result stays on screen through refreshes of the list (for 8 seconds).
let addNote = { text: "", ok: false, at: 0 };
const addNoteHtml = () => (Date.now() - addNote.at < 8000 && addNote.text ? '<div class="acct-err' + (addNote.ok ? " ok" : "") + '" data-err role="status">' + esc(addNote.text) + "</div>" : '<div class="acct-err" data-err role="status"></div>');
function showAddNote(f, text, ok) {
  addNote = { text, ok, at: Date.now() };
  const b = f.closest(".sheet, [data-social], [data-social-you], [data-people]")?.querySelector("[data-err]") || f.parentElement?.querySelector("[data-err]");
  if (b) { b.textContent = text; b.classList.toggle("ok", ok); }
}
// People search: usernames starting with what you typed. Photos and names show only for friends
// (profiles are friends-only); everyone else shows their @username.
async function findPeople(q) {
  q = cleanName(q).replace(/^@+\s*/, "").replace(/[^a-z0-9_]/g, "");
  if (!q || !user) return [];
  // Similar names too (like Roblox): names starting with what you typed, plus names sharing its first few letters,
  // ranked by how close they are (exact, then starts-with, then fewest letters different).
  const pre = (p, n) => fb.getDocs(fb.query(fb.collection(db, "usernames"), fb.orderBy(fb.documentId()), fb.startAt(p), fb.endAt(p + "\uf8ff"), fb.limit(n))).then((r) => r.docs).catch(() => []);
  const short = q.slice(0, Math.min(q.length, 3));
  const docs = (await Promise.all([pre(q, 24), short !== q ? pre(short, 60) : []])).flat();
  const dist = (a, b) => { const m = Array.from({ length: b.length + 1 }, (_, j) => j); for (let i = 1; i <= a.length; i++) { let prev = m[0]; m[0] = i; for (let j = 1; j <= b.length; j++) { const t = m[j]; m[j] = Math.min(m[j] + 1, m[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; } } return m[b.length]; };
  const score = (n) => (n === q ? -1000 : n.startsWith(q) ? -500 + n.length : dist(q, n));
  const seen = new Set(), out = [];
  for (const d of docs) if (!seen.has(d.id)) { seen.add(d.id); out.push({ username: d.id, uid: d.data().uid, s: score(d.id) }); }
  out.sort((a, b) => a.s - b.s || a.username.localeCompare(b.username));
  out.splice(12);
  await Promise.all(out.map(async (p) => {
    names[p.uid] = p.username;
    p.rel = p.uid === user.uid ? "me" : friendState.friends.includes(p.uid) ? "friend" : friendState.outgoing.some((x) => x.to === p.uid) ? "sent" : friendState.incoming.some((x) => x.from === p.uid) ? "incoming" : "";
    const c = p.rel === "me" ? myCard : p.rel === "friend" ? await friendCard(p.uid) : null;
    p.avatar = c?.avatar || ""; p.name = c?.name || ""; p.deco = c?.deco || "";
  }));
  return out;
}
const reqId = (a, b) => a + "_" + b;
async function removeFriend(uid) {
  await Promise.all([fb.deleteDoc(fb.doc(db, "requests", reqId(user.uid, uid))).catch(() => {}), fb.deleteDoc(fb.doc(db, "requests", reqId(uid, user.uid))).catch(() => {})]);
}

/* ---------- chat (like Instagram / Discord) ----------
   Direct chats between friends (id "a_b") and group chats ("g_...", up to 10 people; invites are accepted or declined).
   A message is text and/or a shared game, player, team, F1 driver or Fantasy league. Before your first message you
   agree to the chat rules (chatOk/{uid}). Every chat has Block and Report; links always ask before opening. */
const chatId = (a, b) => [a, b].sort().join("_");
let chatState = { chats: [], invites: [] };
let chatOk = null;                       // agreed to the chat rules? (null = not checked yet)
let blocked = new Set();                 // people I blocked
const tms = (t) => (t?.toMillis ? t.toMillis() : 0);
const readMap = () => store.get("chatRead", {}) || {};
const okInvite = (c) => friendState.friends.includes(c.owner);   // only invites from friends show; others are ignored
const unreadOf = (c) => !!c.last && c.last.from !== user?.uid && !blocked.has(c.last.from) && tms(c.last.at) > (readMap()[c.id] || 0);
function markRead(id) { const m = readMap(); m[id] = Date.now(); store.set("chatRead", m); emitChats(); }
function emitChats() {
  const n = user ? chatState.chats.filter(unreadOf).length + chatState.invites.filter(okInvite).length : 0;
  window.dispatchEvent(new CustomEvent("scoreline-chats", { detail: { unread: n } }));
}
function watchChats() {
  const col = fb.collection(db, "chats");
  unsubs.push(fb.onSnapshot(fb.query(col, fb.where("members", "array-contains", user.uid)), (s) => {
    chatState.chats = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => tms(b.updatedAt) - tms(a.updatedAt));
    emitChats(); refreshChats();
  }, () => {}));
  unsubs.push(fb.onSnapshot(fb.query(col, fb.where("invited", "array-contains", user.uid)), (s) => {
    chatState.invites = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    emitChats(); refreshChats();
  }, () => {}));
  unsubs.push(fb.onSnapshot(fb.collection(db, "blocks", user.uid, "people"), (s) => {
    blocked = new Set(s.docs.map((d) => d.id)); emitChats(); refreshChats();
  }, () => {}));
}
const other = (c) => c.members.find((m) => m !== user.uid) || user.uid;
async function chatName(c) { return c.group ? c.name : "@" + (await nameOf(other(c))); }
async function chatPic(c) {
  if (c.group) return '<div class="avatar chat-gpic">' + esc((c.name || "G").trim()[0].toUpperCase()) + "</div>";
  const o = other(c), fc = await friendCard(o);
  return avatarHtml(fc?.avatar, names[o], "", fc?.deco);
}
const SHARE_LABEL = { game: "Game", player: "Player", team: "Team", driver: "F1 driver", fantasy: "Fantasy league" };
const SHARE_ICON = { game: "🏟️", player: "👤", team: "🛡️", driver: "🏎️", fantasy: "🏆" };
const ago = (ms) => { if (!ms) return ""; const d = new Date(ms), now = new Date(); return d.toDateString() === now.toDateString() ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" }); };

/* the chat rules: agreed once, before your first message */
async function ensureChatOk() {
  if (!user) { toast("Sign in to chat with friends."); return false; }
  if (chatOk === null) chatOk = !!(await fb.getDoc(fb.doc(db, "chatOk", user.uid)).catch(() => null))?.exists();
  if (chatOk) return true;
  return new Promise((done) => {
    const v = { kind: "chatrules", key: "chatrules" };
    if (!pushView(v)) return done(false);
    setBody(v, "Chat rules", '<div class="chat-rules"><p><b>Before you chat, please read these.</b> They keep Scoreline friendly and safe.</p><ul>' +
      "<li><b>Be kind.</b> No bullying, threats, hate or harassment.</li>" +
      "<li><b>Keep it clean.</b> No adult, violent or gross content.</li>" +
      "<li><b>Keep yourself private.</b> Never share your address, school, phone number, passwords or where you'll be.</li>" +
      "<li><b>Links and files from other people aren't checked by Scoreline</b> and aren't Scoreline's responsibility. Only open them from people you trust. Never type a password on a site you reached from a chat.</li>" +
      "<li><b>No spam or scams.</b> Don't ask for money, gift cards or accounts.</li>" +
      "<li><b>Uncomfortable? Block or report.</b> Every chat has Block and Report. Reports go to the Scoreline team.</li>" +
      "<li>Reported messages can be read by the Scoreline team to keep people safe. Breaking these rules can lose you chat or your account.</li></ul>" +
      '<div class="chat-rules-btns"><button type="button" class="pill-btn tos-go" data-chatrules-ok>I agree</button><button type="button" class="pill-btn" data-chatrules-no>Not now</button></div></div>');
    v.el.querySelector("[data-chatrules-ok]").addEventListener("click", async (e) => {
      e.target.disabled = true;
      try { await fb.setDoc(fb.doc(db, "chatOk", user.uid), { at: fb.serverTimestamp() }); chatOk = true; buzz(12); closeTop(); setTimeout(() => done(true), 550); }
      catch { e.target.disabled = false; toast("Couldn't save that. Check your connection and try again."); }
    });
    v.el.querySelector("[data-chatrules-no]").addEventListener("click", () => { closeTop(); done(false); });
  });
}

/* Chats list */
let listView = null;
function openChats() {
  if (!user) return toast("Sign in to chat with friends.");
  const v = { kind: "chats", key: "chats" };
  if (!pushView(v)) return;
  listView = v;
  setBody(v, "Chats", '<div class="chat-list-acts"><button type="button" class="pill-btn" data-newgroup>New group</button><button type="button" class="pill-btn" data-open-friends>Friends</button></div><div data-chatlist><div class="skel" style="height:70px"></div></div>');
  refreshChats();
}
async function refreshChats() {
  const box = listView?.el?.isConnected && listView.el.querySelector("[data-chatlist]");
  if (!box || !user) return;
  const inv = chatState.invites.filter(okInvite), list = chatState.chats.filter((c) => c.group || !blocked.has(other(c)));
  await Promise.all([...list.flatMap((c) => c.members), ...inv.map((c) => c.owner), ...list.map((c) => c.last?.from).filter(Boolean)].map(nameOf));
  const rows = await Promise.all(list.map(async (c) => {
    const l = c.last, who = !l ? "" : l.from === user.uid ? "You: " : c.group ? "@" + (names[l.from] || "…") + ": " : "";
    return '<button type="button" class="opt soc-row chat-row' + (unreadOf(c) ? " unread" : "") + '" data-openchat="' + esc(c.id) + '"><span class="soc-who">' + (await chatPic(c)) +
      "<span><b>" + esc(await chatName(c)) + "</b><small>" + (l ? esc(who + l.text) : c.group ? c.members.length + " people" : "Say hi 👋") + '</small></span></span><span class="chat-when">' + esc(ago(tms(l?.at || c.updatedAt))) + "</span></button>";
  }));
  if (!box.isConnected) return;
  box.innerHTML = (inv.length ? '<div class="section-title"><b>Group invites</b></div><div class="panel">' + inv.map((c) => '<div class="opt soc-row"><span class="soc-who"><div class="avatar chat-gpic">' + esc((c.name || "G")[0].toUpperCase()) + '</div><span><b>' + esc(c.name) + "</b><small>@" + esc(names[c.owner] || "…") + " invited you · " + c.members.length + (c.members.length === 1 ? " person" : " people") + '</small></span></span><span class="acct-acts"><button class="pill-btn tos-go" type="button" data-ginv-yes="' + esc(c.id) + '">Join</button><button class="pill-btn" type="button" data-ginv-no="' + esc(c.id) + '" aria-label="Decline">✕</button></span></div>').join("") + "</div>" : "") +
    '<div class="section-title"><b>Messages</b></div>' + (rows.length ? '<div class="panel">' + rows.join("") + "</div>" : '<div class="panel"><p class="muted people-hint">No chats yet. Open Friends and tap Chat, or start a group.</p></div>');
}

/* one chat */
async function openChat(uid) {   // a direct chat with a friend
  if (!(await ensureChatOk())) return;
  const id = chatId(user.uid, uid), ref = fb.doc(db, "chats", id);
  const ex = await fb.getDoc(ref).catch(() => null);
  if (!ex?.exists()) {
    try { await fb.setDoc(ref, { members: [user.uid, uid].sort(), updatedAt: fb.serverTimestamp() }); }
    catch { return toast("You can only message friends."); }
  }
  return openChatId(id, true);
}
async function openChatId(id, agreed) {
  if (!agreed && !(await ensureChatOk())) return;
  let c = chatState.chats.find((x) => x.id === id);
  if (!c) { const d = await fb.getDoc(fb.doc(db, "chats", id)).catch(() => null); c = d?.exists() ? { id, ...d.data() } : null; }
  if (!c || !c.members.includes(user.uid)) return toast("That chat isn't available.");
  const v = { kind: "chat", key: "chat|" + id };
  if (!pushView(v)) return;
  await Promise.all(c.members.map(nameOf));
  const acts = c.group
    ? '<button type="button" class="chat-act" data-gmembers="' + esc(id) + '">' + c.members.length + ' people</button><button type="button" class="chat-act" data-greport="' + esc(id) + '">Report</button><button type="button" class="chat-act" data-gleave="' + esc(id) + '">Leave</button>'
    : '<button type="button" class="chat-act" data-viewcard="' + esc(other(c)) + '">Profile</button><button type="button" class="chat-act" data-block="' + esc(other(c)) + '">Block</button><button type="button" class="chat-act" data-report="' + esc(other(c)) + '" data-report-chat="' + esc(id) + '">Report</button>';
  setBody(v, await chatName(c), '<div class="chat-acts">' + acts + '</div><div class="chat-log" data-chatlog></div>' +
    '<form class="chat-form" data-chatform><input maxlength="500" placeholder="Message…" autocomplete="off" aria-label="Message"><button class="pill-btn" type="submit">Send</button></form>');
  v.el.querySelector(".src-note")?.remove();
  v.el.classList.add("chat-sheet");
  v.chat = c; v.msgs = [];
  const log = v.el.querySelector("[data-chatlog]");
  const q = fb.query(fb.collection(db, "chats", id, "messages"), fb.orderBy("at", "asc"), fb.limitToLast(150));
  const stop = fb.onSnapshot(q, (s) => {
    if (!v.el.isConnected) return stop();
    v.msgs = s.docs.map((d) => d.data());
    const nearEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    let prev = "", day = "";
    log.innerHTML = '<div class="chat-safe">🔒 Only open links and files from people you trust. Uncomfortable? Use Block or Report above.</div>' + (v.msgs.map((m) => {
      if (blocked.has(m.from)) return "";
      const mine = m.from === user.uid, at = tms(m.at) || Date.now(), dk = new Date(at).toDateString();
      const sep = dk !== day ? '<div class="chat-day">' + esc(new Date(at).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })) + "</div>" : "";
      day = dk;
      const who = c.group && !mine && m.from !== prev ? '<div class="msg-who">@' + esc(names[m.from] || "…") + "</div>" : "";
      prev = m.from;
      return sep + who + '<div class="msg' + (mine ? " me" : "") + '">' + (m.share ? shareCard(m.share) : "") + (m.text ? "<p>" + linkify(m.text) + "</p>" : "") +
        "<small>" + esc(new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })) + "</small></div>";
    }).join("") || '<div class="g-note" style="text-align:center;margin-top:30px">Say hi 👋</div>');
    if (nearEnd || !v.seen) log.scrollTop = log.scrollHeight;
    v.seen = true; markRead(id);
  }, () => { log.innerHTML = '<div class="g-note">Couldn\'t load this chat.</div>'; });
  v.el.querySelector("[data-chatform]").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = e.target.querySelector("input"), text = input.value.trim();
    if (!text) return;
    input.value = ""; buzz();
    try { await sendMsg(c, { text }); } catch { toast("Message didn't send. You can only message friends who haven't blocked you."); input.value = text; }
  });
}
async function sendMsg(c, { text = "", share = null }) {
  await fb.addDoc(fb.collection(db, "chats", c.id, "messages"), { from: user.uid, text, at: fb.serverTimestamp(), ...(share ? { share } : {}) });
  const preview = share ? "Shared a " + SHARE_LABEL[share.k].toLowerCase() + ": " + share.t : text;
  fb.updateDoc(fb.doc(db, "chats", c.id), { updatedAt: fb.serverTimestamp(), last: { from: user.uid, text: preview.slice(0, 120), at: fb.serverTimestamp() } }).catch(() => {});
}
// Links become buttons that ask before leaving Scoreline. Only http(s) links.
function linkify(text) {
  return String(text).split(/((?:https?:\/\/|www\.)[^\s<>"]+)/i).map((part, i) => {
    if (i % 2 === 0) return esc(part);
    const url = /^www\./i.test(part) ? "https://" + part : part;
    return '<button type="button" class="chat-link" data-chatlink="' + esc(url) + '">' + esc(part) + "</button>";
  }).join("");
}
function shareCard(s) {
  return '<button type="button" class="chat-share" data-shareopen="' + esc(JSON.stringify({ k: s.k, lg: s.lg || "", id: s.id })) + '"><span class="cs-ic" aria-hidden="true">' + (SHARE_ICON[s.k] || "•") + "</span><span><b>" + esc(s.t || SHARE_LABEL[s.k]) + "</b><small>" + esc(SHARE_LABEL[s.k] || "") + (s.s ? " · " + esc(s.s) : "") + "</small></span></button>";
}
function openLinkAsk(url) {
  let host = ""; try { host = new URL(url).hostname; } catch { return toast("That link doesn't look right."); }
  const v = { kind: "leave", key: "leave" };
  if (!pushView(v)) return;
  setBody(v, "Leaving Scoreline", '<div class="chat-rules"><p>This link goes to <b>' + esc(host) + "</b>, outside Scoreline.</p><p class=\"muted\">Scoreline doesn't check links people send, and isn't responsible for them. Only open it if you trust the person who sent it, and never type your password on a site you reached from a chat.</p>" +
    '<div class="chat-rules-btns"><button type="button" class="pill-btn tos-go" data-link-go>Open link</button><button type="button" class="pill-btn" data-link-no>Cancel</button></div></div>');
  v.el.querySelector("[data-link-go]").addEventListener("click", () => { window.open(url, "_blank", "noopener,noreferrer"); closeTop(); });
  v.el.querySelector("[data-link-no]").addEventListener("click", () => closeTop());
}

/* groups */
const randId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[b % 62]).join("");
async function friendPicker(skip) {
  const list = friendState.friends.filter((f) => !skip.includes(f) && !blocked.has(f));
  await Promise.all(list.map(nameOf));
  return list.length ? '<div class="panel">' + list.sort((a, b) => names[a].localeCompare(names[b])).map((f) => '<label class="opt acct-check chat-pick"><input type="checkbox" data-gpick="' + esc(f) + '"> @' + esc(names[f]) + "</label>").join("") + "</div>" : '<div class="panel"><p class="muted people-hint">No more friends to add. Add friends first.</p></div>';
}
async function openNewGroup() {
  if (!(await ensureChatOk())) return;
  const v = { kind: "newgroup", key: "newgroup" };
  if (!pushView(v)) return;
  setBody(v, "New group", '<form data-gform><input class="acct-input" data-gname maxlength="40" placeholder="Group name" required aria-label="Group name">' +
    '<div class="section-title"><b>Invite friends</b><span class="muted">up to 9</span></div>' + (await friendPicker([])) +
    '<div class="acct-err" data-err role="status"></div><button type="submit" class="pill-btn tos-go">Create group</button><p class="g-note">Friends you invite choose whether to join.</p></form>');
  v.el.querySelector("[data-gform]").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = v.el.querySelector("[data-gname]").value.trim(), invited = [...v.el.querySelectorAll("[data-gpick]:checked")].map((x) => x.dataset.gpick), err = v.el.querySelector("[data-err]");
    if (!name) return (err.textContent = "Give the group a name.");
    if (!invited.length) return (err.textContent = "Pick at least one friend.");
    if (invited.length > 9) return (err.textContent = "Groups are up to 10 people, so pick 9 friends at most.");
    const id = "g_" + randId();
    try { await fb.setDoc(fb.doc(db, "chats", id), { group: true, name, owner: user.uid, members: [user.uid], invited, updatedAt: fb.serverTimestamp() }); }
    catch { return (err.textContent = "Couldn't make the group. Try again."); }
    buzz(12); toast("Group made. Invites sent."); closeTop(); setTimeout(() => openChatId(id, true), 550);
  });
}
async function openMembers(id) {
  const c = chatState.chats.find((x) => x.id === id); if (!c) return;
  const v = { kind: "gmembers", key: "gmembers" };
  if (!pushView(v)) return;
  const own = c.owner === user.uid, inv = c.invited || [];
  await Promise.all([...c.members, ...inv].map(nameOf));
  const row = (u, sub, act) => '<div class="opt soc-row"><span class="soc-who" data-viewcard="' + esc(u) + '" role="button" tabindex="0">' + avatarHtml("", names[u]) + "<span><b>@" + esc(names[u]) + "</b><small>" + sub + '</small></span></span><span class="acct-acts">' + act + "</span></div>";
  setBody(v, c.name, (own ? '<form class="acct-add" data-grename><input maxlength="40" value="' + esc(c.name) + '" aria-label="Group name"><button class="pill-btn" type="submit">Rename</button></form>' : "") +
    '<div class="section-title"><b>Members</b><span class="muted">' + c.members.length + "</span></div><div class=\"panel\">" +
    c.members.map((u) => row(u, u === c.owner ? "Owner" : u === user.uid ? "You" : "Member", own && u !== user.uid ? '<button class="pill-btn" type="button" data-gremove="' + esc(u) + '">Remove</button>' : "")).join("") +
    inv.map((u) => row(u, "Invited", "")).join("") + "</div>" +
    (own && c.members.length + inv.length < 10 ? '<div class="section-title"><b>Invite more</b></div>' + (await friendPicker([...c.members, ...inv])) + '<button type="button" class="pill-btn tos-go" data-ginvite>Send invites</button>' : ""));
  const ref = fb.doc(db, "chats", id);
  v.el.querySelector("[data-grename]")?.addEventListener("submit", async (e) => { e.preventDefault(); const n = e.target.querySelector("input").value.trim(); if (!n) return; try { await fb.updateDoc(ref, { name: n.slice(0, 40), updatedAt: fb.serverTimestamp() }); toast("Renamed"); } catch { toast("Couldn't rename."); } });
  v.el.querySelector("[data-ginvite]")?.addEventListener("click", async () => {
    const add = [...v.el.querySelectorAll("[data-gpick]:checked")].map((x) => x.dataset.gpick);
    if (!add.length) return toast("Pick a friend to invite.");
    if (c.members.length + inv.length + add.length > 10) return toast("Groups are up to 10 people.");
    try { await fb.updateDoc(ref, { invited: [...inv, ...add], updatedAt: fb.serverTimestamp() }); toast("Invites sent"); closeTop(); } catch { toast("Couldn't send invites."); }
  });
  v.el.querySelectorAll("[data-gremove]").forEach((b) => b.addEventListener("click", async () => {
    try { await fb.updateDoc(ref, { members: c.members.filter((m) => m !== b.dataset.gremove), updatedAt: fb.serverTimestamp() }); toast("Removed"); closeTop(); } catch { toast("Couldn't remove them."); }
  }));
}

/* block + report */
function confirmSheet(title, html, yes, onYes) {
  const v = { kind: "confirm", key: "confirm" };
  if (!pushView(v)) return;
  setBody(v, title, '<div class="chat-rules">' + html + '<div class="chat-rules-btns"><button type="button" class="pill-btn tos-go" data-yes>' + esc(yes) + '</button><button type="button" class="pill-btn" data-no>Cancel</button></div></div>');
  v.el.querySelector("[data-yes]").addEventListener("click", async (e) => { e.target.disabled = true; await onYes(); });
  v.el.querySelector("[data-no]").addEventListener("click", () => closeTop());
}
async function blockUser(uid) {
  const n = await nameOf(uid);
  confirmSheet("Block @" + n, "<p>@" + esc(n) + " won't be able to message you, you'll stop being friends, and you won't see their messages in groups.</p><p class=\"muted\">They aren't told. You can unblock them in Friends.</p>", "Block", async () => {
    try { await fb.setDoc(fb.doc(db, "blocks", user.uid, "people", uid), { at: fb.serverTimestamp() }); await removeFriend(uid); buzz(12); toast("Blocked @" + n); closeSheets(); }
    catch { toast("Couldn't block. Try again."); }
  });
}
const REASONS = [["bullying", "Bullying or harassment"], ["inappropriate", "Inappropriate or adult content"], ["spam", "Spam or a scam"], ["danger", "Someone may be in danger"], ["other", "Something else"]];
async function reportUser(uid, chat) {
  const n = await nameOf(uid);
  const v = { kind: "report", key: "report" };
  if (!pushView(v)) return;
  setBody(v, "Report @" + n, '<p class="muted" style="margin:0 2px 10px">What\'s wrong? Your report goes to the Scoreline team with their latest message in this chat. They aren\'t told who reported them.</p><div class="panel">' +
    REASONS.map(([k, t]) => '<button type="button" class="opt" data-reason="' + k + '"><span><b>' + t + '</b></span><span class="chev">›</span></button>').join("") + '</div><p class="g-note">If someone is in danger right now, tell a trusted adult or call your local emergency number.</p>');
  v.el.querySelectorAll("[data-reason]").forEach((b) => b.addEventListener("click", async () => {
    const msgs = views.find((x) => x.chat?.id === chat)?.msgs || [], lastFrom = [...msgs].reverse().find((m) => m.from === uid);
    try {
      await fb.addDoc(fb.collection(db, "reports"), { from: user.uid, about: uid, reason: b.dataset.reason, at: fb.serverTimestamp(), ...(chat ? { chat } : {}), ...(lastFrom ? { text: String(lastFrom.text || lastFrom.share?.t || "").slice(0, 500) } : {}) });
      buzz(12); toast("Report sent. Thank you."); closeTop();
      setTimeout(() => { if (!blocked.has(uid)) blockUser(uid); }, 550);   // offer to block straight after
    } catch { toast("Couldn't send the report. Try again."); }
  }));
}
async function reportInGroup(id) {
  const c = chatState.chats.find((x) => x.id === id); if (!c) return;
  const v = { kind: "reportpick", key: "reportpick" };
  if (!pushView(v)) return;
  const others = c.members.filter((m) => m !== user.uid);
  await Promise.all(others.map(nameOf));
  setBody(v, "Report someone", '<div class="panel">' + others.map((u) => '<button type="button" class="opt" data-rpick="' + esc(u) + '"><span><b>@' + esc(names[u]) + '</b></span><span class="chev">›</span></button>').join("") + "</div>");
  v.el.querySelectorAll("[data-rpick]").forEach((b) => b.addEventListener("click", () => { closeTop(); setTimeout(() => reportUser(b.dataset.rpick, id), 550); }));
}

/* share into a chat */
async function shareTo(s) {
  if (!user) return toast("Sign in to share with friends.");
  if (!(await ensureChatOk())) return;
  const v = { kind: "shareto", key: "shareto" };
  if (!pushView(v)) return;
  const chats = chatState.chats.filter((c) => c.group || !blocked.has(other(c))), withChat = new Set(chats.filter((c) => !c.group).map(other));
  const fr = friendState.friends.filter((f) => !withChat.has(f) && !blocked.has(f));
  await Promise.all([...chats.flatMap((c) => c.members), ...fr].map(nameOf));
  const rows = await Promise.all(chats.slice(0, 20).map(async (c) => '<button type="button" class="opt soc-row" data-sendshare="' + esc(c.id) + '"><span class="soc-who">' + (await chatPic(c)) + "<span><b>" + esc(await chatName(c)) + '</b></span></span><span class="pill-btn">Send</span></button>'));
  setBody(v, "Share", '<div class="chat-share-prev">' + shareCard(s) + "</div>" +
    (rows.length + fr.length ? '<div class="panel">' + rows.join("") + fr.map((f) => '<button type="button" class="opt soc-row" data-sendshare-to="' + esc(f) + '"><span class="soc-who">' + avatarHtml("", names[f]) + "<span><b>@" + esc(names[f]) + '</b></span></span><span class="pill-btn">Send</span></button>').join("") + "</div>"
      : '<div class="panel"><p class="muted people-hint">Add friends to share with them.</p></div>'));
  const send = async (b, cid) => {
    b.disabled = true;
    try {
      let c = chatState.chats.find((x) => x.id === cid);
      if (!c) { const d = await fb.getDoc(fb.doc(db, "chats", cid)); c = { id: cid, ...d.data() }; }
      await sendMsg(c, { share: s }); buzz(12);
      b.querySelector(".pill-btn").textContent = "Sent"; toast("Sent to " + (await chatName(c)));
    } catch { b.disabled = false; toast("Couldn't send it. Try again."); }
  };
  v.el.querySelectorAll("[data-sendshare]").forEach((b) => b.addEventListener("click", () => send(b, b.dataset.sendshare)));
  v.el.querySelectorAll("[data-sendshare-to]").forEach((b) => b.addEventListener("click", async () => {
    const f = b.dataset.sendshareTo, id = chatId(user.uid, f), ref = fb.doc(db, "chats", id);
    if (!(await fb.getDoc(ref).catch(() => null))?.exists()) { try { await fb.setDoc(ref, { members: [user.uid, f].sort(), updatedAt: fb.serverTimestamp() }); } catch { return toast("You can only message friends."); } }
    send(b, id);
  }));
}

/* Friends page: everyone you're friends with, requests, and who you blocked */
let friendsView = null;
function openFriends() {
  if (!user) return toast("Sign in to see your friends.");
  const v = { kind: "friends", key: "friends" };
  if (!pushView(v)) return;
  friendsView = v;
  setBody(v, "Friends", '<div data-friendsbox><div class="skel" style="height:120px"></div></div>');
  drawFriends();
}
async function drawFriends() {
  const box = friendsView?.el?.isConnected && friendsView.el.querySelector("[data-friendsbox]");
  if (!box || !user) return;
  const F = friendState, bl = [...blocked];
  await Promise.all([...F.friends, ...F.incoming.map((r) => r.from), ...F.outgoing.map((r) => r.to), ...bl].map(nameOf));
  await Promise.all(F.friends.map(friendCard));
  const card = (uid) => { const fc = cardCache[uid]?.c; return '<div class="pc-card"><div class="pc-top" data-viewcard="' + esc(uid) + '" role="button" tabindex="0">' + avatarHtml(fc?.avatar, names[uid], "", fc?.deco) +
    '<div class="pc-txt"><b>' + esc(fc?.name || names[uid]) + "</b><small>@" + esc(names[uid]) + '</small><small class="pc-st">You are friends</small></div></div><button class="pc-btn go" type="button" data-chat="' + esc(uid) + '">Chat</button></div>'; };
  if (!box.isConnected) return;
  box.innerHTML = '<button type="button" class="pc-search pc-find" data-open-people><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span>Find people</span></button>' +
    (F.incoming.length ? '<div class="section-title"><b>Friend requests</b><span class="muted">' + F.incoming.length + '</span></div><div class="panel">' + F.incoming.map((r) => '<div class="opt soc-row"><span class="soc-who" data-viewcard="' + esc(r.from) + '" role="button" tabindex="0">' + avatarHtml("", names[r.from]) + "<span><b>@" + esc(names[r.from]) + '</b><small>Wants to be friends</small></span></span><span class="acct-acts"><button class="pill-btn tos-go" type="button" data-accept="' + esc(r.id) + '">Accept</button><button class="pill-btn" type="button" data-decline="' + esc(r.id) + '" aria-label="Decline">✕</button></span></div>').join("") + "</div>" : "") +
    '<div class="section-title"><b>Your friends</b><span class="muted">' + F.friends.length + "</span></div>" +
    (F.friends.length ? '<div data-people-res><div class="pc-grid">' + F.friends.slice().sort((a, b) => (names[a] || "").localeCompare(names[b] || "")).map(card).join("") + "</div></div>" : '<div class="panel"><p class="muted people-hint">No friends yet. Tap Find people to add someone.</p></div>') +
    (F.outgoing.length ? '<div class="section-title"><b>Sent requests</b></div><div class="panel">' + F.outgoing.map((r) => '<div class="opt soc-row"><span class="soc-who">' + avatarHtml("", names[r.to]) + "<span><b>@" + esc(names[r.to]) + '</b><small>Waiting for them to accept</small></span></span><button class="pill-btn" type="button" data-decline="' + esc(r.id) + '" aria-label="Cancel request">✕</button></div>').join("") + "</div>" : "") +
    (bl.length ? '<div class="section-title"><b>Blocked</b></div><div class="panel">' + bl.map((u) => '<div class="opt soc-row"><span class="soc-who">' + avatarHtml("", names[u]) + "<span><b>@" + esc(names[u]) + '</b></span></span><button class="pill-btn" type="button" data-unblock="' + esc(u) + '">Unblock</button></div>').join("") + "</div>" : "");
}
window.addEventListener("scoreline-social", () => drawFriends().catch(() => {}));

window.scorelineChat = {
  openList: openChats, openFriends, share: shareTo, open: openChatId,
  unread: () => (user ? chatState.chats.filter(unreadOf).length + chatState.invites.filter(okInvite).length : 0),
};
document.addEventListener("click", async (e) => {
  const t = e.target;
  const oc = t.closest("[data-openchat]"); if (oc) return openChatId(oc.dataset.openchat);
  if (t.closest("[data-newgroup]")) return openNewGroup();
  if (t.closest("[data-open-friends]")) return openFriends();
  if (t.closest("[data-open-people]")) return document.getElementById("peopleBtn")?.click();
  const gy = t.closest("[data-ginv-yes]");
  if (gy) { gy.disabled = true; const c = chatState.invites.find((x) => x.id === gy.dataset.ginvYes); if (!c) return; try { await fb.updateDoc(fb.doc(db, "chats", c.id), { invited: fb.arrayRemove(user.uid), members: fb.arrayUnion(user.uid), updatedAt: fb.serverTimestamp() }); buzz(12); toast("Joined " + c.name); } catch { gy.disabled = false; toast(c.members.length >= 10 ? "That group is full." : "Couldn't join. Try again."); } return; }
  const gn = t.closest("[data-ginv-no]");
  if (gn) { gn.disabled = true; return fb.updateDoc(fb.doc(db, "chats", gn.dataset.ginvNo), { invited: fb.arrayRemove(user.uid), updatedAt: fb.serverTimestamp() }).catch(() => { gn.disabled = false; }); }
  const gm = t.closest("[data-gmembers]"); if (gm) return openMembers(gm.dataset.gmembers);
  const gr = t.closest("[data-greport]"); if (gr) return reportInGroup(gr.dataset.greport);
  const gl = t.closest("[data-gleave]");
  if (gl) { const c = chatState.chats.find((x) => x.id === gl.dataset.gleave); if (!c) return; return confirmSheet("Leave " + c.name, "<p>You'll stop getting messages from this group. Someone would have to invite you again to rejoin.</p>", "Leave group", async () => { try { await fb.updateDoc(fb.doc(db, "chats", c.id), { members: fb.arrayRemove(user.uid), updatedAt: fb.serverTimestamp() }); toast("You left " + c.name); closeSheets(); } catch { toast("Couldn't leave. Try again."); } }); }
  const bk = t.closest("[data-block]"); if (bk) return blockUser(bk.dataset.block);
  const rp = t.closest("[data-report]"); if (rp) return reportUser(rp.dataset.report, rp.dataset.reportChat || "");
  const ub = t.closest("[data-unblock]"); if (ub) { ub.disabled = true; return fb.deleteDoc(fb.doc(db, "blocks", user.uid, "people", ub.dataset.unblock)).then(() => toast("Unblocked")).catch(() => { ub.disabled = false; }); }
  const lk = t.closest("[data-chatlink]"); if (lk) return openLinkAsk(lk.dataset.chatlink);
  const so = t.closest("[data-shareopen]"); if (so) { let s; try { s = JSON.parse(so.dataset.shareopen); } catch { return; } return window.scorelineOpenShared?.(s); }
});

/* ---------- trust + privacy ---------- */
// Anyone can make an account (agreeing to the Terms). Ticking "13 or older" also turns on the 13+ features (Marks). Saved once.
const TOS_CHECK = '<label class="acct-check"><input type="checkbox" name="tos" required> I agree to the <button type="button" class="link-btn" data-terms>Terms of Service</button></label>' +
  '<label class="acct-check"><input type="checkbox" name="teen" data-teen> I am 13 or older <small class="muted">(needed for Marks)</small></label>';
const agreeTerms = (uid) => fb.setDoc(fb.doc(db, "ages", uid), { is13plus: true, at: fb.serverTimestamp() }).catch(() => {});   // already answered: kept as it was
const TRUST = '<div class="trust"><div class="trust-h">🔒 What Scoreline stores</div><ul>' +
  "<li><b>Your username</b>: anyone signed in can see it, so friends can find you. Pick one that doesn't include your real name.</li>" +
  "<li><b>Your profile card</b> (photo, bio, teams you follow): only your friends see it, and only if you choose to share it.</li>" +
  "<li><b>Your email</b>: private, only used to log in and reset your password. Never shown to anyone or sold.</li>" +
  "<li><b>Your ★ teams and alert settings</b>: so they sync to your other devices.</li>" +
  "<li><b>Chats</b>: only you and your friend can read them in the app.</li>" +
  "<li><b>Picks and Marks</b>: private to you.</li></ul>" +
  '<div class="trust-f">Passwords are encrypted by Google Firebase and nobody, including Scoreline, can see them. No ads, no tracking, and you can delete your account anytime.</div></div>';
const PRIVACY = '<div class="privacy"><p><b>Scoreline is a free, independent fan app.</b> This page explains exactly what happens to your information.</p>' +
  "<h4>What we collect</h4><ul><li>Email and password, to log you in. Passwords are stored encrypted by Google Firebase; no one can read them.</li><li>A username you choose. It's the only thing visible to other users.</li><li>Your ★ teams and alert settings.</li><li>Friend connections and chat messages you send.</li></ul>" +
  "<h4>Who can see it</h4><ul><li>Other users see only your username.</li><li>Chats are visible only to the two people in them inside the app.</li><li>The app's developer can access the database to keep it running and safe (for example, to remove abuse), like any app's admin.</li></ul>" +
  "<h4>What we never do</h4><ul><li>No ads, no selling or sharing your data, no tracking across other apps or sites.</li><li>We never ask for payment info. Fantasy, when it comes, uses points only, never real money.</li></ul>" +
  "<h4>Your controls</h4><ul><li>Remove friends anytime, and only friends can message you.</li><li>Delete your account from the Account screen. This erases your profile, settings, friends and the messages you sent.</li></ul>" +
  "<h4>Where it's stored</h4><p>Google Firebase (Authentication and Firestore), which encrypts data in transit and at rest.</p></div>";
function openPrivacy() { const v = { kind: "privacy", key: "privacy" }; if (!pushView(v)) return; setBody(v, "Privacy", PRIVACY); }

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
  await fb.deleteDoc(fb.doc(db, "cards", uid)).catch(() => {});
  if (uname) await fb.deleteDoc(fb.doc(db, "usernames", uname)).catch(() => {});
  await user.delete();
}

/* ---------- account sheet UI ---------- */
let sheetView = null, mode = "login";
function openAccount() {
  startFirebase();
  const sv = { kind: "account", key: "account" }; if (!pushView(sv)) return; sheetView = sv;
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
      (mode === "signup" ? TOS_CHECK + '<p class="g-note">By clicking Create account you agree to the TOS and understand the consequences.</p>' : "") +
      '<div class="acct-err" data-err></div><button class="pill-btn dl acct-go" type="submit">' + (mode === "signup" ? "Create account" : "Log in") + "</button>" +
      (mode === "login" ? '<button type="button" class="acct-link" data-forgot>Forgot password?</button>' : "") + "</form>" +
      (mode === "login" ? '<button type="button" class="acct-link" data-usecode>Have a sign-in code from the website?</button>' : "") +
      (window.__TAURI__ ? "" : '<div class="or"><span>or</span></div><button type="button" class="pill-btn g-btn" data-google><svg viewBox="0 0 24 24" width="18" height="18"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.7V6.6h-4a12 12 0 0 0 0 10.9z"/><path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.5 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"/></svg>Continue with Google</button>') +
      (window.__TAURI__ ? "" : '<p class="g-note">Continuing with Google means you agree to the <button type="button" class="link-btn" data-terms>Terms of Service</button>.</p>') +
      TRUST + '<button type="button" class="acct-link" data-privacy>Read the full privacy page</button>';
  } else if (pending2) {
    h = otpForm("Check your email", "Two-step sign-in is on. We sent a 6-digit code to " + esc(maskEmail(user.email)) + ". It works for 10 minutes.") +
      '<div class="acct-foot"><button type="button" class="acct-link" data-otpresend>Send a new code</button><button type="button" class="acct-link" data-logout>Log out</button></div>';  } else if (!profile) {
    h = '<div class="g-label">Pick a username</div><p class="g-note">This is the only thing other people will see. 3–20 letters, numbers or _.</p>' +
      '<form class="acct-add acct-unf" data-uname><input maxlength="20" placeholder="e.g. niners_fan" autocomplete="off"><button class="pill-btn" type="submit">Save</button>' + TOS_CHECK + '</form><div class="acct-err" data-err></div>' +
      '<div class="acct-foot"><button type="button" class="acct-link" data-acct-switch>Switch account</button><button type="button" class="acct-link" data-logout>Log out</button></div>';
  } else {
    const F = friendState;
    const person = (uid, actions) => '<div class="opt"><span><b>@' + esc(names[uid] || "…") + "</b></span><span class=\"acct-acts\">" + actions + "</span></div>";
    h = '<div class="acct-me' + bnCls(myCard?.banner) + '">' + avatarHtml(myCard?.avatar, profile?.username) + "<div><b>@" + esc(profile?.username || "") + "</b>" + titleTag(myCard?.title) + "<small data-email>" + emailLine() + '</small></div><button class="pill-btn" type="button" data-logout>Log out</button></div>' +
      '<div class="g-note">★ teams and alert settings are synced.</div>' +
      '<div class="g-label" style="margin-top:18px">Your profile</div><div class="opt"><span><b>Photo, bio, theme and favourites</b><small>' + ((myCard?.show || "friends") === "me" ? "Only you can see it" : "Your friends can see it") + '</small></span><span class="acct-acts"><button class="pill-btn" type="button" data-viewcard="' + esc(user.uid) + '">View</button><button class="pill-btn" type="button" data-editprofile>Edit</button></span></div>' +
      '<div class="g-label" style="margin-top:18px">Two-step sign-in</div><div data-2box><div class="opt"><span><b>' + (twoStepOn ? "On" : "Off") + '</b><small>' + (twoStepOn ? "New devices need a code we email you" : "Ask for an emailed code when you sign in on a new device") + '</small></span>' +
      (twoStepOn ? '<button class="pill-btn" type="button" data-2off>Turn off</button>' : '<button class="pill-btn" type="button" data-2on>Turn on</button>') + "</div></div>" +      (window.__TAURI__ ? "" : '<div class="signin-send"><button type="button" class="pill-btn" data-sendsignin>Send sign-in to the app</button><div data-signincode></div></div>') +
      '<div class="g-label" style="margin-top:18px">Add a friend</div><form class="acct-add" data-addf><input placeholder="Username (the @ is optional)" maxlength="21" autocomplete="off"><button class="pill-btn" type="submit">Add</button></form>' + addNoteHtml() +
      (F.incoming.length ? '<div class="g-label" style="margin-top:16px">Friend requests</div><div class="panel">' + F.incoming.map((r) => person(r.from, '<button class="pill-btn" type="button" data-accept="' + esc(r.id) + '">Accept</button><button class="pill-btn" type="button" data-decline="' + esc(r.id) + '">✕</button>')).join("") + "</div>" : "") +
      '<div class="g-label" style="margin-top:16px">Friends</div><div class="panel">' + (F.friends.length ? F.friends.map((uid) => person(uid, '<button class="pill-btn" type="button" data-viewcard="' + esc(uid) + '">Profile</button><button class="pill-btn" type="button" data-chat="' + esc(uid) + '">Chat</button><button class="pill-btn" type="button" data-unfriend="' + esc(uid) + '" aria-label="Remove friend">✕</button>')).join("") : '<div class="g-note">No friends yet. Add someone by their username.</div>') + "</div>" +
      (F.outgoing.length ? '<div class="g-label" style="margin-top:16px">Sent</div><div class="panel">' + F.outgoing.map((r) => person(r.to, '<span class="muted">Pending</span><button class="pill-btn" type="button" data-decline="' + esc(r.id) + '">✕</button>')).join("") + "</div>" : "") +
      '<div class="acct-foot"><button type="button" class="acct-link" data-privacy>Privacy</button><button type="button" class="acct-link danger" data-delacct>Delete my account</button></div><div class="acct-err" data-err></div>';
  }
  setBody(v, user ? "Account" : "Scoreline account", h);
}
const errBox = (el, msg) => { const b = el.closest(".sheet, [data-social]")?.querySelector("[data-err]"); if (b) b.textContent = msg; };
const roleCache = {};   // roles/{uid}: the Owner badge, set only by the worker
async function realRoleOf(uid) {
  if (uid in roleCache) return roleCache[uid];
  const r = await fb.getDoc(fb.doc(db, "roles", uid)).then((d) => d.data()?.role || "").catch(() => "");
  return (roleCache[uid] = /^[a-z]{1,20}$/.test(r) ? r : "");
}
// "View site as" (Owner only, like Discord's View Server As Role): your own role shows as the one you picked,
// so the page shows what that role sees. It only changes what you see; the rules still use your real role.
const VIEW_AS = ["user", "tester", "mod", "dev"];
const viewingAs = () => { const v = store.get("viewAs", ""); return VIEW_AS.includes(v) ? v : ""; };
async function roleOf(uid) {
  const r = await realRoleOf(uid);
  if (user && uid === user.uid && r === "owner" && viewingAs()) return viewingAs() === "user" ? "" : viewingAs();
  return r;
}
const cardCache = {};   // friends' profiles for the Social list, kept for 5 minutes
async function friendCard(uid) {
  if (cardCache[uid] && Date.now() - cardCache[uid].at < 300000) return cardCache[uid].c;
  const c = await fb.getDoc(fb.doc(db, "cards", uid)).then((d) => (d.exists() ? d.data() : null)).catch(() => null);
  cardCache[uid] = { c, at: Date.now() }; return c;
}
/* ---------- Social tab: the same friends, requests and chats as the account sheet, in their own tab.
   Uses the existing friend requests (requests/{from_to}) and chats; nothing new is stored. */
window.scorelineSocial = {
  // People search (top bar). find: who matches; add: friend request by username (returns the words to show).
  signedIn: () => !!user,
  async find(q) { await startFirebase(); if (FIREBASE_CONFIG && fb) await Promise.race([authReady, new Promise((r) => setTimeout(r, 8000))]); return findPeople(q); },
  add: (name) => addFriend(name),
  avatar: (src, name, deco) => avatarHtml(src, name, "", deco),
  async html() {
    await startFirebase();
    if (FIREBASE_CONFIG && fb) await Promise.race([authReady, new Promise((r) => setTimeout(r, 8000))]);
    if (!user || pending2) return '<div class="panel"><b>Friends and messages</b><p class="muted">Sign in to add friends, see requests and message your friends.</p><button type="button" class="pill-btn tos-go" data-social-signin>Sign in</button></div>' + (user && pending2 || !savedAccts().length ? "" : '<div class="section-title"><b>Your accounts</b></div>' + acctListHtml());
    const F = friendState;
    await Promise.all([...F.friends, ...F.incoming.map((r) => r.from), ...F.outgoing.map((r) => r.to)].map(nameOf));
    await Promise.all([...F.friends.map(friendCard), ...F.friends.map(roleOf), roleOf(user.uid)]);
    const me = cardWithPlain(myCard || {}), un = profile?.username || "";
    const person = (uid, sub, actions) => { const fc = cardCache[uid]?.c; return '<div class="opt soc-row"><span class="soc-who" data-viewcard="' + esc(uid) + '" role="button" tabindex="0">' + avatarHtml(fc?.avatar, names[uid], "", fc?.deco) + "<span><b>" + esc(fc?.name || "@" + (names[uid] || "…")) + roleTag(roleCache[uid]) + "</b><small>" + (fc?.name ? "@" + esc(names[uid] || "") + (sub ? " · " : "") : "") + (sub || "") + '</small></span></span><span class="acct-acts">' + actions + "</span></div>"; };
    return '<div class="soc-me bn-theme t-' + esc(me.theme || "plain") + bnCls(me.banner) + '"><span class="soc-who" data-viewcard="' + esc(user.uid) + '" role="button" tabindex="0">' + avatarHtml(me.avatar, un, "lg", me.deco) + "<span><b>" + esc(me.name || "@" + un) + roleTag(roleCache[user.uid]) + "</b><small>@" + esc(un) + " · " + F.friends.length + (F.friends.length === 1 ? " friend" : " friends") + '</small></span></span><span class="soc-me-acts"><button class="pill-btn acct-sw" type="button" data-acct-switch aria-label="Switch account" title="Switch account"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4 3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8"/></svg></button><button class="pill-btn" type="button" data-editprofile>Edit profile</button></span></div>' +
      '<div class="soc-links"><button type="button" class="pill-btn" data-open-friends>Friends <b>' + F.friends.length + '</b></button><button type="button" class="pill-btn" data-open-chats>Chats' + (window.scorelineChat?.unread() ? ' <b class="soc-dot">' + window.scorelineChat.unread() + "</b>" : "") + "</button></div>" +
      '<div class="section-title"><b>Add a friend</b></div><form class="acct-add" data-addf><input placeholder="Username (the @ is optional)" maxlength="21" autocomplete="off" autocapitalize="none" spellcheck="false"><button class="pill-btn" type="submit">Add</button></form>' + addNoteHtml() +
      (F.incoming.length ? '<div class="section-title"><b>Friend requests</b><span class="muted">' + F.incoming.length + "</span></div><div class=\"panel\">" + F.incoming.map((r) => person(r.from, "Wants to be friends", '<button class="pill-btn" type="button" data-accept="' + esc(r.id) + '">Accept</button><button class="pill-btn" type="button" data-decline="' + esc(r.id) + '" aria-label="Decline">✕</button>')).join("") + "</div>" : "") +
      '<div class="section-title"><b>Friends</b><span class="muted">' + F.friends.length + '</span></div><div class="panel">' + (F.friends.length ? F.friends.slice().sort((a, b) => (names[a] || "").localeCompare(names[b] || "")).map((uid) => person(uid, "", '<button class="pill-btn" type="button" data-chat="' + esc(uid) + '">Message</button><button class="pill-btn" type="button" data-unfriend="' + esc(uid) + '" aria-label="Remove friend">✕</button>')).join("") : '<div class="g-note">No friends yet. Add someone by their username above.</div>') + "</div>" +
      (F.outgoing.length ? '<div class="section-title"><b>Sent requests</b></div><div class="panel">' + F.outgoing.map((r) => person(r.to, "Waiting for them to accept", '<button class="pill-btn" type="button" data-decline="' + esc(r.id) + '" aria-label="Cancel request">✕</button>')).join("") + "</div>" : "") +
      '<div class="g-note">Only people you both accepted can message each other. Never share personal details like your address, school or passwords.</div>';
  },
};
const niceErr = (e) => {
  const c = e?.code || "";
  if (/invalid-credential|wrong-password|user-not-found/.test(c)) return "Wrong email or password.";
  if (/email-already-in-use/.test(c)) return "That email already has an account. Log in instead.";
  if (/weak-password/.test(c)) return "Use at least 6 characters for your password.";
  if (/invalid-email/.test(c)) return "That email doesn't look right.";
  if (/too-many-requests/.test(c)) return "Too many tries. Wait a minute and try again.";
  return e?.message || "Something went wrong.";
};

/* ---------- two-step sign-in (emailed codes; the push worker sends and checks them) ---------- */
let pending2 = false, twoStepOn = false, otpUnsub = null, otpPurpose = null;
async function requestCode(purpose) {
  otpPurpose = purpose; watchOtp();
  try { await fb.setDoc(fb.doc(db, "otpRequests", user.uid), { createdAt: fb.serverTimestamp(), purpose }); toast("Code sent. Check your email."); }
  catch { toast("Wait a minute before asking for another code."); }
}
function watchOtp() {
  if (otpUnsub || !user) return;
  const ref = fb.doc(db, "otpResults", user.uid);
  otpUnsub = fb.onSnapshot(ref, async (d) => {
    if (!d.exists()) return;
    const x = d.data();
    await fb.deleteDoc(ref).catch(() => {});
    if (x.token) { otpUnsub?.(); otpUnsub = null; await fb.signInWithCustomToken(auth, x.token); buzz(12); toast(x.purpose === "enable" ? "Two-step sign-in is on" : "Verified"); }
    else if (x.error) { const f = document.querySelector("[data-otp]"); if (f) errBox(f, x.error); else toast(x.error); f?.querySelector("button")?.removeAttribute("disabled"); }
  }, () => {});
}
const otpForm = (title, note) => '<div class="g-label">' + title + '</div><p class="g-note">' + note + '</p><form class="acct-add" data-otp><input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="123456" required><button class="pill-btn" type="submit">Verify</button></form><div class="acct-err" data-err></div>';
document.addEventListener("click", async (e) => {
  if (!user) return;
  if (e.target.closest("[data-otpresend]")) return requestCode(otpPurpose || "signin");
  if (e.target.closest("[data-2on]")) {
    otpPurpose = "enable"; await requestCode("enable");
    const box = document.querySelector("[data-2box]");
    if (box) box.innerHTML = otpForm("Turn on two-step sign-in", "We emailed a 6-digit code to " + esc(maskEmail(user.email)) + ". Enter it to confirm your email works.") + '<button type="button" class="acct-link" data-otpresend>Send a new code</button>';
    return;
  }
  if (e.target.closest("[data-2off]")) {
    try { await fb.deleteDoc(fb.doc(db, "twoStep", user.uid)); twoStepOn = false; toast("Two-step sign-in is off"); refreshAccountSheet(); }
    catch { toast("Log out and back in with your code, then try again."); }
  }
});
document.addEventListener("submit", async (e) => {
  const f = e.target;
  if (!f.matches("[data-otp]") || !user) return;
  e.preventDefault();
  const code = String(f.code.value).replace(/\D/g, "");
  if (code.length !== 6) { errBox(f, "Enter the 6 digits from the email."); return; }
  f.querySelector("button").disabled = true; errBox(f, "");
  watchOtp();
  try { await fb.setDoc(fb.doc(db, "otpAttempts", user.uid), { code, createdAt: fb.serverTimestamp() }); }
  catch { errBox(f, "Couldn't check the code. Try again."); f.querySelector("button").disabled = false; }
});
/* ---------- profiles: photo, name, bio, theme, favourite sports/teams/players, Shop extras.
   Visible to you, and to your friends when you choose "Friends". The page and editor are drawn by index.html
   (openProfile / openProfileEditor); this part only loads and saves. ---------- */
let myCard = null;
const CARD_KEYS = ["avatar", "bio", "teams", "show", "title", "banner", "deco", "name", "theme", "sports", "favTeams", "favPlayers"];
// Every save goes through here, so a change to one field never drops the others.
function cardWith(changes = {}) {
  const base = { avatar: "", bio: "", teams: followedTeams(), show: "friends", title: "", banner: "", deco: "", name: "", theme: "", sports: [], favTeams: [], favPlayers: [] };
  const out = {};
  for (const k of CARD_KEYS) out[k] = k in changes ? changes[k] : (myCard && k in myCard ? myCard[k] : base[k]);
  out.updatedAt = fb.serverTimestamp();
  return out;
}
function avatarHtml(src, name, size, deco) {
  const cls = "avatar" + (size === "lg" ? " lg" : size === "xl" ? " xl" : "");
  const a = src ? '<img class="' + cls + '" src="' + esc(src) + '" alt="">' : '<div class="' + cls + '">' + esc((name || "?")[0].toUpperCase()) + "</div>";
  return deco && /^d_[a-z0-9_]+$/.test(deco) ? '<span class="deco ' + deco + '">' + a + "</span>" : a;
}
// Photos are cropped square and shrunk on this device to a small JPEG (well under 60 KB) before saving.
async function shrinkPhoto(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Pick a JPG, PNG or WebP photo.");
  if (file.size > 10 * 1024 * 1024) throw new Error("That photo is over 10 MB. Pick a smaller one.");
  const img = await createImageBitmap(file);
  const size = 200, c = document.createElement("canvas"); c.width = c.height = size;
  const k = Math.min(img.width, img.height);
  c.getContext("2d").drawImage(img, (img.width - k) / 2, (img.height - k) / 2, k, k, 0, 0, size, size);
  let q = 0.85, url = c.toDataURL("image/jpeg", q);
  while (url.length > 60000 && q > 0.35) { q -= 0.1; url = c.toDataURL("image/jpeg", q); }
  if (url.length > 60000) throw new Error("Couldn't make that photo small enough. Try another.");
  return url;
}
const followedTeams = () => [...state.favs].filter((k) => k !== "f1").slice(0, 30).map((k) => teamNames[k] || "").filter(Boolean);
window.scorelineProfile = {
  me: () => (user && profile ? user.uid : ""),
  // Everything a profile page needs. Private profiles come back with card: null.
  async load(uid) {
    await startFirebase();
    if (FIREBASE_CONFIG && fb) await Promise.race([authReady, new Promise((r) => setTimeout(r, 8000))]);
    if (!user) return null;
    uid = uid || user.uid;
    const mine = uid === user.uid;
    if (!names[uid]) await nameOf(uid);
    const [c, p, s, r] = await Promise.all([
      mine ? Promise.resolve(myCard) : fb.getDoc(fb.doc(db, "cards", uid)).then((d) => (d.exists() ? d.data() : null)).catch(() => null),
      fb.getDoc(fb.doc(db, "profiles", uid)).then((d) => d.data() || null).catch(() => null),
      fb.getDoc(fb.doc(db, "pstats", uid)).then((d) => d.data() || null).catch(() => null),
      roleOf(uid),
    ]);
    const isFriend = friendState.friends.includes(uid);
    return { uid, mine, isFriend, username: names[uid] || p?.username || "", joined: p?.createdAt?.toMillis?.() || 0,
      card: c ? cardWithPlain(c) : null, stats: s, role: r, friends: mine ? friendState.friends.length : null };
  },
  async save(changes) { const card = cardWith(changes); await fb.setDoc(fb.doc(db, "cards", user.uid), card); myCard = card; window.dispatchEvent(new Event("scoreline-social")); },
  photo: (file) => shrinkPhoto(file),
  async pool(lg) { await startFirebase(); const d = await fb.getDoc(fb.doc(db, "fpool", lg)).catch(() => null); return d?.data()?.players || {}; },
  async owned() { if (!user) return new Set(); const r = await fb.getDocs(fb.collection(db, "inventory", user.uid, "items")).catch(() => null); return new Set((r?.docs || []).map((d) => d.id)); },
  async teen() { if (!user) return false; const a = await fb.getDoc(fb.doc(db, "ages", user.uid)).catch(() => null); return a?.data()?.is13plus === true; },
  avatar: avatarHtml,
};
const cardWithPlain = (c) => { const o = {}; for (const k of CARD_KEYS) o[k] = c[k] ?? (Array.isArray(c[k]) ? [] : ""); o.sports ||= []; o.favTeams ||= []; o.favPlayers ||= []; o.show ||= "friends"; return o; };
// Sign-in codes: move your sign-in from the website to a newly installed app without typing your password.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no 0/O or 1/I
const pretty = (c) => c.slice(0, 4) + "-" + c.slice(4);
document.addEventListener("click", async (e) => {
  if (e.target.closest("[data-sendsignin]") && user) {
    const out = document.querySelector("[data-signincode]");
    const code = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
    try {
      await fb.setDoc(fb.doc(db, "signinCodes", code), { uid: user.uid, createdAt: fb.serverTimestamp() });
      if (out) out.innerHTML = '<div class="signin-code">' + pretty(code) + '</div><p class="g-note">In the Scoreline app: You → Sign in → "Have a sign-in code from the website?" Works once, for 10 minutes. Don\'t share it.</p>';
      buzz(10);
    } catch { toast("Couldn't make a code. Try again."); }
    return;
  }
  if (e.target.closest("[data-usecode]")) {
    const body = sheetView?.el?.querySelector(".sheet-body") || e.target.parentElement;
    const f = body.querySelector("[data-acct]");
    if (f) f.outerHTML = '<form class="acct-form" data-codein><label>Sign-in code<input name="code" maxlength="9" autocomplete="one-time-code" autocapitalize="characters" placeholder="ABCD-2345" required></label><div class="acct-err" data-err></div><button class="pill-btn dl acct-go" type="submit">Sign in</button><p class="g-note">On the website, signed in: You → your account → "Send sign-in to the app".</p></form>';
    e.target.remove();
    body.querySelector("[data-codein] input")?.focus();
  }
});
document.addEventListener("submit", async (e) => {
  const f = e.target;
  if (!f.matches("[data-codein]")) return;
  e.preventDefault();
  const code = String(f.code.value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const btn = f.querySelector("button"); btn.disabled = true; errBox(f, "");
  try {
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) throw new Error("bad");
    const ref = fb.doc(db, "signinCodes", code);
    let token = null;
    for (let i = 0; i < 20 && !token; i++) {            // the server adds the sign-in pass within a few seconds
      const snap = await fb.getDoc(ref);
      if (!snap.exists()) throw new Error("bad");
      token = snap.data().token || null;
      if (!token) await new Promise((r) => setTimeout(r, 1000));
    }
    if (!token) throw new Error("slow");
    await fb.signInWithCustomToken(auth, token);
    await fb.deleteDoc(ref).catch(() => {});             // one-time: remove it right away
    buzz(12); toast("Signed in");
  } catch (err) {
    btn.disabled = false;
    errBox(f, err.message === "slow" ? "The server didn't answer in time. Try again in a minute." : "That code didn't work. It may have expired; make a new one on the website.");
  }
});
// The account email stays hidden until you confirm it's you (password, or Google for Google accounts).
const maskEmail = (e) => { const [u, d] = String(e || "").split("@"); return d ? (u[0] || "") + "•••@" + d : "Hidden"; };
let emailShownUntil = 0;
function emailLine() {
  if (Date.now() < emailShownUntil) return esc(user.email || "");
  return esc(maskEmail(user.email)) + ' <button type="button" class="acct-link" data-showemail>Show</button>';
}
function revealEmail() {
  emailShownUntil = Date.now() + 30000;          // hides itself again after 30 seconds
  document.querySelectorAll("[data-email]").forEach((el) => { el.innerHTML = emailLine(); });
  setTimeout(() => document.querySelectorAll("[data-email]").forEach((el) => { el.innerHTML = emailLine(); }), 30500);
}
document.addEventListener("click", async (e) => {
  if (!e.target.closest("[data-showemail]") || !user) return;
  const google = (user.providerData || []).some((p) => p.providerId === "google.com") && !(user.providerData || []).some((p) => p.providerId === "password");
  if (google) {
    try { await fb.reauthenticateWithPopup(user, new fb.GoogleAuthProvider()); revealEmail(); }
    catch (err) { if (!/popup-closed|cancelled-popup/.test(err?.code || "")) toast("Couldn't confirm it's you. Try again."); }
    return;
  }
  const el = e.target.closest("[data-email]");
  el.innerHTML = '<form class="acct-add email-pw" data-reveal><input type="password" name="pw" placeholder="Your password" autocomplete="current-password" required><button class="pill-btn" type="submit">Show</button></form>';
  el.querySelector("input").focus();
});
document.addEventListener("submit", async (e) => {
  const f = e.target;
  if (!f.matches("[data-reveal]") || !user) return;
  e.preventDefault();
  const btn = f.querySelector("button"); btn.disabled = true;
  try {
    await fb.reauthenticateWithCredential(user, fb.EmailAuthProvider.credential(user.email, f.pw.value));
    revealEmail();
  } catch (err) {
    btn.disabled = false; f.pw.value = "";
    toast(/wrong-password|invalid-credential|invalid-login/.test(err?.code || "") ? "That password isn't right." : /too-many-requests/.test(err?.code || "") ? "Too many tries. Wait a bit and try again." : "Couldn't check your password. Try again.");
  }
});
document.addEventListener("submit", async (e) => {
  const f = e.target;
  if (f.matches("[data-acct]")) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    const btn = f.querySelector(".acct-go"); btn.disabled = true; errBox(f, "");
    try {
      if (mode === "signup") { await signUp(d.email.trim(), d.password, d.username, !!d.teen); await startSync().catch(() => {}); refreshAccountSheet(); }
      else await fb.signInWithEmailAndPassword(auth, d.email.trim(), d.password);
      buzz(12); toast(mode === "signup" ? "Account created" : "Logged in");
    } catch (err) { errBox(f, niceErr(err)); }
    btn.disabled = false;
  }
  if (f.matches("[data-uname]")) {
    e.preventDefault();
    const name = cleanName(f.querySelector("input").value); errBox(f, "");
    try {
      if (!/^[a-z0-9_]{3,20}$/.test(name)) throw new Error("Usernames are 3–20 letters, numbers or _.");
      if ((await fb.getDoc(fb.doc(db, "usernames", name))).exists()) throw new Error("That username is taken.");
      await fb.setDoc(fb.doc(db, "usernames", name), { uid: user.uid });
      await fb.setDoc(fb.doc(db, "profiles", user.uid), { username: name, createdAt: fb.serverTimestamp() });
      profile = { username: name }; names[user.uid] = name;
      if (f.querySelector("[data-teen]")?.checked) agreeTerms(user.uid);
      buzz(12); refreshAccountSheet();
    } catch (err) { errBox(f, niceErr(err)); }
  }
  if (f.matches("[data-addf]")) {
    e.preventDefault();
    const input = f.querySelector("input"); errBox(f, "");
    const btn = f.querySelector("button[type=submit]"); if (btn) btn.disabled = true;
    try { const msg = await addFriend(input.value); input.value = ""; showAddNote(f, msg, true); toast(msg); buzz(12); }
    catch (err) { showAddNote(f, /permission|offline|network|unavailable/i.test(err?.code || err?.message || "") ? "That didn't go through. Check your connection and try again." : niceErr(err), false); }
    finally { if (btn) btn.disabled = false; }
  }
});
document.addEventListener("click", async (e) => {
  const t = e.target;
  if (t.closest("#accountBtn")) { e.stopPropagation(); return openAccount(); }
  const m = t.closest("[data-amode]");
  if (m) { mode = m.dataset.amode; return refreshAccountSheet(); }
  if (t.closest("[data-privacy]")) return openPrivacy();
  if (t.closest("[data-google]")) {
    try { await fb.signInWithPopup(auth, new fb.GoogleAuthProvider()); buzz(12); toast("Logged in"); }
    catch (err) { if (!/popup-closed|cancelled-popup/.test(err?.code || "")) errBox(t, /operation-not-allowed/.test(err?.code || "") ? "Google sign-in isn't turned on yet." : niceErr(err)); }
    return;
  }
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
  if (t.closest("[data-logout]")) {
    const others = savedAccts().filter((a) => a.slot !== SLOT);
    forgetSlot(SLOT); await fb.signOut(auth); toast("Logged out");
    if (others.length) switchTo(others[0].slot);   // like TikTok: carry on in your other account
    return;
  }
  const sw = t.closest("[data-acct-slot]");
  if (sw) { if (sw.dataset.acctSlot !== SLOT) { buzz(12); switchTo(sw.dataset.acctSlot); } return; }
  if (t.closest("[data-acct-add]")) { buzz(12); return addAccount(); }
  if (t.closest("[data-acct-switch]")) return openSwitcher();
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

/* ---------- Picks and Marks (Phase 5) ----------
   Free picks on upcoming games; Marks are earned only (never bought, cashed out or traded).
   The rules lock picks at kickoff with the server's clock and allow them only for ages 13+. */
const pickReady = () => !!(db && user && !pending2);
window.scorelinePicks = {
  async status() {
    await startFirebase();
    if (FIREBASE_CONFIG && fb) await Promise.race([authReady, new Promise((r) => setTimeout(r, 8000))]);   // wait for the real answer
    if (!pickReady()) return { signedIn: false };
    const a = await fb.getDoc(fb.doc(db, "ages", user.uid)).catch(() => null);
    return { signedIn: true, teen: a?.exists() ? a.data().is13plus === true : null };
  },
  // Only true/false is saved, never the birth date. It can't be edited, only withdrawn (deleted) and agreed to again.
  async setAge(is13plus) {
    await fb.setDoc(fb.doc(db, "ages", user.uid), { is13plus: !!is13plus, at: fb.serverTimestamp() });
    if (!is13plus) return;
    // Agreeing again after a withdrawal: put back the title and banner you had on (if you still own them).
    const u = (await fb.getDoc(fb.doc(db, "users", user.uid)).catch(() => null))?.data() || {};
    if (!u.heldTitle && !u.heldBanner && !u.heldDeco) return;
    const card = cardWith({ title: u.heldTitle || "", banner: u.heldBanner || "", deco: u.heldDeco || "" });
    try { await fb.setDoc(fb.doc(db, "cards", user.uid), card); myCard = card; } catch {}
    await fb.setDoc(fb.doc(db, "users", user.uid), { heldTitle: "", heldBanner: "", heldDeco: "", updatedAt: fb.serverTimestamp() }, { merge: true }).catch(() => {});
  },
  async game(gameId) { await startFirebase(); const d = await fb.getDoc(fb.doc(db, "games", gameId)).catch(() => null); return d?.exists() ? d.data() : null; },
  async pick(gameId) { if (!pickReady()) return null; const d = await fb.getDoc(fb.doc(db, "picks", user.uid + "_" + gameId)).catch(() => null); return d?.exists() ? d.data() : null; },
  setPick: (gameId, side) => fb.setDoc(fb.doc(db, "picks", user.uid + "_" + gameId), { uid: user.uid, gameId, side, updatedAt: fb.serverTimestamp() }),
  clearPick: (gameId) => fb.deleteDoc(fb.doc(db, "picks", user.uid + "_" + gameId)),
  async mine() {
    if (!pickReady()) return [];
    const r = await fb.getDocs(fb.query(fb.collection(db, "picks"), fb.where("uid", "==", user.uid))).catch(() => null);
    return (r?.docs || []).map((d) => d.data());
  },
  // Shop: titles and banners (in-app only). Buying is one batch the rules check: item + Marks off + ledger entry.
  async shopItems() {
    await startFirebase();
    const r = await fb.getDocs(fb.collection(db, "shopItems")).catch(() => null);
    return (r?.docs || []).map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  },
  async owned() {
    if (!pickReady()) return new Set();
    const r = await fb.getDocs(fb.collection(db, "inventory", user.uid, "items")).catch(() => null);
    return new Set((r?.docs || []).map((d) => d.id));
  },
  async buy(item, price) {
    const b = fb.writeBatch(db), at = fb.serverTimestamp();
    b.set(fb.doc(db, "inventory", user.uid, "items", item), { price, at });
    b.update(fb.doc(db, "wallets", user.uid), { balance: fb.increment(-price), updatedAt: at });
    b.set(fb.doc(db, "ledger", user.uid, "entries", "shop_" + item), { amount: -price, reason: "shop", refId: item, createdAt: at });
    await b.commit();
  },
  equipped: () => ({ title: myCard?.title || "", banner: myCard?.banner || "", deco: myCard?.deco || "" }),
  async equip(kind, id) {
    const card = cardWith({ [kind]: id });
    await fb.setDoc(fb.doc(db, "cards", user.uid), card);
    myCard = card;
  },
  // Games still open for picks, soonest first (lockAt is in the future). Single-field range, so no extra index needed.
  async upcoming(n = 40) {
    await startFirebase();
    const r = await fb.getDocs(fb.query(fb.collection(db, "games"), fb.where("lockAt", ">", fb.Timestamp.now()), fb.orderBy("lockAt"), fb.limit(n))).catch(() => null);
    return (r?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
  },
  async balance() { if (!pickReady()) return 0; const d = await fb.getDoc(fb.doc(db, "wallets", user.uid)).catch(() => null); return d?.data()?.balance || 0; },
  // Dev accounts (devs/<username>, set by hand in the Firebase console): give Marks to anyone 13+ by username, yourself included.
  myName: () => (pickReady() ? profile?.username || "" : ""),
  // Withdraw from the Terms = a freeze: Marks stop (the worker only pays agreed accounts), the Shop and Marks Fantasy close,
  // and your title and banner come off your profile. Nothing is deleted: the Marks and items are kept, and agreeing again
  // (setAge) brings them all back, including what you had equipped (saved privately in users/{uid} as heldTitle/heldBanner).
  async withdraw() {
    const held = { heldTitle: myCard?.title || "", heldBanner: myCard?.banner || "", heldDeco: myCard?.deco || "" };
    await fb.setDoc(fb.doc(db, "users", user.uid), { ...held, updatedAt: fb.serverTimestamp() }, { merge: true });
    if (held.heldTitle || held.heldBanner || held.heldDeco) {
      const card = cardWith({ title: "", banner: "", deco: "" });
      await fb.setDoc(fb.doc(db, "cards", user.uid), card); myCard = card;
    }
    await fb.deleteDoc(fb.doc(db, "ages", user.uid));
  },
  // Dev tools: the Owner, Devs and Mods. Giving Marks: only accounts listed in devs/ (set by the Owner in the console).
  async isDev() { if (!user) return false; if (["owner", "dev", "mod"].includes(await roleOf(user.uid))) return true; return this.canGive(); },
  async canGive() { if (viewingAs()) return false; const n = pickReady() && profile?.username; if (!n) return false; const d = await fb.getDoc(fb.doc(db, "devs", n)).catch(() => null); return !!d?.exists(); },
  async grant(username, amount) {
    const name = cleanName(username).replace(/^@/, "");
    const u = name ? await fb.getDoc(fb.doc(db, "usernames", name)) : null;
    if (!u?.exists()) throw new Error("No one has that username.");
    const uid = u.data().uid, id = "grant_" + crypto.randomUUID().replace(/-/g, ""), at = fb.serverTimestamp(), b = fb.writeBatch(db);
    b.set(fb.doc(db, "ledger", uid, "entries", id), { amount, reason: "dev", by: user.uid, dev: profile?.username || "", createdAt: at });
    b.set(fb.doc(db, "wallets", uid), { balance: fb.increment(amount), updatedAt: at, lastGrant: id }, { merge: true });
    try { await b.commit(); } catch { throw new Error("Couldn't give Marks. They only go to accounts that agreed to the Terms (13+)."); }
    return name;
  },
};

/* ---------- Season leagues with friends (leagues/{id}): create, invite, join, snake draft, weekly starters.
   Every step is checked by the rules; the push worker scores the weeks. ---------- */
const LEAGUE_ROSTER = { nfl: 8, cfb: 8, nba: 7, mlb: 6, f1: 3 };
const poolCache = {};
window.scorelineLeagues = {
  me: () => (pickReady() ? user.uid : ""),
  async friendsList() { if (!pickReady()) return []; return Promise.all((friendState.friends || []).map(async (uid) => ({ uid, name: await nameOf(uid) }))); },
  name: (uid) => nameOf(uid),
  async mine() {
    if (!pickReady()) return { leagues: [], invites: [] };
    const q = (field) => fb.getDocs(fb.query(fb.collection(db, "leagues"), fb.where(field, "array-contains", user.uid))).then((r) => r.docs.map((d) => ({ id: d.id, ...d.data() }))).catch(() => []);
    const [leagues, invites] = await Promise.all([q("members"), q("invites")]);
    return { leagues, invites };
  },
  async create({ name, lg, mode, invites }) {
    const ref = fb.doc(fb.collection(db, "leagues"));
    await fb.setDoc(ref, { name, lg, mode, owner: user.uid, members: [user.uid], invites, status: "forming", rosterSize: LEAGUE_ROSTER[lg], createdAt: fb.serverTimestamp(), updatedAt: fb.serverTimestamp() });
    return ref.id;
  },
  watch(id, cb) { return fb.onSnapshot(fb.doc(db, "leagues", id), (d) => cb(d.exists() ? { id: d.id, ...d.data() } : null), () => cb(null)); },
  invite: (id, invites) => fb.updateDoc(fb.doc(db, "leagues", id), { invites, updatedAt: fb.serverTimestamp() }),
  join: (L) => fb.updateDoc(fb.doc(db, "leagues", L.id), { members: [...L.members, user.uid], invites: L.invites.filter((x) => x !== user.uid), updatedAt: fb.serverTimestamp() }),
  leave: (L) => fb.updateDoc(fb.doc(db, "leagues", L.id), { members: L.members.filter((x) => x !== user.uid), invites: L.invites.filter((x) => x !== user.uid), updatedAt: fb.serverTimestamp() }),
  remove: (id) => fb.deleteDoc(fb.doc(db, "leagues", id)),
  start(L) {   // random draft order
    const order = [...L.members]; for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    return fb.updateDoc(fb.doc(db, "leagues", L.id), { status: "drafting", order, pick: 0, taken: {}, invites: [], updatedAt: fb.serverTimestamp() });
  },
  pick(L, who, pid) {
    const last = L.pick + 1 === L.order.length * L.rosterSize;
    return fb.updateDoc(fb.doc(db, "leagues", L.id), { pick: L.pick + 1, last: { uid: who, pid }, ["taken." + pid]: who, status: last ? "active" : "drafting",
      ...(last ? { startedAt: fb.serverTimestamp() } : {}), updatedAt: fb.serverTimestamp() });
  },
  async pool(lg) {
    if (poolCache[lg] && Date.now() - poolCache[lg].at < 30 * 60_000) return poolCache[lg].players;
    await startFirebase();
    const d = await fb.getDoc(fb.doc(db, "fpool", lg)).catch(() => null);
    poolCache[lg] = { at: Date.now(), players: d?.data()?.players || {} };
    return poolCache[lg].players;
  },
  async starters(id) { const d = await fb.getDoc(fb.doc(db, "lstarts", id + "_" + user.uid)).catch(() => null); return d?.exists() ? d.data().lineup || {} : null; },
  saveStarters: (id, lineup) => fb.setDoc(fb.doc(db, "lstarts", id + "_" + user.uid), { uid: user.uid, leagueId: id, lineup, updatedAt: fb.serverTimestamp() }),
};

/* ---------- Fantasy: Free Fantasy (no currency) and Marks Fantasy (Terms agreement / 13+ only).
   Contests come from the push worker (fcontests, fboard). Your lineup: fentries/{contestId}_{mode}_{uid}. The rules
   lock it at the first game, check every player is in the contest, and only allow Marks mode with the agreement. */
const fentryId = (cid, mode, uid) => cid + "_" + mode + "_" + uid;
window.scorelineFantasy = {
  async board(lg, fmt) { await startFirebase(); const d = await fb.getDoc(fb.doc(db, "fboard", lg + "_" + fmt)).catch(() => null); return d?.data()?.contests || []; },
  async contest(id) { await startFirebase(); const d = await fb.getDoc(fb.doc(db, "fcontests", id)).catch(() => null); return d?.exists() ? { id: d.id, ...d.data() } : null; },
  async mine(cid, mode) { if (!pickReady()) return null; const d = await fb.getDoc(fb.doc(db, "fentries", fentryId(cid, mode, user.uid))).catch(() => null); return d?.exists() ? d.data() : null; },
  save: (cid, mode, lineup) => fb.setDoc(fb.doc(db, "fentries", fentryId(cid, mode, user.uid)), { uid: user.uid, contestId: cid, mode, lineup, updatedAt: fb.serverTimestamp() }),
  clear: (cid, mode) => fb.deleteDoc(fb.doc(db, "fentries", fentryId(cid, mode, user.uid))),
  // Friends' lineups in the same contest and mode (friends only, by the rules).
  async friends(cid, mode) {
    if (!pickReady()) return [];
    const out = await Promise.all((friendState.friends || []).map(async (f) => {
      const d = await fb.getDoc(fb.doc(db, "fentries", fentryId(cid, mode, f))).catch(() => null);
      return d?.exists() ? { name: await nameOf(f), ...d.data() } : null;
    }));
    return out.filter(Boolean);
  },
};

// Start Firebase (~270 KB) once the scores are on screen, or right away when the account button is tapped.
let booting = null;
function startFirebase() { return (booting ||= boot().catch(() => {})); }
if ("requestIdleCallback" in window) requestIdleCallback(startFirebase, { timeout: 2500 }); else setTimeout(startFirebase, 1500);

/* ---------- roles: Owner > Dev / Mod / Beta Tester ----------
   The Owner (set by the worker) gives or takes away the other roles from Dev tools. Each role shows as a tag on
   profiles. Mods (and the Owner) can read reports. The rules enforce all of this; the page only shows the buttons. */
const GIVABLE = ["dev", "mod", "tester"];
window.scorelineViewAs = { get: viewingAs, async set(r) { if (r && (!user || (await realRoleOf(user.uid)) !== "owner")) return false; store.set("viewAs", VIEW_AS.includes(r) ? r : ""); location.reload(); return true; } };
window.scorelineRoles = {
  async mine() {
    await startFirebase();
    if (FIREBASE_CONFIG && fb) await Promise.race([authReady, new Promise((r) => setTimeout(r, 8000))]);
    if (!user) return "";
    delete roleCache[user.uid];
    return roleOf(user.uid);
  },
  async list() {
    const r = await fb.getDocs(fb.collection(db, "roles"));
    const rows = r.docs.map((d) => ({ uid: d.id, role: String(d.data().role || "") })).filter((x) => /^[a-z]{1,20}$/.test(x.role));
    await Promise.all(rows.map((x) => nameOf(x.uid)));
    rows.forEach((x) => { roleCache[x.uid] = x.role; });
    return rows.map((x) => ({ ...x, username: names[x.uid] })).sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : a.role.localeCompare(b.role) || a.username.localeCompare(b.username)));
  },
  async give(username, role) {
    const name = cleanName(username).replace(/^@+\s*/, "");
    if (!GIVABLE.includes(role)) throw new Error("Pick a role.");
    if (!/^[a-z0-9_]{3,20}$/.test(name)) throw new Error("No account called @" + name + ".");
    const u = await fb.getDoc(fb.doc(db, "usernames", name));
    if (!u.exists()) throw new Error("No account called @" + name + ".");
    const uid = u.data().uid;
    if (uid === user.uid) throw new Error("You can't change your own role.");
    if ((await roleOf(uid)) === "owner") throw new Error("@" + name + " is an Owner.");
    try { await fb.setDoc(fb.doc(db, "roles", uid), { role, by: user.uid, at: fb.serverTimestamp() }); }
    catch { throw new Error("Only the Owner can give roles."); }
    roleCache[uid] = role; names[uid] = name;
    return name;
  },
  async remove(uid) {
    try { await fb.deleteDoc(fb.doc(db, "roles", uid)); } catch { throw new Error("Only the Owner can take roles away."); }
    roleCache[uid] = "";
  },
  async reports() {
    const r = await fb.getDocs(fb.query(fb.collection(db, "reports"), fb.orderBy("at", "desc"), fb.limit(50)));
    const rows = r.docs.map((d) => ({ id: d.id, ...d.data() }));
    await Promise.all(rows.flatMap((x) => [x.from, x.about]).filter(Boolean).map(nameOf));
    return rows.map((x) => ({ ...x, fromName: names[x.from], aboutName: names[x.about], when: x.at?.toMillis ? x.at.toMillis() : 0 }));
  },
};

/* ---------- reactions: 🔥 😂 😮 😭 🐐 👀 on plays, news and moves (counts for everyone, like Discord) ----------
   reactions/{item} = { c: { fire: 12, ... } } and reactions/{item}/by/{uid} = { e: "fire" }, changed together in one
   transaction; the rules check the counts only move by your own change. */
const RX = [["fire", "🔥"], ["lol", "😂"], ["wow", "😮"], ["cry", "😭"], ["goat", "🐐"], ["eyes", "👀"]];
const RXE = Object.fromEntries(RX);
const rxState = {};
async function rxLoad(item) {
  await startFirebase();
  if (!fb || !db) return { c: {}, mine: "" };
  if (FIREBASE_CONFIG) await Promise.race([authReady, new Promise((r) => setTimeout(r, 4000))]);
  const [d, m] = await Promise.all([fb.getDoc(fb.doc(db, "reactions", item)).catch(() => null), user ? fb.getDoc(fb.doc(db, "reactions", item, "by", user.uid)).catch(() => null) : null]);
  return (rxState[item] = { c: d?.exists() ? d.data().c || {} : {}, mine: m?.exists() ? m.data().e : "" });
}
function rxDraw(el) {
  const item = el.dataset.reactId, r = rxState[item] || { c: {}, mine: "" };
  const list = RX.filter(([k]) => (r.c[k] || 0) > 0).sort((a, b) => (r.c[b[0]] || 0) - (r.c[a[0]] || 0));
  const total = list.reduce((n, [k]) => n + (r.c[k] || 0), 0);
  el.innerHTML = list.map(([k, e]) => '<button type="button" class="rx' + (r.mine === k ? " on" : "") + '" data-rx="' + k + '" aria-label="' + e + " " + r.c[k] + '">' + e + " <b>" + r.c[k] + "</b></button>").join("") +
    (el.classList.contains("open") ? RX.map(([k, e]) => '<button type="button" class="rx pick' + (r.mine === k ? " on" : "") + '" data-rx="' + k + '" aria-label="React ' + e + '">' + e + "</button>").join("")
      : '<button type="button" class="rx add" data-rx-add aria-label="Add a reaction">😀<i>+</i></button>') +
    (total >= 10 ? '<span class="rx-total">' + total.toLocaleString() + " reactions</span>" : "");
}
const rxSeen = new WeakSet();
const rxIO = "IntersectionObserver" in window ? new IntersectionObserver((ents) => ents.forEach((en) => {
  if (!en.isIntersecting) return;
  rxIO.unobserve(en.target);
  rxLoad(en.target.dataset.reactId).then(() => rxDraw(en.target)).catch(() => rxDraw(en.target));
}), { rootMargin: "200px" }) : null;
async function rxToggle(el, k) {
  if (!user) return toast("Sign in to react 🙂");
  const item = el.dataset.reactId, ref = fb.doc(db, "reactions", item), mineRef = fb.doc(db, "reactions", item, "by", user.uid);
  const prev = rxState[item] ? { c: { ...rxState[item].c }, mine: rxState[item].mine } : { c: {}, mine: "" };
  const apply = (s) => { const c = { ...s.c }, had = s.mine, now = had === k ? "" : k; if (had) c[had] = Math.max(0, (c[had] || 0) - 1); if (now) c[now] = (c[now] || 0) + 1; return { c, mine: now }; };
  rxState[item] = apply(prev); el.classList.remove("open"); rxDraw(el); buzz(8);   // show it straight away
  try {
    await fb.runTransaction(db, async (tx) => {
      const [d, m] = [await tx.get(ref), await tx.get(mineRef)];
      const cur = { c: d.exists() ? d.data().c || {} : {}, mine: m.exists() ? m.data().e : "" }, next = apply(cur);
      const c = {}; RX.forEach(([key]) => { if (next.c[key]) c[key] = next.c[key]; else if (key in cur.c) c[key] = 0; });
      tx.set(ref, { c });
      if (next.mine) tx.set(mineRef, { e: next.mine }); else tx.delete(mineRef);
      rxState[item] = { c, mine: next.mine };
    });
  } catch { rxState[item] = prev; toast("Couldn't react. Try again."); }
  rxDraw(el);
}
window.scorelineReact = {
  fill(root) {
    (root || document).querySelectorAll("[data-react-id]").forEach((el) => {
      if (rxSeen.has(el)) return; rxSeen.add(el);
      if (rxState[el.dataset.reactId]) rxDraw(el); else { rxDraw(el); if (rxIO) rxIO.observe(el); else rxLoad(el.dataset.reactId).then(() => rxDraw(el)); }
    });
  },
};
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-react-id]"); if (!el) return;
  if (e.target.closest("[data-rx-add]")) { el.classList.add("open"); rxDraw(el); return; }
  const b = e.target.closest("[data-rx]"); if (b) rxToggle(el, b.dataset.rx);
});
