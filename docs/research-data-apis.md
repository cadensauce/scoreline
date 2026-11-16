# Scoreline: data API research

Researched 2026-11-15. Scoreline is a free, non-commercial fan site and Android app: a static GitHub Pages site, a Firebase Spark backend and a GitHub Actions worker.

How the facts were checked:
- **Verified live:** I called ESPN, Open-Meteo, Jolpica, OpenF1 and YouTube RSS from a script with an `Origin:` header, and checked the CORS header and the field names in each response.
- **Quoted terms:** Quotes come from the official terms pages linked with them. Each quote is under 15 words.
- **Unverified:** Anything marked *(unverified)* came from secondary sources or from memory and needs checking before you rely on it.

---

## 1. Kick ball location (FG/XP left-right and height) and punt/kickoff spots

| Source | What it has | Cost | License / notes |
|---|---|---|---|
| **ESPN core plays** `sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/{id}/competitions/{id}/plays?limit=400` | Each play has `start` and `end` (`yardLine`, `yardsToEndzone`, `down`, `distance`, `possessionText`), `statYardage`, `type.text`, `text`, `participants[].type` (`kicker`, `punter`, …) and `probability`. **No lateral position or height.** | Free | Unofficial (see §11). CORS `*` (verified). |
| ESPN play `text` | Gives the miss direction ("No Good, Wide Right", "Hit Left Upright", "Short", "BLOCKED"), the punt landing spot ("punts 57 yards to DET 3"), the kickoff landing spot ("kicks 64 yards from DET 35 to NE 1") and the returner and return end ("C.Kiner to NE 25"). | Free | Has to be parsed with a regex. |
| **nflverse / nflfastR pbp** | `field_goal_result` (made/missed/blocked), `kick_distance`, `extra_point_result`, `return_yards`, `punt_fair_catch`, `punt_inside_twenty`, `kickoff_in_endzone`, `desc` (same wording as the NFL's own play text). **No ball coordinates**, which confirms what you thought: only the result and distance. | Free | Data is CC-BY 4.0 (FTN charting is CC-BY-SA 4.0). Releases are files on GitHub, so it's a backfill source, not a live one. |
| NFL Next Gen Stats | Ball and player tracking exist, but only aggregates are public, and there's no FG crossing-point feed. | No public API | Research papers say raw tracking data "is not publicly available" ([arXiv 1906.03339](https://arxiv.org/abs/1906.03339)). |
| Sportradar NFL | Play detail includes `hash_mark` ("Left Hash") and field-goal start and end details ([NFL FAQ](https://developer.sportradar.com/football/reference/nfl-faq)). I couldn't confirm a crossing point at the uprights. | Quote-based enterprise contract (no public price) *(secondary sources)* | Trial keys aren't for production display. |
| SportsDataIO | Scores, stats and play-by-play. No kick coordinates that I could find. | The trial has **scrambled** values ±5–20% ([help](https://sportsdata.io/help/scrambled-data)). Paid plans are about $99+/mo *(secondary sources)*. | The trial is "not licensed for commercial redistribution". |

**Recommendation:** No free source has the true crossing point (left-right offset and height). Build the kick visual from ESPN: distance from `start.yardsToEndzone + 17` (or `statYardage`), the result and a coarse direction parsed from `text` (wide left or right, short, upright, blocked). Draw it as a stylized arc, not a measured spot. Punts and kickoffs work fully from ESPN:
- Kick spot: `start.yardLine`.
- Landing or fielded spot: parsed from `text` ("to NE 1").
- Return end: `end.yardLine`.
- Touchback or fair catch: from `text`.

The same approach works for CFB because ESPN CFB plays have the same shape.

## 2. Historical play-by-play for training and backtesting win probability

| Sport | Source | Cost / limits | License | Notes |
|---|---|---|---|---|
| NFL | **nflverse pbp** (`load_pbp()`, or the parquet/CSV files under GitHub releases in `nflverse/nflverse-data`) | Free, 1999 to now. Updated nightly; Thursday is the cleanest pull ([schedule](https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html)). | Data CC-BY 4.0, code MIT. Their docs note NFL data "belong to their respective owners". | Includes `wp`, `ep`, `vegas_wp`, so it's an ideal baseline to backtest against. |
| CFB | **CollegeFootballData.com API** (key required, free by email) | Free: **1,000 calls/mo**. Patreon: $1 = 5k, $5 = 30k, $10 = 75k … $30 = 500k ([tiers](https://collegefootballdata.com/api-tiers)). | "Commercial use is permitted." You may show "reasonable portions of factual API Data as part of a larger product". No standalone or bulk redistribution. Attribution is optional ([terms](https://collegefootballdata.com/terms)). | **Don't put the key in browser code.** The terms forbid embedding it "in a public repository, browser bundle". Use it only in the GitHub Actions worker. |
| CFB | cfbfastR / sportsdataverse data releases | Free (files on GitHub) | Code MIT. The data falls under CFBD's terms. | Simplest way to backfill pbp in bulk for training. |
| NBA | ESPN `site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event={id}` (`plays`) or the hoopR / sportsdataverse releases | Free | ESPN is unofficial. hoopR code is MIT. | Recommended, and consistent with what you already use. |
| NBA | nba_api → stats.nba.com | Free | MIT covers the client only. NBA.com [terms](https://nba.com/termsofuse) apply. | **No CORS for browsers.** Reports say Akamai blocks datacenter IPs, which could include GitHub Actions *(unverified)*. It's undocumented and unstable. Avoid it for production. |
| NBA | pbpstats.com | Free *(unverified)* | Terms not found | Skip. |
| F1 | **OpenF1** `api.openf1.org/v1/...` | Historical data from 2023 on is free. Free tier: **3 req/s, 30 req/min**. Live data needs the Sponsor tier at **€9.90/mo** ([openf1.org](https://openf1.org/)). | CC BY-NC-SA 4.0, for "non-commercial fan purposes". | CORS `*` (verified). |
| F1 | **Jolpica-F1** (Ergast replacement) `api.jolpi.ca/ergast/f1/...` | Free, unauthenticated: **4 req/s burst, 500 req/hour** ([rate limits](https://github.com/jolpica/jolpica-f1/blob/main/docs/rate_limits.md)) | Data CC BY-NC-SA 4.0. Free for "non-commercial use" ([TERMS](https://github.com/jolpica/jolpica-f1/blob/main/TERMS.md)). | CORS `*` (verified). Results, laps and pit stops go back to 1950. |
| F1 | FastF1 (Python) | Free | MIT. Unofficial and "not associated in any way with the Formula 1 companies". | Worker or offline only. It wraps F1 live timing and Jolpica. Good for building training sets. |
| MLB *(parity)* | Retrosheet event files or MLB StatsAPI `statsapi.mlb.com` | Free | Retrosheet allows free use if you include its copyright notice *(unverified wording)*. MLB StatsAPI has MLB's copyright notice, which limits use to non-commercial individual use *(unverified)*. | Or keep using ESPN MLB summaries. |

**Recommendation:** Train offline in the worker or locally on nflverse (NFL), the cfbfastR releases (CFB), the hoopR/ESPN releases (NBA), Jolpica plus OpenF1 (F1) and Retrosheet (MLB). Ship only the model coefficients as static JSON. Credit nflverse, CFBD and Jolpica/OpenF1 on an About page. The CC BY-NC-SA terms are satisfied because Scoreline is non-commercial.

## 3. Standings, playoff seeds, clinch status and rankings

All of these were verified against live responses.

- **ESPN standings** `site.api.espn.com/apis/v2/sports/{sport}/{league}/standings` (add `?season=YYYY` for past years). Each entry has `stats[]`:
  - **NFL:** includes `playoffSeed`, `clincher` (`z` Clinched Division, `y` Clinched Wild Card, plus others), `lockedDivRank`, `streak`, `divisionRecord` and `vs. Conf.`. `clincher` only appears once a team has clinched; it's missing mid-season.
  - **NBA:** has the same fields plus `gamesBehind` and `Last Ten Games`. Clinch codes seen in 2025: `z, y, x, xp, pb, e`. **`pb` = play-in** and `e` = eliminated. Seeds 7–10 together with `pb` give you the play-in field.
  - CFB and MLB use the same endpoint shape.
- **CFP rankings:** The core endpoint `sports.core.api.espn.com/v2/sports/football/leagues/college-football/rankings` lists the poll refs. **id 21 = "Playoff Committee Rankings" (`type: cfp`)**, with `current`, `previous`, `trend` and `record` per team. The site endpoint `.../college-football/rankings` returned only the Coaches Poll when I checked, so use the core id 21 ref for the current week.
- **F1:** Jolpica `.../f1/current/driverStandings.json` and `constructorStandings.json`. These are verified, CORS `*`, and current through round 20 of 2026. Jolpica has no clinch flag, so compute "mathematically clinched" yourself from the points left (25 + sprint points per remaining round). ESPN also has `apis/v2/sports/racing/f1/standings` *(unverified)*.

**Recommendation:** Use ESPN standings for the four ball sports and render the ESPN `clincher` codes. Use Jolpica for F1, with your own clinch math.

## 4. Broadcast and TV info

Already present in the ESPN scoreboard you use (verified):
- `competitions[].broadcasts` → `[{market:"national", names:["Fox"]}]`
- `competitions[].geoBroadcasts` → `{type.shortName:"TV"|"Streaming"|"Radio", market.type:"National"|"Home"|"Away", media.shortName, region:"us"}`
- `competitions[].broadcast` (a short string)

No other source is needed. For F1, ESPN racing scoreboards have the same fields *(unverified)*. If they're missing, a static per-country table is enough (US: ESPN/ABC through 2025, then Apple TV from 2026 *(unverified)*).

## 5. Weather at the venue

- **ESPN first.** The NFL scoreboard `events[].weather` is already filled in for outdoor games before kickoff (verified): `displayValue`, `temperature`, `highTemperature`, `conditionId`, plus an AccuWeather link. The venue's `indoor` flag is also available, so you can hide weather for domes.
- **Open-Meteo** for wind and precipitation detail, and for every sport:
  - Free for non-commercial use: "You may only use the free API services for non-commercial purposes." Sites with no ads and no subscriptions qualify, and tip jars are allowed ([terms](https://open-meteo.com/en/terms)).
  - Data is **CC BY 4.0**, so show attribution such as "Weather data by Open-Meteo.com" with a link.
  - Limits: **600/min, 5,000/hour, 10,000/day, 300k/month**, counted per IP. Browser calls count against each user's own IP.
  - CORS `*` (verified).
- **Venue coordinates.** ESPN venues give only an address (city, state, zip) and no lat/lon (verified on `core …/venues/3622`). Options:
  1. Open-Meteo Geocoding `geocoding-api.open-meteo.com/v1/search?name=Kansas+City&count=1&countryCode=US` returns `latitude`/`longitude`. It's free, uses GeoNames data and has CORS `*` (verified). It resolves cities, not stadiums, which is accurate enough for weather.
  2. **Better:** a one-time script that builds `data/venues.json` (ESPN venue id → lat/lon). Fill it by geocoding the city and then hand-correct the NFL, MLB and NBA venues (about 90). Commit it to the repo. For F1, Jolpica `circuits.json` already has `Location.lat/long`.

## 6. Official highlight videos (YouTube)

- **Cost:** Free (a Google Cloud API key with no billing). The default quota is **10,000 units/day**. `videos.list`, `playlistItems.list` and `channels.list` cost **1 unit** each. The official [quota page](https://developers.google.com/youtube/v3/determine_quota_cost), checked today, says `search.list` costs 1 unit with **its own allowance of 100 calls/day**. That's a recent change from the old "100 units per search" rule. Either way, don't use search.
- **Better method:** Poll each channel's uploads playlist (the channel id with `UC` replaced by `UU`) using `playlistItems.list`, which costs 1 unit per 50 videos. Run it in the worker every 15–30 minutes and write a static `highlights.json`. Keep the API key in GitHub secrets, never in the browser. The RSS feed `youtube.com/feeds/videos.xml?channel_id=…` needs no key, but it has **no CORS** (worker only) and returned 404 intermittently for the NBA channel.
- **Official channel IDs** (verified via RSS and canonical URLs): NFL `UCDVYQ4Zhbm3S2dlz7P1GBDg`, NBA `UCWJ2lWNubArHWmf3FIHbfcQ`, MLB `UCoLrcjPV5PbUrUyXq5mjc_A`, FORMULA 1 `UCB_qr75-ydFVKSF9Dmo6izg`. For CFB there's no single league channel; use the ESPN CFB channel or the conference channels *(IDs not verified)*.
- **Matching a video to a game:** Accept a video only if all of these hold:
  1. Its title contains both team names (or nicknames) and "Highlights". The NFL format is "San Francisco 49ers vs. Dallas Cowboys Highlights | NFL 2026 Season Week 10".
  2. `publishedAt` is between game start and 36 hours after the final.
  3. The season and week in the title match, when present.

  Before showing it, check `status.embeddable` with `videos.list`. Also, the ESPN scoreboard's `competitions[].highlights` field is already in your feed (seen in the keys) and may carry ESPN clips.
- **Embedding terms:** Use the standard iframe player. Don't "modify, add to or block the standard playback function", don't block or replace ads, and keep the player at least 200×200 px ([Developer Policies](https://developers.google.com/youtube/terms/developer-policies), [Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)). Embedding official league uploads is allowed under the YouTube ToS.

## 7. Injuries and F1 penalties

- **ESPN** `site.api.espn.com/apis/site/v2/sports/football/nfl/injuries` (all teams; about 8.7 MB, so fetch it in the worker or use the per-team endpoint). Fields per item (verified):
  - `status` ("Questionable"), `type` (`INJURY_STATUS_QUESTIONABLE`, abbreviation `Q`)
  - `date` (ISO), `shortComment`, `longComment`, `source`
  - `details` with `type` (Knee), `location` (Leg), `side`, `detail`, `fantasyStatus` and `returnDate`
  - `athlete`

  The same path works for NBA, MLB and CFB (CFB coverage is thin). The comment text is ESPN or Rotowire editorial content, so show `status` and `details` and keep any quoted text short.
- **F1 penalties and withdrawals:**
  - OpenF1 `race_control`: race-director messages covering penalties, investigations and flags.
  - Jolpica `results.json` `status`: "Withdrew", "Did not start", "Disqualified".
  - Jolpica `grid` vs. qualifying position, to spot grid penalties.
  - FIA decision documents (fia.com) are PDFs with no API.

## 8. Player projection inputs (season stats and game logs)

All of these work today (verified), with CORS `*`:
- `site.web.api.espn.com/apis/common/v3/sports/{sport}/{league}/athletes/{id}/gamelog`: `names` (completions, passingYards, …, adjQBR, rushing…), `events` and `seasonTypes`. Add `?season=YYYY` for past seasons.
- `.../athletes/{id}/splits`: home/away, opponent, month and similar splits (`splitCategories`).
- `.../athletes/{id}/stats` and `site.api.espn.com/.../summary?event=` box scores.

Bulk history for modeling: nflverse `load_player_stats()` (CC-BY), CFBD (1k/mo free), hoopR. For F1, use Jolpica results and qualifying.

## 9. Team and league logos

- `a.espncdn.com` logos are ESPN-hosted copies of **team and league trademarks**, and those marks also have copyright. Hotlinking adds two risks: ESPN's [terms](https://disneytermsofuse.com/english/) cover ESPN, and the leagues own the marks.
- I found no official NFL, NBA, MLB or F1 fan-site logo policy. Law-firm guidance says the test is likely confusion about "affiliation, connection, association, sponsorship or approval", and that calling something fan-made doesn't cure infringement ([GFR Law](https://www.gfrlaw.com/what-we-do/insights/dont-make-teams-go-ravin-mad-using-their-branding)). FastF1 notes that F1 marks belong to Formula One Licensing B.V.
- Using team **names and abbreviations** in text is nominative use and low risk. Logos are the riskier part.
- **Options, lowest risk first:**
  1. Team abbreviation in a colored badge using the team's primary and secondary colors. ESPN `team.color` and `team.alternateColor` give the colors (from memory, not checked today).
  2. Keep ESPN logos, but add a "Not affiliated with or endorsed by…" disclaimer, run no ads, and be ready to remove them quickly if asked.
  3. Don't modify logos or use them as app or brand icons.

  Never put league marks in the Play Store listing graphics. Google Play also enforces against impersonation.

## 10. LLM recaps

- **Claude Haiku 5.5** (`claude-haiku-5-5`): **$0.10 / $0.50 per 1M input/output tokens** (Anthropic price list cached 2026-11-03). A recap with about 3,000 input tokens (box score plus about 20 key plays) and about 250 output tokens costs about **$0.0004**. 100 a day is about **$0.04/day, or roughly $1.30/month**, and the Batch API halves that (about $0.65/mo). Haiku 4.5 at $1/$5 would be about $16/mo.
- Make the calls only from the GitHub Actions worker, with the key in secrets, and write the recaps to static JSON. Add a short "AI-generated" label. Feed only structured facts (score, leaders, scoring plays) so the model can't invent stats.
- **Template alternative (free, deterministic):** Generate from play-by-play by picking a lead sentence based on margin and comeback (largest WP swing from the existing WP model), then adding the top two performers from `leaders`, the decisive scoring play (`scoringPlay` with the biggest WP delta) and what's next (record and streak from standings). About 30 phrase templates per sport read fine.
- **Recommendation:** Start with templates. If you want more variety, add Haiku 5.5 later at about $1/mo.

## 11. Risk of using ESPN's unofficial API

- ESPN closed its public developer API in 2014. The `site.api` and `core` endpoints are undocumented, and you get no license, no SLA and no notice of changes.
- The Disney Terms of Use explicitly cover ESPN-branded products. The relevant clauses:
  - They bar accessing or extracting the products "using a robot, spider, script, or other automated means" (§2.B.x).
  - They bar any "commercial or business-related use" (§2.B.viii).
  - The license is personal and noncommercial, with "no right to reproduce, distribute" (§2.A).
- **In practice:** Scoreline is technically outside the terms, but the risk is moderate to low. Many free hobby apps and open-source libraries (hoopR, cfbfastR, the ESPN wrappers) use these endpoints, and I found no record of enforcement against non-commercial apps. The more likely failure is a **silent schema change or blocking**.
- **Mitigation:**
  - No ads or paid tiers.
  - Credit "Data: ESPN" with a not-affiliated disclaimer.
  - Cache in the worker or CDN instead of hammering ESPN from every client where you can. CORS `*` currently permits browser calls.
  - Code defensively with optional chaining, and keep fallbacks: Jolpica/OpenF1 for F1, CFBD for CFB, MLB StatsAPI for MLB.
  - Comply quickly if you receive a takedown.

---

## Recommendation summary

| Need | Recommended source | Cost | License OK for public free app? | Notes |
|---|---|---|---|---|
| 1. Kick location | ESPN core plays (start/end yard lines) plus parsed `text` | Free | Unofficial (see §11) | No free source has the true crossing point. Draw a stylized direction (wide L/R, short, upright). |
| 1b. Punt/kickoff spots | ESPN core plays `start`/`end` plus `text` | Free | Unofficial | Kick spot, landing spot and return end are all available. |
| 2. Historical pbp: NFL | nflverse releases | Free | Yes (CC-BY 4.0; FTN is CC-BY-SA) | Has wp/ep columns to compare against. |
| 2. Historical pbp: CFB | cfbfastR releases plus CFBD API (worker only) | Free, 1k calls/mo; $1–30/mo tiers | Yes (commercial use allowed; no bulk redistribution) | Never put the key in browser code. |
| 2. Historical pbp: NBA | ESPN summary `plays` / hoopR | Free | Unofficial | Avoid stats.nba.com (no CORS, blocks cloud IPs). |
| 2. Historical: F1 | Jolpica plus OpenF1 (FastF1 offline) | Free (OpenF1 live data €9.90/mo) | Yes, as long as the app stays non-commercial (CC BY-NC-SA) | Jolpica: 4/s, 500/h. OpenF1: 30/min. |
| 3. Standings, clinch, seeds | ESPN `apis/v2/.../standings` | Free | Unofficial | Has `playoffSeed` and `clincher` (z/y/x/pb/e); `pb` = NBA play-in. |
| 3. CFP rankings | ESPN core rankings id 21 (`type: cfp`) | Free | Unofficial | The site rankings endpoint showed only the Coaches Poll. |
| 3. F1 standings | Jolpica | Free | Yes (NC) | Compute clinch math yourself. |
| 4. TV/broadcast | ESPN scoreboard `broadcasts`/`geoBroadcasts` | Free | Unofficial | Already in your feed. |
| 5. Weather | ESPN `event.weather`, then Open-Meteo | Free | Yes (non-commercial; CC BY 4.0 attribution) | 10k/day per IP. CORS ok. |
| 5b. Venue lat/lon | Static `venues.json` built once (Open-Meteo geocoding plus hand fixes; Jolpica circuits for F1) | Free | Yes (GeoNames attribution) | ESPN venues have no coordinates. |
| 6. Highlights | YouTube Data API `playlistItems.list` on uploads playlists (worker) plus iframe embed | Free (10k units/day) | Yes under the YouTube API ToS | Match on title teams, publish window and `embeddable`. Key stays server-side. |
| 7. Injuries | ESPN `/injuries` | Free | Unofficial | status, date, details.returnDate, source. Keep editorial text short. |
| 7b. F1 penalties | OpenF1 `race_control` plus Jolpica `status` | Free | Yes (NC) | FIA documents are PDF only. |
| 8. Game logs and splits | ESPN `common/v3/.../athletes/{id}/gamelog` and `/splits` | Free | Unofficial | CORS ok. nflverse for bulk NFL. |
| 9. Logos | Abbreviation badges in team colors, with ESPN logos as an optional extra | Free | Text: yes. Logos: risky. | Add a not-affiliated disclaimer; no logos in Play Store graphics. |
| 10. Recaps | Templates first; Claude Haiku 5.5 in the worker as an option | $0, or about $1.30/mo for 100/day | Yes | Label as AI-generated and feed it facts only. |
| 11. ESPN risk | Keep ESPN with caching, fallbacks and no ads | Free | **Not licensed.** Disney ToU bars automated access and reproduction. | Enforcement against small non-commercial apps seems rare; plan for breakage. |
