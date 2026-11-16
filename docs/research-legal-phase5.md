# Scoreline Phase 5 research: legal, store ratings, COPPA, architecture

Researched 2026-11-15. **This is not legal advice.** Lines marked **[LAWYER]** are points a lawyer (gaming/promotions and privacy) should confirm before launch. Quotes are kept short and attributed. Sources are listed in each section.

---

## 1. Gambling and sweepstakes law (US)

### Why a free, non-purchasable, non-cashable, non-transferable currency is the safe design

US state law generally treats something as an illegal lottery or gambling only when **all three** elements are present: **prize**, **chance**, and **consideration**. One commentator puts it this way: "If one of the elements is eliminated, the promotion is not a lottery" (Bernstein Shur). Here is how Scoreline's plan maps to each one:

| Element | Scoreline plan | Effect |
|---|---|---|
| **Consideration** (paying to play) | Picks and fantasy are free. The currency can't be bought, and nothing is staked or deducted to make a pick. | Removed. This is the strongest protection. |
| **Prize** (something of value won) | Points can't be cashed out, sold, transferred or traded, and only buy cosmetics inside the app. | Mostly removed, but see the Washington case below. |
| **Chance** | Game outcomes are mostly chance, with some skill. | Present. You can't remove it, so the other two elements must stay out. |

**The Washington trap (Kater v. Churchill Downs, 9th Cir. 2018).** The court held that virtual casino chips in Big Fish Casino were a "thing of value" under Washington's very broad statute, because the chips **extended gameplay**, even though they couldn't be cashed out. The players had **bought** the chips, so consideration was present. Scoreline avoids that if three things stay true:
- the currency can never be bought, directly or indirectly (no "watch an ad for coins", no paid bundle that includes coins, no paid subscription that boosts earnings);
- making picks never costs or risks currency (no staking, so no wager);
- running out of currency never stops anyone from playing. Picks stay free and unlimited no matter the balance.
**[LAWYER]** Washington has the broadest "thing of value" definition, so ask the lawyer to confirm the design against RCW 9.46.

### Words to avoid, and what to use instead
Avoid: **bet, wager, stake, odds, line, spread, parlay, sportsbook, bookie, cash out, payout, jackpot, casino, house, gamble, buy-in, chips, tokens (anything crypto-sounding), sweepstakes, prize, win money**.
Use: **pick, prediction, pick'em, confidence, points/XP/"Scoreline Coins" (cosmetic), reward, earned, leaderboard, streak, upset bonus, win chance (as a %)**. Show win probability as a percentage ("62% win chance"), not American odds (-163). Call the reward an "upset bonus", not a "payout".

Even with free play, a sportsbook-style screen (odds board, bet slip, "place bet" button) raises your app store rating and pulls regulators' attention.

### State-level points for free pick'em with no prizes
- **Paid daily fantasy sports (DFS) laws** (NY, MA, TN, VA and others) mostly regulate contests that charge an entry fee and award prizes. Free contests with no cash or real-world prizes usually fall outside them. **[LAWYER]**
- **Washington**: see the case above. Avoid anything that could look like value.
- **Social-casino litigation** (Kentucky, Washington) has gone after games where players **bought** currency. That doesn't fit your model, but keep it in mind if anyone ever proposes paid coin packs.
- **Real-world prizes change everything.** If Scoreline ever gives a gift card, merch or anything physical to a top picker, it becomes a contest or sweepstakes. That brings official rules, a free way to enter, bonding and registration (FL, NY), void-where-prohibited language, and Apple 5.3.1/5.3.2 rules. Leave it out of scope. **[LAWYER] if ever reconsidered.**
- **Do not link to sportsbooks or show sportsbook ads.** Google Play's policy says an app "must not provide simulated gambling content" if it is advertising real-money gambling.

### Recommended published rules text (draft)
"Scoreline Coins are free, for fun, and have no cash value. They can't be bought, sold, transferred, traded or exchanged for money, prizes or anything outside Scoreline. Picks never cost coins. We may adjust or reset balances to fix errors or abuse."

