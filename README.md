# ⚽ World Cup Draw 2026

A live, mobile-first draft pool for the 2026 World Cup. Up to **12 friends**, **48 teams in 8 tiers of 6** seeded by **Vegas odds**, drafted in **complementary pairs** so every squad of four is equally weighted. No one can luck into four powerhouses — it comes down to who you back.

Built as a **single Node service** (Express + Socket.IO) so the live draw streams in real time, with Postgres for storage. No frontend build step — deploys clean.

## Features

- **Create / join pools** with a 6-letter code or share link.
- **Live draw** — teams are revealed one at a time with an animated reveal, broadcast over websockets to everyone watching. The commissioner (or the player on the clock) pulls each ball.
- **8 tiers of 6, seeded by Vegas odds**, with complementary pairing (see below).
- **My Teams** — your four squads, their tiers, odds, and records at a glance.
- **Standings** — a leaderboard combining each player's teams (3 pts win / 1 draw, goal difference tiebreak).
- **Scores** — the commissioner enters results as games finish (manual override means you're never blocked by a lagging data feed).

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
2. In Railway: **New Project → Deploy from GitHub repo**, pick this repo.
3. Add a **PostgreSQL** plugin. Railway injects `DATABASE_URL` automatically.
4. Railway runs persistent containers, so Socket.IO websockets work with no extra config. It auto-deploys on every push.

Required env: nothing manual — `PORT` and `DATABASE_URL` are provided by Railway. (`PGSSL=true` if your Postgres host requires SSL.)

## How the draw works

48 teams are split into **8 tiers of 6** by outright odds to win (`data/teams.js` — array order is the seeding; update as lines move). Tiers are drafted in **complementary pairs** so every squad's tier-sum is identical:

| Upper half | | Lower half | |
|---|---|---|---|
| Tier 1 (1–6) ↔ Tier 4 (19–24) | sum 5 | Tier 5 (25–30) ↔ Tier 8 (43–48) | sum 13 |
| Tier 2 (7–12) ↔ Tier 3 (13–18) | sum 5 | Tier 6 (31–36) ↔ Tier 7 (37–42) | sum 13 |

So if you draw a **top-6** side you also get a **19–24** side (never a 13–18); a 7–12 side comes with a 13–18, and so on. Every player ends with four teams summing to tiers **5 + 13 = 18** — perfectly balanced.

The draft runs in **4 snake-order rounds**:

1. **Upper headliner** — a random team from Tier 1 ∪ Tier 2
2. **Upper balancer** — its complement (Tier 1→4, Tier 2→3)
3. **Lower pick** — a random team from Tier 5 ∪ Tier 6
4. **Lower balancer** — its complement (Tier 5→8, Tier 6→7)

With 12 players the whole field is drafted; with fewer, the pairing still holds and the rest go undrafted.

**Odds source:** BetMGM via Yahoo Sports, as the tournament opened (June 2026).

## Project layout

```
server.js          Express + Socket.IO server, REST API, live broadcast
lib/store.js       Storage layer (Postgres in prod, in-memory fallback)
lib/draw.js        Draw engine (8-tier pairing) + scoring/leaderboard
lib/ids.js         Join codes & tokens
data/teams.js      The 48-team field, odds, seeded into 8 tiers
public/            Zero-build SPA (index.html, app.js, styles.css)
```

## Roadmap

- **SMS reminders** — deferred: Twilio A2P 10DLC carrier registration takes days-to-weeks, so it won't clear in time for the group stage. Link invites + in-app for now; texts can layer on later.
- **Live score API** — wire a football-data feed into the `matches` table; the manual entry already in place stays as the override.
