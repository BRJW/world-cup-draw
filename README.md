# ⚽ World Cup Draw 2026

A live, mobile-first draft pool for the 2026 World Cup. Up to **12 friends**, **48 teams in 8 tiers of 6** seeded by **Vegas odds**, drafted in **complementary pairs** so every squad of four is equally weighted. No one can luck into four powerhouses — it comes down to who you back.

Built as a **single Node service** (Express + Socket.IO) so the live draw streams in real time, with Postgres for storage. No frontend build step — deploys clean.

## Features

- **Create / join pools** with a 6-letter code or share link.
- **Live draw** with **full-screen country announcements** — each pick is a themed takeover (team colours, crest, flag, odds, who drafted it), broadcast over websockets to everyone watching. The commissioner (or the player on the clock) pulls each ball.
- **8 tiers of 6, seeded by Vegas odds**, with complementary pairing (see below).
- **My Teams** — your four squads, their tiers, odds, records, and (once the knockouts start) whether each is still alive or out.
- **Standings** — a leaderboard combining each player's teams (3 pts win / 1 draw, goal difference tiebreak). Counts **final results only**, so a live game never flips the table. Eliminated teams' flags show crossed out.
- **Bracket** — a radial knockout wheel (SVG), rings running Round of 32 on the outside in to Semi-final, with the Final as the centre bullseye (shows the champion's flag + name once it's decided). Each match splits into two side-by-side wedges (one per team, not stacked) with the name and coach (if drafted in this pool) written radially outward — legible at full ring thickness instead of squeezed tangentially into half of it. Straight "wire" lines connect each match to the one it feeds into the next ring in. Every ring's title (Round of 32, Round of 16, ...) shows once in a reserved gap, not repeated on every wedge. Tap a wedge for a detail card below with score and live/FT status. Eliminated teams are dimmed and struck through in place; 3rd place is a small tappable note beneath the wheel since it isn't part of the winners' line. Opening the tab auto-selects whichever match still has something to decide. Ring/wedge order is reconstructed from the *real* bracket lineage (matching resolved teams back to their source fixture, and parsing ESPN's "Round of 32 8 Winner"-style placeholders for unresolved ones) — not just chronological kickoff order, which doesn't always match the actual pairing.
- **Scores & schedule** — all 104 fixtures auto-synced from ESPN (kickoff times, LIVE/FT status, scores) on an hourly cron (every minute while a game is live), with a commissioner manual override for any match. Opening the tab auto-scrolls to the first fixture that isn't finished yet.

## Live data (scores + schedule)

Match data comes from **ESPN's public API** (`site.api.espn.com`, free, no key). On boot and hourly the server fetches every fixture, upserts it (`lib/espn.js` → `store.upsertMatchByExtId`), and pushes `matches-updated` over websockets. `data/schedule.json` is a committed snapshot used as a fallback seed if ESPN is unreachable at boot.

- **Final vs live:** ESPN reports `status` (`pre`/`in`/`post`) and a `completed` flag. Standings count a match only when it's final (or a commissioner override); live games are shown but excluded.
- **Penalty shootouts:** a knockout match level after 120 minutes carries ESPN's per-competitor `winner` flag (plus the penalty score) even though the score line stays level — `lib/espn.js` captures this as `shootout`/`winnerA`/`winnerB`/`penA`/`penB`, and both scoring and elimination status treat it as a real win/loss rather than a draw.
- **Manual override:** a commissioner score edit sets `manual=true` and the auto-sync never clobbers it; "↻ auto" reverts to the live feed.
- **Elimination status:** `lib/draw.js`'s `teamStatus()` marks a team **out** once it loses an actual knockout-round match (outright or on penalties), or — once the Round of 32 field is fully set — if it isn't among those 32 teams at all. That second check reads ESPN's own group-stage-standings result (who actually qualified) rather than reimplementing FIFA's tiebreaker chain (goal difference, head-to-head, disciplinary points, etc.) ourselves, which we have no reliable data source for.