Sources:
- https://www.bernsteinshur.com/insights-events/sponsoring-sweepstakes-without-getting-swept-into-a-lawsuit/
- https://natlawreview.com/article/practical-guide-offering-online-contests-and-promotions
- https://law.justia.com/cases/federal/appellate-courts/ca9/16-35010/16-35010-2018-03-28.html (Kater v. Churchill Downs)
- https://www.fenwick.com/insights/publications/in-game-currency-triggers-state-gambling-laws-rendering-mobile-game-illegal-gambling
- https://support.google.com/googleplay/android-developer/answer/9877032 (Google Play real-money gambling and simulated gambling policy)

---

## 2. App store age ratings

### Apple (the new system, announced July 24, 2025)
- The tiers are now **4+, 9+, 13+, 16+ and 18+**. **12+ and 17+ were removed.**
- Apple defines Simulated Gambling as "Betting or wagering without using real money" (App Store Connect help).
- **13+**: "Infrequent simulated gambling". **18+**: "Frequent simulated gambling". Australia rates even infrequent simulated gambling **R 18+**, and Korea needs extra classification.
- **Contests**: "Infrequent contests" is **4+** and "Frequent contests" is **13+**. Apple's definition: "compete with one another for rankings, rewards". **This category is the better match for pick'em.**
- User-generated content and messaging (chat, profiles) are separate questionnaire items. Guideline 1.2 also requires a way to filter content, report it, block users, and published contact info.
- Guideline 5.3.3 bans in-app purchase "credit or currency" for real-money gaming. That doesn't apply here, because the currency is never sold.
- iPhone users currently get the website saved to the home screen, so **no Apple rating applies today**. Note that guideline 4.2 rejects apps that are a "repackaged website", which matters for a Tauri or WebView wrapper.

### Google Play (IARC questionnaire)
- The IARC questionnaire produces ratings from regional boards: ESRB (Americas), PEGI (Europe), USK and others. According to Google's help page, ESRB **Teen** content may include "simulated gambling", **PEGI 12** allows simulated gambling, and the generic IARC **12+** permits it. Anecdotally, some developers have been given **PEGI 16** for simulated gambling.
- Rating is required only for apps published on Play. Scoreline's GitHub-release APK doesn't need one yet.

### Would free pick'em with points count as simulated gambling?
- **It probably does not, if there's no stake.** Apple's definition is "betting or wagering". A wager means putting something at risk. If a pick costs nothing and a wrong pick loses nothing, it's a **prediction contest**, and you'd answer "Contests: frequent" (Apple 13+) and "No" to simulated gambling. **[Judgment call: the store reviewer decides.]**
- **Three things push it toward "simulated gambling"**: payouts scaled by odds (which looks like sportsbook pricing), wagering currency on a pick, and casino or sportsbook styling.
- **Ways to keep the rating low:**
  1. **Never deduct currency for a pick.** Award points only for correct picks.
  2. Present the probability-based bonus as a **difficulty or upset bonus**, with fixed tiers (for example a 10 / 15 / 25 point "upset tier" from the win chance at lock), not a continuous odds-times-stake payout.
  3. Show "win chance %" from the data provider, never odds formats.
  4. No casino visuals: no chips, slot or roulette art, "jackpot" animations, or loot boxes. **Never sell or award random cosmetic boxes.** Randomized rewards attract their own scrutiny (loot box rules in Belgium and the Netherlands, plus a separate IARC disclosure).
  5. **Option: picks only on the web.** The store build would hide picks, fantasy and the shop behind a remote flag (section 5), so the store listing could rate lower (4+ or 9+, depending on chat). The catch is reviewer scrutiny: features enabled remotely after review that change the rating are a policy risk on both stores. Google warns "Misrepresentation of your app's content may result in its removal". **Preferred: answer honestly and accept 13+ (Apple) / Teen (ESRB), which matches the 13+ age gate anyway.**
- The existing **friends and chat** features already push the rating up on both stores, and need report, block and filter tools to meet Apple 1.2.

### Upcoming app-store age laws (only matter once Scoreline is listed on a store)
- **Texas SB 2420** (App Store Accountability Act): blocked Dec 23, 2025. The **5th Circuit stayed that injunction on May 28, 2026**, so the law is in effect while the case continues, and a Supreme Court application was pending in June 2026. Utah and Louisiana have similar laws. Developers must use the store's age signals (Apple Declared Age Range, Google Play Age Signals). There's a good-faith safe harbor. **[LAWYER] check status before any store launch.**

