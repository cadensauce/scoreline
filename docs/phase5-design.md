# Phase 5 design: currency, picks, fantasy, shop (draft for approval)

The full research behind this, with sources, is `docs/research-legal-phase5.md` (sections 1–6). This doc is the
short version you approve. Not legal advice; items marked [lawyer] are worth a quick check before launch.

## Ground rules (keep it out of gambling law)
- The currency is earned only. It can never be bought (including "watch an ad for coins"), cashed out,
  transferred between users, or swapped for anything with real-world value. No real prizes.
- A pick costs nothing and stakes nothing. A zero balance never blocks playing.
- Words: Picks, Rewards, Win chance, Upset bonus. Never: bet, odds, wager, payout, jackpot, parlay, line.
- Washington State treated virtual chips as a "thing of value" in Kater v. Churchill Downs (players had bought
  them). Our design avoids that by never selling currency. [lawyer]

## Age rules
- Everything except picks, fantasy, currency and shop is open to all ages.
- Neutral month/year-of-birth screen when someone signs up (no default, no "I'm 13+" checkbox; remembers the
  answer so it can't be retried). We store only `is13plus: true/false`, never the date.
- Under 13: no account at all (email, username, photo, bio and chat are all personal info under COPPA). They can
  still use every scores feature with their teams saved on the device. The 13+ sections show a friendly
  "available at 13+" note. If we learn an existing account is under 13, we delete it.
- Enforced on the server: Firestore rules refuse picks/fantasy/shop writes unless `users/{uid}.is13plus == true`,
  and that field can only be set once.

## Infrastructure: stay free (Spark plan, no Cloud Functions)
- **Pick locking without a server clock problem:** the worker writes each game's `lockAt` (kickoff). Rules compare
  Firestore's own `request.time` with `lockAt`, so the phone's clock never matters and locking works even when
  the worker is between shifts.
- **Ledger:** `ledger/{uid}/entries/{id}` is append-only and written only by the worker (Admin SDK). Each
  settlement uses a fixed id like `pick_{pickId}` inside one batch that also updates the balance, so running it
  twice fails instead of paying twice. A nightly job checks every balance equals its ledger total.
- **Shop:** a purchase is one batch (deduct + add item) checked by rules with `getAfter`, so you can't spend
  what you don't have or buy the same item twice.
- **Rate limits:** a per-user `limits` doc with `lastActionAt`; rules reject writes faster than ~1 per second.
- **Tests:** Firestore emulator in GitHub Actions: double settlement, late pick, pick after lock with a faked phone
  clock, two simultaneous purchases, editing someone else's pick, editing your own balance (19 cases drafted).

## Data model (draft)
- `games/{lg_eventId}`: lockAt, status, winner, winChanceAtLock {home, away} (worker only).
- `picks/{uid_gameId}`: uid, gameId, side, createdAt, updatedAt; `reward` frozen at lock (worker writes it).
- `ledger/{uid}/entries/{entryId}`: amount, reason (pick | fantasy | shop | grant), refId, createdAt.
- `wallets/{uid}`: balance, updatedAt (worker or shop batch only).
- `shopItems/{itemId}` (public), `inventory/{uid}/items/{itemId}`.
- Fantasy: `fantasyLeagues/{id}` (mode: free | rewards), `rosters/{leagueId_uid}`, `fantasyScores/{leagueId}/weeks/{n}`.
- Flags: `public/flags` (picks, fantasy, currency, shop, highlights, logos, broadcast, injuries, weather, each data source).

## Reward formula (needs your choice: see PLAN.md question 9)
- Option 1, what the spec says: reward = round(10 / winChanceAtPick), capped 10–100. Underdogs pay more.
- Option 2, lower store-rating risk: fixed tiers shown as "Upset bonus": favourite 10, toss-up 15, underdog 25.
  Same idea, but it doesn't look like odds.

## App stores (Scoreline isn't on any store today; Android is an APK download)
- Apple (since July 2025): 4+, 9+, 13+, 16+, 18+. "Simulated gambling" frequent → 18+. Free pick'em with no stake
  can fit Apple's "Contests" (frequent → 13+) if it never looks like betting.
- Google Play: likely Teen / PEGI 12.
- Recommendation: answer the questionnaires honestly and accept 13+/Teen; don't hide picks from store builds.