## Scheduled jobs (cron service)

A tiny second Railway service (`cron.js`) runs on a cron schedule and pings job endpoints on the web service (`POST /api/cron/:job`, authorised by `CRON_SECRET`). It holds no logic — the work runs where the DB and websockets live. Adding a scheduled task is two steps:

1. register it in the `JOBS` map in `server.js`
2. point a cron service at it via `CRON_JOBS` + a `cronSchedule`

The web service also keeps an in-process hourly sync as a backstop (disable with `SELF_SYNC=off` once the cron service owns scheduling). Railway's minimum cron interval is 5 minutes.

## Run locally

```bash
npm install
npm start          # http://localhost:3000
```

With no `DATABASE_URL`, it uses an in-memory store (great for testing; data resets on restart). For persistence, set a Postgres URL — see `.env.example`.

```bash
npm run dev        # auto-restart on file changes
```

## Deploy to Railway

1. Push this repo to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo**, pick this repo. Start command `npm start`.
3. Add a **PostgreSQL** plugin. Railway injects `DATABASE_URL` automatically.
4. Railway runs persistent containers, so Socket.IO websockets work with no extra config. It auto-deploys on every push.

Optional **cron service** (same repo): add a second service, set its start command to `node cron.js` and a `cronSchedule` (e.g. `0 * * * *`), and give it `WEB_URL`, `CRON_JOBS=sync`, and the same `CRON_SECRET` as the web service. Because start commands are per-service, `railway.json` deliberately omits `startCommand`.

Required env: `PORT` and `DATABASE_URL` come from Railway. Set `CRON_SECRET` on the web service to enable cron-triggered jobs. (`PGSSL=true` if your Postgres host requires SSL.)

## How the draw works

48 teams are split into **8 tiers of 6** by outright odds to win (`data/teams.js` — array order is the seeding; update as lines move). Tiers are drafted in **complementary pairs** so every squad's tier-sum is identical:

| Upper half | | Lower half | |
|---|---|---|---|
| Tier 1 (1–6) ↔ Tier 4 (19–24) | sum 5 | Tier 5 (25–30) ↔ Tier 8 (43–48) | sum 13 |
| Tier 2 (7–12) ↔ Tier 3 (13–18) | sum 5 | Tier 6 (31–36) ↔ Tier 7 (37–42) | sum 13 |

So if you draw a **top-6** side you also get a **19–24** side (never a 13–18); a 7–12 side comes with a 13–18, and so on. Every player ends with four teams summing to tiers **5 + 13 = 18** — perfectly balanced.

The draft runs in **4 snake-order rounds**, worst teams first so the giants land last:

1. **The Underdog** — a random team from Tier 7 ∪ Tier 8
2. **The Dark Horse** — its complement (Tier 8→5, Tier 7→6)
3. **The Contender** — a random team from Tier 3 ∪ Tier 4
4. **The Headliner** — its complement (Tier 4→1, Tier 3→2)

With 12 players the whole field is drafted; with fewer, the pairing still holds and the rest go undrafted.

**Odds source:** BetMGM via Yahoo Sports, as the tournament opened (June 2026).

## Project layout

```
server.js          Express + Socket.IO server, REST API, live broadcast, jobs
cron.js            Tiny cron entrypoint (pings /api/cron/:job, then exits)
lib/store.js       Storage layer (Postgres in prod, in-memory fallback)
lib/draw.js        Draw engine (8-tier pairing) + scoring/leaderboard
lib/espn.js        Live schedule + scores from ESPN's public API
lib/ids.js         Join codes & tokens
data/teams.js      The 48-team field: odds, tiers, colours + crests
data/schedule.json Committed fixture snapshot (fallback seed)
public/            Zero-build SPA (index.html, app.js, styles.css)
```

## Roadmap

- **SMS reminders** — deferred: Twilio A2P 10DLC carrier registration takes days-to-weeks, so it won't clear in time for the group stage. Link invites + in-app for now; texts can layer on later.