Sources:
- https://developer.apple.com/help/app-store-connect/reference/age-ratings
- https://developer.apple.com/app-store/review/guidelines/ (1.2, 4.2, 5.1.1, 5.3)
- https://www.mactech.com/2025/07/25/apple-updates-age-ratings-in-its-various-app-stores
- https://support.google.com/googleplay/android-developer/answer/188189 (Play content ratings, IARC)
- https://support.google.com/googleplay/answer/6209544 (rating meanings)
- https://www.mofo.com/resources/insights/251111-texas-targets-app-stores-with-new-accountability-law
- https://fpf.org/blog/comparing-enacted-app-store-accountability-acts/

---

## 3. COPPA (amended rule: in effect June 23, 2025; compliance required by April 22, 2026)

### Classification
Scoreline is a **general-audience** sports site, and some kids using it doesn't change that. The FTC staff FAQ says a general-audience site "does not become 'mixed audience'" just because some children use it. COPPA applies when you have **actual knowledge** that a user is under 13. A neutral age screen creates that knowledge, so you have to act on the answer. **[LAWYER]** Sports content, cartoon-style mascots or kid-focused marketing can push a site toward "directed to children". Keep branding and ads aimed at a general audience.

### Neutral age screen (from the FTC FAQ, sections D.7 and H.3)
- Ask for **month and year of birth**, left blank with no default. The FAQ example is a user who can "freely to enter month and year of birth".
- **Not acceptable**: a pre-filled date, a default of 13 or older, a checkbox like "I am over 12", or text that tells users what age unlocks the feature.
- Set a cookie or localStorage flag so a child can't press back and enter a different age. The FAQ suggests "such as a cookie".
- The amended rule says age collection must be neutral and must not default to a set age.

### Store as little as possible
- Calculate the age on the device and **store only `is13plus: true|false` and `screenedAt`** (server time). Throw away the date of birth. Write it once to an **immutable** document (see the rules below) so a user can't flip it later. Also save it in localStorage so the screen isn't shown again on that device.

### When a user enters under 13 (the simplest compliant path, with no parental consent flow)
On a general-audience site you **may block** under-13s from features (FAQ H.3). Recommended setup:
1. **No account.** Email and password, Google sign-in, username, friends, chat, photo and bio all collect personal information. An email address is "online contact information", and a username that lets people message you works like one. Without verifiable parental consent you can't collect these from a known under-13 user. Show: "Sorry, accounts and Picks are for ages 13+. You can still follow scores and teams on this device."
2. **They can still use the scores site anonymously**, with favourites kept **only in localStorage** and nothing sent to the server tied to them.
3. **If an existing account holder enters under 13** (for example at a later age screen when Picks launch): don't just hide the 13+ features. COPPA requires either parental consent or **deleting** the child's information (FAQ H.6: "meet COPPA's notice and parental consent requirements or delete"). Delete the profile, username, friends, chats, picks and Auth record, and tell the user.
4. **Analytics and identifiers**: persistent identifiers (cookies, device IDs, IP) count as personal information unless used only for "support for the internal operations". That exception includes site analytics and "statistical reporting" (FAQ J.5 and J.7) but **not behavioral advertising** (J.8). For under-13 users: no ad SDKs, no cross-site tracking, no ad identifiers. First-party aggregate analytics with no profiling is fine. **Push alerts** for a team the child picked probably count as internal operations (fulfilling the user's own request). **[LAWYER]**
5. The 2025 amendments also require a **written information security program** and a **data retention policy** (keep data only as long as needed). These are worth writing anyway.

### Account deletion (needed for store listing, and good practice now)
- **Apple 5.1.1(v)**: "If your app supports account creation, you must also offer account deletion within the app."
- **Google Play**: an **in-app** deletion path **plus a public web link** where users can request deletion, for example `/delete-account` or a section of the privacy page. Deleting an account must delete the data linked to it. Anything kept (for example ledger rows kept for abuse investigations) must be disclosed in the privacy policy, and the Data safety form must answer the deletion questions.
- Scoreline deletion list: Auth user, `users/`, `profiles/`, `usernames/`, `requests/`, chats and messages they sent, `picks/`, `wallets/`, `ledger/` (or anonymize it), `inventory/`, `ageGate/`, the profile photo in Storage, and `pushSubs` linked to the user. The Admin worker can handle this from a `deletionRequests/{uid}` doc, because the client can't delete other people's chat docs or ledger rows.

### Privacy policy must cover
What you collect (email, username, photo, bio, picks, favourites, push endpoint, approximate country if region gating is used), why, who processes it (Google/Firebase, GitHub, Cloudflare if added), how long you keep it, how to delete it, the age policy ("not for under 13; if we learn we collected a child's data we delete it"), contact info, and the effective date. Link it in the app, on the site, and on any store listing (Apple 5.1.1(i): "All apps must include a link to their privacy policy"). State laws (CCPA/CPRA and others) mostly start at revenue or user thresholds that a free hobby site won't reach, but teen-specific laws are expanding (for example California's Age-Appropriate Design Code, partly enjoined). **[LAWYER]**

