# ⚽ World Cup Draw 2026

A live, mobile-first draft pool for the 2026 World Cup. Up to **12 friends**, **4 pots of 12 teams**, and everyone drafts **one team from each pot** — so every player ends up with one giant, one contender, one dark horse, and one minnow. No one can luck into four powerhouses.

Built as a **single Node service** (Express + Socket.IO) so the live draw streams in real time, with Postgres for storage. No frontend build step — deploys clean.

## Features

- **Create / join pools** with a 6-letter code or share link.
- **Live draw** — teams are revealed one at a time with an animated reveal, broadcast over websockets to everyone watching. The commissioner (or the player on the clock) pulls each ball.
- **Snake order through the pots**, seeded by FIFA ranking; hosts (USA, Mexico, Canada) sit in Pot 1.
- **My Teams** — your four squads and their records at a glance.
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

- 48 teams split into 4 pots of 12 by FIFA ranking (`data/teams.js` — edit freely as 2026 qualification finalizes; pot balance only needs 12 per pot).
- The commissioner starts the draw; order is randomized (and reshufflable).
- The draft snakes through the pots: Pot 1 in order, Pot 2 reversed, and so on. Within each pot, each player's team is drawn at random from those still available.
- With 12 players the whole field is drafted; with fewer, each player still gets exactly one team per pot and the rest go undrafted.

## Project layout

```
server.js          Express + Socket.IO server, REST API, live broadcast
lib/store.js       Storage layer (Postgres in prod, in-memory fallback)
lib/draw.js        Draw engine + scoring/leaderboard (pure functions)
lib/ids.js         Join codes & tokens
data/teams.js      The 48-team field, seeded into pots
public/            Zero-build SPA (index.html, app.js, styles.css)
```

## Roadmap

- **SMS reminders** — deferred: Twilio A2P 10DLC carrier registration takes days-to-weeks, so it won't clear in time for the group stage. Link invites + in-app for now; texts can layer on later.
- **Live score API** — wire a football-data feed into the `matches` table; the manual entry already in place stays as the override.
