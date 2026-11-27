# Scoreline — legal and security review (2026-11-27)

Not legal advice. This is a careful plain-English check of where a free fan app like Scoreline could get into
trouble, and what we do about it. For anything serious (a letter from a league, a company or a lawyer), talk to a
real lawyer before answering.

## Biggest risks, most serious first

| # | What | Risk | What we do / recommend |
|---|------|------|------------------------|
| 1 | **Player headshots** (photos from ESPN's servers) | **High.** The photos are owned by ESPN/photo agencies, and players' faces are licensed through their players' unions. Showing them in an app is the most common reason fan apps get takedown letters. | **Recommend removing** and showing a jersey-number / initials badge instead (owner decision pending). |
| 2 | **Team logos** (from ESPN's servers) | **High-ish.** Logos are trademarks of the leagues and teams. | **Recommend replacing** with team-colour badges with the abbreviation (like "CIN" in a coloured circle) — new Buzz and Leaders already do this. Owner decision pending. |
| 3 | **ESPN's data feeds** (scores, plays, news, moves) | **Medium.** These are ESPN's unofficial public feeds, not a licensed API. Free, non-commercial use with credit is common, but ESPN could block us or ask us to stop. | Keep it non-commercial, keep the "not affiliated" notice and "Data from ESPN" credit, never use ESPN's name or logo as branding, and stop at once if ever asked. A fully safe route is a licensed data provider (paid). |
| 4 | **Under-13 users** (COPPA, US law) | **High if it happens.** Collecting an email from a child under 13 needs verified parent consent. Right now anyone can make an account; "13 or older" only unlocks Marks. | **Recommend: accounts are 13+ only** (age question at sign-up; under 13 can still use scores without an account). Owner decision pending. |
| 5 | **News text** | **Low-medium.** Headlines are short facts; the one-line summaries are ESPN's words. No news photos are shown. Every story links to its source. | Keep it short + linked. Never copy full articles or photos. |
| 6 | **Chat / profiles** (things users post) | **Medium.** We're responsible for acting on reports. | Done: chat rules users agree to, friends-only DMs, group invites need a yes, Block, Report, reports reviewed by Owner/Mods, link warnings, site switch to pause chat. |
| 7 | **Marks, Picks, Fantasy** | **Low as built.** Not gambling because Marks can't be bought, sold, traded or cashed out. | **Never** add: buying Marks, prizes with real value, random "player packs" you pay Marks for that feel like loot boxes, or "over/under markets" with anything of value. Feature requests for "NBA player packs" and "o/u markets" are on hold for this reason. |
| 8 | **Weather** | Low. Open-Meteo is free with credit. | Credit shown on forecasts and past weather. |
| 9 | **"Formula 1", "NFL" etc. names** | Low. Using names to say what the scores are about is normal. | No league logos; "not affiliated" notice stays. |

## Security

- **DDoS / overload.** The website itself is static files served by GitHub Pages through a big CDN (Fastly), which
  absorbs attacks far bigger than anyone would aim at a fan app. Scores load from ESPN straight to each phone, so there
  is no Scoreline server to knock over. The database (Firebase) is on the free plan: if someone floods it, it hits the
  daily free limit and pauses until the next day — **there is no surprise bill**. App Check (invisible reCAPTCHA) blocks
  most bots from the database.
- **Database rules** decide what each signed-in person may read or write (friends-only chats, owner-only roles,
  tamper-proof reaction counts, Marks only from the worker, etc.), with ~150 automatic tests run on every change.
- **Site switch (new).** The Owner can put the site in **read-only** (new messages, friend requests and reactions are
  blocked by the database itself; reports still work) or **offline** (everyone sees a "short break" page) from
  Dev tools, and switch back any time.
- **Why not "delete all user data if someone breaks in"?** We deliberately did *not* build that: it would destroy
  everyone's accounts, chats and Marks; an attacker could trigger it on purpose to wipe the app; and it can't un-leak
  anything already seen. The safe pattern is: pause (site switch / lock the rules in the Firebase console), fix,
  restore from a backup, tell users.
- **Backups.** The free Firebase plan can't do automatic exports. Option: a nightly job (in GitHub Actions) that saves an
  **encrypted** copy of the database that only the Owner can open. It needs one secret key the Owner creates
  (`BACKUP_KEY` in GitHub → Settings → Secrets). Pending the Owner's OK.
- **If something does go wrong:** 1) Dev tools → Site switch → Offline; 2) in the Firebase console, publish rules that
  deny all writes; 3) change the Firebase service-account key; 4) restore from the backup; 5) post a short note.