Sources:
- https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions (sections A.1, D.4–D.7, H.1–H.6, J.5–J.8)
- https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule
- https://www.lw.com/en/insights/2025/05/ftc-publishes-updates-to-coppa-rule
- https://fpf.org/blog/ftc-updates-coppa-faqs/
- https://support.google.com/googleplay/android-developer/answer/13327111 (Play account deletion)
- https://developer.apple.com/app-store/review/guidelines/ (5.1.1)

---

## 4. Phase 5 architecture on free infrastructure (Spark, no Cloud Functions)

### Key ideas
1. **Lock time comes from the server clock, not the client.** Security rules compare `request.time` (Google's clock) with `games/{gameId}.lockAt`. Only the Admin worker writes `lockAt`. Locking therefore works even when the GitHub Actions worker is between shifts, because rules don't need the worker running.
2. **Clients can only write their own picks, only before lock, and only allowed fields.** Settlement fields are written by the Admin SDK, which bypasses rules. Clients can never touch them, because rules limit which keys they may change.
3. **The balance comes from an append-only ledger.** Ledger entries for winnings are created only by the worker. Each entry's ID is fixed by what it's for (`pick_{pickId}`, `buy_{uid}_{itemId}`). A batch that **`create()`s** the ledger doc and **`increment()`s** the balance is atomic: if the ledger doc already exists, the whole batch fails, so **double payout is impossible** even if the worker crashes and reruns.
4. **Freeze the reward at lock time.** When the game locks, the worker records `winProbAtLock` and `rewardHome` / `rewardAway` points on the game doc. Everyone who picked a side gets the same reward. Clients never send a probability, so nobody can pick early at a stale price.
5. **Shop purchases go through rules**, so they're instant without the worker. A single batch that lowers the balance by the item's price, creates `inventory/{uid}/items/{itemId}`, and creates a `buy_` ledger doc is checked with `getAfter()`. Cosmetics are one-time purchases, so the inventory doc ID is unique per item. A nightly worker job checks that `balance == sum(ledger.amount)` and flags any mismatch.

### Draft data model
```
games/{gameId}                 // Admin worker only
  sport, league, homeId, awayId, startAt: timestamp,
  lockAt: timestamp,           // = startAt (or startAt - 5 min); worker may move it for postponements
  status: 'scheduled'|'live'|'final'|'postponed'|'cancelled',
  winProbHome: number,         // live, informational
  rewardHome, rewardAway: int, // frozen at lock
  winner: 'home'|'away'|'tie'|null, settledAt: timestamp|null

ageGate/{uid}                  // client create-once, immutable
  is13plus: bool, at: timestamp (== request.time)

picks/{uid}_{gameId}           // owner create/update/delete before lock
  uid, gameId, side: 'home'|'away', createdAt, updatedAt,
  // written only by the worker after settlement:
  result: 'won'|'lost'|'void', reward: int, settledAt

wallets/{uid}                  // Admin increments; client may only decrease via shop batch
  balance: int, lifetimeEarned: int, updatedAt

ledger/{entryId}               // append-only; never updated or deleted by clients
  uid, amount: int (+/-), reason: 'pick'|'buy'|'fantasy'|'adjust'|'signup',
  ref: pickId|itemId, at: timestamp
  // entryId: pick_{pickId} | buy_{uid}_{itemId} | fantasy_{leagueId}_{week}_{uid} | adjust_{uuid}

shop/{itemId}                  // Admin only; public read
  name, kind: 'frame'|'badge'|'theme'|'banner', sport: 'all'|'nfl'|..., price: int, active: bool

inventory/{uid}/items/{itemId} // created only together with a matching buy_ ledger + wallet debit
  at: timestamp

rate/{uid}                     // per-user throttle doc
  lastAt: timestamp

leaderboards/{sport}_{season}  // Admin-computed, public read (small, cheap to read)

deletionRequests/{uid}         // client creates; worker deletes everything, then this doc
public/flags                   // see section 5
```

### Draft `firestore.rules` additions (an untested sketch, to merge into the existing file)
```
// --- helpers (inside match /databases/{database}/documents) ---
function doc(p) { return /databases/$(database)/documents/$(p); }
function teen() {
  return signedIn() && get(doc('ageGate/' + me())).data.is13plus == true;
}
function gameOf(gid) { return get(doc('games/' + gid)).data; }
function open(gid) {
  let g = gameOf(gid);
  return g.status == 'scheduled' && request.time < g.lockAt;
}
// 1 write per 2s per user: the batch must also set rate/{uid}.lastAt = request.time
function throttled() {
  let before = get(doc('rate/' + me()));
  return getAfter(doc('rate/' + me())).data.lastAt == request.time
    && (before == null || request.time > before.data.lastAt + duration.value(2, 's'));
}

match /games/{gid}       { allow read: if true; allow write: if false; }
match /shop/{itemId}     { allow read: if true; allow write: if false; }
match /leaderboards/{id} { allow read: if true; allow write: if false; }

match /ageGate/{uid} {
  allow read: if signedIn() && me() == uid;
  allow create: if signedIn() && me() == uid
    && request.resource.data.keys().hasOnly(['is13plus', 'at'])
    && request.resource.data.is13plus is bool
    && request.resource.data.at == request.time;
  allow update, delete: if false;          // immutable; worker handles account deletion
}

match /rate/{uid} {
  allow read: if signedIn() && me() == uid;
  allow create, update: if signedIn() && me() == uid
    && request.resource.data.keys().hasOnly(['lastAt'])
    && request.resource.data.lastAt == request.time;
}

match /picks/{pickId} {
  allow read: if signedIn() && resource.data.uid == me();   // widen to friends after lock if wanted
  allow create: if teen()
    && pickId == me() + '_' + request.resource.data.gameId
    && request.resource.data.keys().hasOnly(['uid', 'gameId', 'side', 'createdAt', 'updatedAt'])
    && request.resource.data.uid == me()
    && request.resource.data.side in ['home', 'away']
    && request.resource.data.createdAt == request.time
    && request.resource.data.updatedAt == request.time
    && open(request.resource.data.gameId)
    && throttled();
  allow update: if teen() && resource.data.uid == me()
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['side', 'updatedAt'])
    && request.resource.data.side in ['home', 'away']
    && request.resource.data.updatedAt == request.time
    && open(resource.data.gameId)
    && throttled();
  allow delete: if teen() && resource.data.uid == me() && open(resource.data.gameId);
}

match /wallets/{uid} {
  allow read: if signedIn() && me() == uid;
  allow create, delete: if false;          // worker creates on first earn / signup bonus
  // Only change allowed from a client: a shop purchase in the same batch.
  allow update: if teen() && me() == uid
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['balance', 'updatedAt'])
    && request.resource.data.updatedAt == request.time
    && request.resource.data.balance >= 0
    && request.resource.data.balance < resource.data.balance;   // can only go down here
}

match /ledger/{entryId} {
  allow read: if signedIn() && resource.data.uid == me();
  allow update, delete: if false;          // append-only
  // Client may create ONLY a purchase entry that matches a real debit + inventory grant.
  allow create: if teen()
    && entryId == 'buy_' + me() + '_' + request.resource.data.ref
    && request.resource.data.keys().hasOnly(['uid', 'amount', 'reason', 'ref', 'at'])
    && request.resource.data.uid == me()
    && request.resource.data.reason == 'buy'
    && request.resource.data.at == request.time
    && get(doc('shop/' + request.resource.data.ref)).data.active == true
    && request.resource.data.amount == -get(doc('shop/' + request.resource.data.ref)).data.price
    && getAfter(doc('wallets/' + me())).data.balance
         == get(doc('wallets/' + me())).data.balance + request.resource.data.amount
    && existsAfter(doc('inventory/' + me() + '/items/' + request.resource.data.ref));
}

match /inventory/{uid}/items/{itemId} {
  allow read: if signedIn();               // cosmetics are visible on profiles
  allow update, delete: if false;
  allow create: if teen() && me() == uid
    && request.resource.data.keys().hasOnly(['at'])
    && request.resource.data.at == request.time
    && existsAfter(doc('ledger/buy_' + uid + '_' + itemId))
    && !exists(doc('ledger/buy_' + uid + '_' + itemId));
}
```
Notes on the sketch:
- The wallet rule on its own would let a user lower their own balance freely. That's harmless (they only hurt themselves), but you can tighten it by also requiring `existsAfter(ledger/buy_...)`. The client can't pass the item ID to the wallet rule, though, so the ledger and inventory rules carry the binding. The worker's nightly reconciliation catches any drift.
- Every `get` / `exists` / `getAfter` in a rule **counts as a billed document read**. Rules are limited to 10 document-access calls for a single write and 20 for a batch or transaction. The shop batch above uses about 8 to 10.
- The rules have no rate limiting by IP. The `throttled()` pattern comes from a community recipe (Fireship), not from Firebase docs.
- Use App Check (reCAPTCHA v3/Enterprise on the web, Play Integrity on Android) to block scripted clients. **Check the current free-tier limits.**

### Worker settlement (Admin SDK, pseudocode)
```js
// for each game where status == 'final' && settledAt == null:
for (const pick of picksForGame) {
  const won = pick.side === game.winner;
  const reward = won ? (pick.side === 'home' ? game.rewardHome : game.rewardAway) : 0;
  const b = db.batch();
  if (reward > 0) {
    b.create(db.doc(`ledger/pick_${pick.id}`), { uid: pick.uid, amount: reward, reason: 'pick', ref: pick.id, at: FieldValue.serverTimestamp() });
    b.set(db.doc(`wallets/${pick.uid}`), { balance: FieldValue.increment(reward), lifetimeEarned: FieldValue.increment(reward), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  b.update(db.doc(`picks/${pick.id}`), { result: won ? 'won' : 'lost', reward, settledAt: FieldValue.serverTimestamp() });
  try { await b.commit(); } catch (e) { if (e.code !== 6 /* ALREADY_EXISTS */) throw e; } // already paid -> skip
}
// then mark game settledAt; a rerun is safe because create() on the existing ledger doc fails the batch
```
Cancelled or postponed games: mark picks `void` with no ledger entry. Ties: `void`, or a sport-specific rule. A **stat-correction reversal** gets a separate `adjust_{uuid}` entry and never edits an existing one.

### Spark (no Functions) vs Blaze
| | Spark + worker (current) | Blaze + Cloud Functions |
|---|---|---|
| Cost | $0, no card | No-cost quotas still apply (Firestore 50K reads / 20K writes / 20K deletes a day, 1 GiB; Functions 2M invocations a month), then pay as you go |
| Card | Not needed | **Billing account with a card required** |
| Runaway bill risk | None (it just stops at quota) | Real. Alert-only budgets "don't automatically cap" spending (Google Cloud docs). Newer spend-cap budgets exist for *eligible* services, so check whether Firestore and Functions qualify. A read flood (bot or bug) could cost money. |
| Server-side logic | Rules plus a worker that only runs while a shift is active | Callable or triggered functions. Settlement happens on `onDocumentUpdated(games)`, purchases through a callable, scheduled functions replace Actions. |
| Rule complexity | Higher (getAfter batches) | Lower (logic lives in trusted code) |
| Other | **GitHub Actions terms say not to use Actions "as part of a serverless application"** or for work unrelated to the repo's software project. A 24/7 worker on Actions carries a ToS risk. **[CHECK]** | Moves the worker off Actions entirely |

**Recommendation:** stay on Spark for Phase 5. Rule-based locking plus idempotent worker settlement covers what's needed, and settlement can wait for the next worker shift. Move to Blaze only if a server-side callable becomes truly necessary. If you do, set budget alerts, look into a spend-cap budget, enable App Check enforcement, and keep reads bounded with `limit()`. Plan a home for the always-on worker that's allowed by its provider's terms (for example a free VM tier, Cloudflare Workers cron, or Blaze scheduled functions).

### Test plan (Firestore emulator in GitHub Actions)
Setup: `actions/setup-java@v4` with **Java 21** (recent firebase-tools releases dropped emulator support for Java versions before 21; older docs still say 11+), `actions/setup-node`, `npm i -D firebase-tools @firebase/rules-unit-testing vitest`, then `npx firebase emulators:exec --only firestore "npx vitest run"`. Add a `firebase.json` with the emulator config and point it at `firestore.rules`. The emulator lets tests control document data but not `request.time`, so build lock cases with `lockAt` set relative to the real clock (for example now + 1h, or now − 1s).

| # | Case | Expected |
|---|---|---|
| R1 | Pick created with `lockAt` = now + 1h, by a teen | allowed |
| R2 | Pick created with `lockAt` = now − 1s (late pick) | **denied** |
| R3 | Pick updated or deleted after lock | **denied** |
| R4 | Pick with extra field `reward`/`result`, or `uid` = another user, or ID that doesn't match uid_gameId | **denied** |
| R5 | `createdAt` sent as a client timestamp instead of `serverTimestamp()` | **denied** |
| R6 | User with no ageGate doc, or `is13plus:false` | **denied** for picks, shop and wallet |
| R7 | ageGate update or delete (trying to flip age) | **denied** |
| R8 | Client writes to `ledger` with reason `pick`, or with a positive amount | **denied** |
| R9 | Client raises `wallets.balance` | **denied** |
| R10 | Shop batch with correct price | allowed. With the wrong price, a missing inventory doc, or an inactive item: **denied** |
| R11 | Buying the same item twice | second batch **denied** (ledger ID already exists) |
| R12 | Two picks within 2 s (throttle) | second **denied** |
| R13 | Reading another user's wallet, ledger or picks | **denied** |
| S1 | Settlement run twice on the same game (Admin SDK against the emulator) | balance credited **once**, one ledger doc |
| S2 | Settlement killed halfway, then rerun | final balance equals the sum of rewards, with no duplicates |
| S3 | Two workers settling at the same time (`Promise.all` over the same picks) | exactly one ledger doc per pick |
| S4 | Reconciliation: `balance == Σ ledger.amount` for all users after S1–S3 | holds |
| S5 | Postponed game (lockAt moved later, status `postponed`) | picks void, nothing paid. Picks reopen only if the worker resets status to `scheduled`. |
| C1 | Race: client update at T = lockAt − 50 ms versus the worker freezing rewards | the pick either lands before lock or is denied, never half-applied (check by the final doc state) |

Sources:
- https://firebase.google.com/pricing
- https://firebase.google.com/docs/firestore/security/rules-conditions
- https://firebase.google.com/docs/reference/rules/rules.firestore (`getAfter`, `existsAfter`)
- https://firebase.google.com/docs/firestore/quotas (rules access-call limits)
- https://fireship.io/lessons/how-to-rate-limit-writes-firestore (rate-limit pattern)
- https://docs.cloud.google.com/billing/docs/how-to/budgets
- https://firebase.google.com/docs/emulator-suite/install_and_configure
- https://github.com/firebase/firebase-tools/pull/9602 (Java 21 requirement)
- https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features (Actions use limits)

---

## 5. Feature flags and region gating without paid infrastructure

### Flags
- Use `public/flags` (the existing rules already make `public/*` world-readable and admin-write-only):
  ```
  { picks: { enabled: true, web: true, android: true, minAppVersion: "1.4.0" },
    fantasy: { enabled: false }, shop: { enabled: false },
    killSwitch: { picksWrites: false },        // instantly freeze new picks
    regions: { picksBlocked: ["XX"] },          // ISO country codes
    updatedAt }
  ```
- Read it once at startup, cache it in localStorage with a timestamp, and fall back to safe defaults (feature **off**) if the read fails. One read per session fits easily inside the 50K/day quota for a small user base. Use `getDoc`, not a live listener, to save reads.
- **Enforce on the server too.** Flags are only UI hints. For a hard stop, rules should read the flag, for example adding `&& !get(doc('public/flags')).data.killSwitch.picksWrites` to pick creates. That costs one more billed read per write.
- Admin edits come from the Firebase console or a small worker script.

### Region gating (only needed if you decide to exclude certain places)
A static GitHub Pages site can't see request headers, so the options are:
1. **Cloudflare in front of a custom domain** (section 6). Then either (a) fetch `/cdn-cgi/trace`, which every Cloudflare-proxied hostname serves and which includes a `loc=` country line, or (b) a free **Cloudflare Worker** that returns `request.cf.country`, "the same value as … CF-IPCountry". The free plan allows 100,000 requests a day and 1,000 a minute. Option (b) is the official path; (a) is undocumented for app use and could change.
2. **A free geo-IP API** (ipapi.co, ip-api.com, ipinfo lite and others) called from the browser. Downsides: it sends the user's IP to a third party (list it in the privacy policy), has rate limits, some free tiers forbid commercial or HTTPS use, and ad blockers often block it.
3. **Self-declared region** ("I'm in: [state/country]") plus terms of service. Weakest, but needs zero data.
- **Privacy:** use the country only in memory and don't store it or attach it to the user. Treat IP geolocation as best-effort, since VPNs get around it. For a free, no-prize product, region gating is a **courtesy**, not a legal need, unless the lawyer says otherwise. If it becomes legally required, client-side gating isn't enough on its own. **[LAWYER]**

Sources:
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/examples/country-code-redirect/

---

## 6. Edge and DDoS protection for a GitHub Pages site

What's realistic:
- **GitHub Pages already sits behind Fastly's CDN.** Static files are cached at the edge and GitHub absorbs volumetric attacks on `*.github.io`. GitHub may return HTTP **429** when rate limits trip. Soft limits are **100 GB a month** of bandwidth and **10 builds an hour** (custom Actions deploys are exempt). The GitHub docs suggest putting "a third-party content distribution network (CDN)" in front if you go over.
- **The real attack surface isn't Pages, it's Firebase.** A bot can sign up and hammer Firestore reads and writes directly with your public config. On Spark that hits the daily quota and **takes the feature down** for the rest of the day (no bill, but an outage). On Blaze it **costs money**. A CDN in front of Pages does nothing for this. The mitigations are **App Check** enforcement, tight rules (owner-only reads, `limit()` on queries, no open collection scans), the throttle doc, and email verification before Picks.
- **Cloudflare Free in front of a custom domain** (requires buying a domain, about $10–15 a year): gives unmetered DDoS mitigation, a WAF with free managed rules, Bot Fight Mode, rate-limiting rules (limited on free), caching, and `CF-IPCountry` for region gating. Gotchas: GitHub's Let's Encrypt certificate issuance and renewal need **DNS-only (grey cloud)** to work. Common practice is to issue the certificate first, then turn on the proxy with SSL mode **Full** (reports vary on Full (strict), and renewal may fail while proxied). Alternatively, rely on Cloudflare's edge certificate and accept that GitHub's "Enforce HTTPS" option may grey out. **The Android app and push setup must point at the new domain**, and existing `github.io` URLs need a redirect plan.
- **Verdict:** for a free fan site, the default GitHub Pages and Fastly setup is enough for static content. Cloudflare is worth it mainly if you get a custom domain anyway (branding, a stable URL for store listings, region headers). Put the effort into **App Check plus rules**, which protect the part that can actually break.

Sources:
- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- https://github.blog/news-insights/product-news/github-pages-custom-domains-https/
- https://community.letsencrypt.org/t/fyi-for-github-pages-or-vercel-netlify-with-cloudflare/231054
- https://dev.to/abhisheknigam/solve-unable-to-enforce-https-for-github-pages-site-30mn

---

## Open items for a lawyer
1. Confirm the no-purchase, no-stake, non-cashable currency avoids "thing of value" under Washington's RCW 9.46 and similar broad state statutes.
2. Confirm free pick'em and free fantasy with cosmetic-only rewards fall outside state DFS statutes.
3. Confirm Scoreline is a general-audience service, not "directed to children", and that the under-13 handling (no account, deletion when you learn a user is under 13, push as internal operations) meets the amended COPPA rule.
4. Check the status of Texas, Utah and Louisiana app-store age laws and California teen-privacy laws before any store launch.
5. Review the privacy policy, terms of service, and coin rules text.
