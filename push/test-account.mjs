// Makes (or refreshes) ONE fixed test account for trying social features: @cadenbinglenut.
// It has no email and no password, so nobody can sign in to it; it just exists so it can be found,
// friended and viewed. Run by .github/workflows/test-account.yml (owner only). Input: PHOTO (a small JPEG data URL).
import admin from "firebase-admin";

const UID = "test-cadenbinglenut", USERNAME = "cadenbinglenut", NAME = "CadenBingleNut";
const sa = JSON.parse(process.env.FIREBASE_SA || "{}");
if (!sa.project_id) throw new Error("FIREBASE_SA is missing");
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const photo = String(process.env.PHOTO || "");
if (photo && (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo) || photo.length > 60000)) throw new Error("PHOTO must be a JPEG data URL under 60 KB");

// The username must be free or already this account's.
const taken = await db.doc("usernames/" + USERNAME).get();
if (taken.exists && taken.data().uid !== UID) throw new Error("@" + USERNAME + " already belongs to a real account; not touching it");

try { await admin.auth().getUser(UID); }
catch { await admin.auth().createUser({ uid: UID, displayName: NAME }); }   // no email, no password: can't be signed in to

const now = admin.firestore.FieldValue.serverTimestamp();
await db.doc("usernames/" + USERNAME).set({ uid: UID });
await db.doc("profiles/" + UID).set({ username: USERNAME, createdAt: now, test: true }, { merge: true });
await db.doc("ages/" + UID).set({ is13plus: true, at: now }, { merge: true });
await db.doc("cards/" + UID).set({
  avatar: photo, name: NAME, bio: "Test account", show: "friends", theme: "field", title: "", banner: "", deco: "",
  sports: ["nfl"], favTeams: [{ lg: "nfl", id: "25", n: "San Francisco 49ers", a: "SF", l: "" }], favPlayers: [],
}, { merge: true });
console.log("Test account ready: @" + USERNAME + (photo ? " (with photo)" : ""));
