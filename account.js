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

async function boot() {
  if (!FIREBASE_CONFIG) return;
  const [app, a, f] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
  ]);
  fb = { ...app, ...a, ...f };
  const appInst = fb.initializeApp(FIREBASE_CONFIG);
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
    await startSync();
    watchFriends();
  }
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
  v.key = "chat|" + uid; if (!pushView(v)) return;
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
      '<div class="acct-foot"><button type="button" class="acct-link" data-logout>Log out</button></div>';
  } else {
    const F = friendState;
    const person = (uid, actions) => '<div class="opt"><span><b>@' + esc(names[uid] || "…") + "</b></span><span class=\"acct-acts\">" + actions + "</span></div>";
    h = '<div class="acct-me' + bnCls(myCard?.banner) + '">' + avatarHtml(myCard?.avatar, profile?.username) + "<div><b>@" + esc(profile?.username || "") + "</b>" + titleTag(myCard?.title) + "<small data-email>" + emailLine() + '</small></div><button class="pill-btn" type="button" data-logout>Log out</button></div>' +
      '<div class="g-note">★ teams and alert settings are synced.</div>' +
      '<div class="g-label" style="margin-top:18px">Your profile</div><div class="card-edit">' +
        '<div class="card-photo">' + avatarHtml(myCard.avatar, profile?.username, "lg") + '<div class="card-photo-acts"><label class="pill-btn">Change photo<input type="file" accept="image/jpeg,image/png,image/webp" data-avatarfile hidden></label>' + (myCard.avatar ? '<button type="button" class="acct-link" data-avatarclear>Remove photo</button>' : "") + "</div></div>" +
        '<textarea data-bio maxlength="160" rows="2" placeholder="A line about you and your teams">' + esc(myCard.bio || "") + "</textarea>" +
        '<div class="card-show"><span>Who can see it</span><div class="seg">' + [["friends", "Friends"], ["me", "Only me"]].map(([k, l]) => '<button type="button" data-cardshow="' + k + '" class="' + ((myCard.show || "friends") === k ? "active" : "") + '">' + l + "</button>").join("") + "</div></div>" +
        '<p class="g-note">Shows your photo, this line and the teams you follow (★).</p><button type="button" class="pill-btn" data-savecard>Save profile</button><div class="acct-err" data-carderr></div></div>' +
      '<div class="g-label" style="margin-top:18px">Two-step sign-in</div><div data-2box><div class="opt"><span><b>' + (twoStepOn ? "On" : "Off") + '</b><small>' + (twoStepOn ? "New devices need a code we email you" : "Ask for an emailed code when you sign in on a new device") + '</small></span>' +
      (twoStepOn ? '<button class="pill-btn" type="button" data-2off>Turn off</button>' : '<button class="pill-btn" type="button" data-2on>Turn on</button>') + "</div></div>" +      (window.__TAURI__ ? "" : '<div class="signin-send"><button type="button" class="pill-btn" data-sendsignin>Send sign-in to the app</button><div data-signincode></div></div>') +
      '<div class="g-label" style="margin-top:18px">Add a friend</div><form class="acct-add" data-addf><input placeholder="Username" maxlength="21" autocomplete="off"><button class="pill-btn" type="submit">Add</button></form><div class="acct-err" data-err></div>' +
      (F.incoming.length ? '<div class="g-label" style="margin-top:16px">Friend requests</div><div class="panel">' + F.incoming.map((r) => person(r.from, '<button class="pill-btn" type="button" data-accept="' + esc(r.id) + '">Accept</button><button class="pill-btn" type="button" data-decline="' + esc(r.id) + '">✕</button>')).join("") + "</div>" : "") +
      '<div class="g-label" style="margin-top:16px">Friends</div><div class="panel">' + (F.friends.length ? F.friends.map((uid) => person(uid, '<button class="pill-btn" type="button" data-viewcard="' + esc(uid) + '">Profile</button><button class="pill-btn" type="button" data-chat="' + esc(uid) + '">Chat</button><button class="pill-btn" type="button" data-unfriend="' + esc(uid) + '" aria-label="Remove friend">✕</button>')).join("") : '<div class="g-note">No friends yet. Add someone by their username.</div>') + "</div>" +
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
/* ---------- profile cards: photo, bio, followed teams; visible to friends or only you ---------- */
let myCard = null, pendingAvatar = null;
function avatarHtml(src, name, size) {
  const cls = "avatar" + (size === "lg" ? " lg" : "");
  return src ? '<img class="' + cls + '" src="' + esc(src) + '" alt="">' : '<div class="' + cls + '">' + esc((name || "?")[0].toUpperCase()) + "</div>";
}
// Photos are cropped square and shrunk on this device to a small JPEG (well under 60 KB) before saving.
async function shrinkPhoto(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Pick a JPG, PNG or WebP photo.");
  if (file.size > 10 * 1024 * 1024) throw new Error("That photo is over 10 MB. Pick a smaller one.");
  const img = await createImageBitmap(file);
  const size = 160, c = document.createElement("canvas"); c.width = c.height = size;
  const k = Math.min(img.width, img.height);
  c.getContext("2d").drawImage(img, (img.width - k) / 2, (img.height - k) / 2, k, k, 0, 0, size, size);
  let q = 0.85, url = c.toDataURL("image/jpeg", q);
  while (url.length > 60000 && q > 0.35) { q -= 0.1; url = c.toDataURL("image/jpeg", q); }
  if (url.length > 60000) throw new Error("Couldn't make that photo small enough. Try another.");
  return url;
}
const followedTeams = () => [...state.favs].filter((k) => k !== "f1").slice(0, 30).map((k) => teamNames[k] || "").filter(Boolean);
document.addEventListener("change", async (e) => {
  const inp = e.target.closest?.("[data-avatarfile]");
  if (!inp || !inp.files?.[0]) return;
  const err = document.querySelector("[data-carderr]");
  try {
    pendingAvatar = await shrinkPhoto(inp.files[0]);
    document.querySelectorAll(".card-photo .avatar").forEach((el) => { const im = document.createElement("img"); im.className = el.className; im.src = pendingAvatar; im.alt = ""; el.replaceWith(im); });
    if (err) err.textContent = "Photo ready. Tap Save profile.";
  } catch (x) { if (err) err.textContent = x.message; }
  inp.value = "";
});
document.addEventListener("click", async (e) => {
  if (!user) return;
  const sh = e.target.closest("[data-cardshow]");
  if (sh) { document.querySelectorAll("[data-cardshow]").forEach((b) => b.classList.toggle("active", b === sh)); return; }
  if (e.target.closest("[data-avatarclear]")) { pendingAvatar = ""; document.querySelectorAll(".card-photo img.avatar").forEach((el) => { const d = document.createElement("div"); d.className = el.className; d.textContent = (profile?.username || "?")[0].toUpperCase(); el.replaceWith(d); }); return; }
  if (e.target.closest("[data-savecard]")) {
    const err = document.querySelector("[data-carderr]");
    const card = {
      avatar: pendingAvatar != null ? pendingAvatar : (myCard?.avatar || ""),
      bio: String(document.querySelector("[data-bio]")?.value || "").trim().slice(0, 160),
      teams: followedTeams(),
      show: document.querySelector("[data-cardshow].active")?.dataset.cardshow || "friends",
      title: myCard?.title || "", banner: myCard?.banner || "",   // keep what you equipped from the Shop
      updatedAt: fb.serverTimestamp(),
    };
    try { await fb.setDoc(fb.doc(db, "cards", user.uid), card); myCard = card; pendingAvatar = null; buzz(10); toast("Profile saved"); refreshAccountSheet(); }
    catch { if (err) err.textContent = "Couldn't save your profile. Try again."; }
    return;
  }
  const vc = e.target.closest("[data-viewcard]");
  if (vc) return openCard(vc.dataset.viewcard);
});
async function openCard(uid) {
  const v = { kind: "card", key: "card|" + uid };
  if (!pushView(v)) return;
  let c = null;
  try { const d = await fb.getDoc(fb.doc(db, "cards", uid)); c = d.exists() ? d.data() : null; } catch { c = null; }
  const name = names[uid] || "friend";
  const body = c
    ? '<div class="card-view' + bnCls(c.banner) + '">' + avatarHtml(c.avatar, name, "lg") + "<b>@" + esc(name) + "</b>" + titleTag(c.title) + (c.bio ? "<p>" + esc(c.bio) + "</p>" : "") +
      (c.teams?.length ? '<div class="g-label">Follows</div><div class="card-teams">' + c.teams.map((t) => "<span>" + esc(t) + "</span>").join("") + "</div>" : "") + "</div>"
    : '<div class="empty">@' + esc(name) + " keeps their profile private.</div>";
  setBody(v, "@" + name, body);
}
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
    try { await addFriend(input.value); input.value = ""; toast("Friend request sent"); } catch (err) { errBox(f, niceErr(err)); }
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
  setAge: (is13plus) => fb.setDoc(fb.doc(db, "ages", user.uid), { is13plus: !!is13plus, at: fb.serverTimestamp() }),
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
  equipped: () => ({ title: myCard?.title || "", banner: myCard?.banner || "" }),
  async equip(kind, id) {
    const card = { avatar: myCard?.avatar || "", bio: myCard?.bio || "", teams: myCard?.teams || followedTeams(), show: myCard?.show || "friends",
      title: myCard?.title || "", banner: myCard?.banner || "", updatedAt: fb.serverTimestamp() };
    card[kind] = id;
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
  // Withdraw from the Terms: Marks stop (the worker only pays agreed accounts) and the Shop closes. Picks and Marks are kept.
  withdraw: () => fb.deleteDoc(fb.doc(db, "ages", user.uid)),
  async isDev() { const n = pickReady() && profile?.username; if (!n) return false; const d = await fb.getDoc(fb.doc(db, "devs", n)).catch(() => null); return !!d?.exists(); },
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

// Start Firebase (~270 KB) once the scores are on screen, or right away when the account button is tapped.
let booting = null;
function startFirebase() { return (booting ||= boot().catch(() => {})); }
if ("requestIdleCallback" in window) requestIdleCallback(startFirebase, { timeout: 2500 }); else setTimeout(startFirebase, 1500);
