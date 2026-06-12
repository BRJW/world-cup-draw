import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server as SocketServer } from 'socket.io';

import { createStore } from './lib/store.js';
import {
  TEAMS, MAX_PLAYERS, ROUND_COUNT, TEAMS_PER_PLAYER, ROUND_INFO,
  currentTurn, advance, randomTeamForTurn, leaderboard, teamsForPlayer,
} from './lib/draw.js';
import { teamByCode } from './data/teams.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const store = await createStore();
console.log(`[store] backend = ${store.backend}`);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new SocketServer(server);

// ---- serialization helpers (never leak tokens) ----------------------------
const publicPool = (p) => p && ({
  id: p.id, name: p.name, joinCode: p.joinCode, status: p.status,
  potIndex: p.potIndex, pickIndex: p.pickIndex, createdAt: p.createdAt,
  commissionerPlayerId: p.commissionerPlayerId,
});
const publicPlayer = (p) => p && ({
  id: p.id, name: p.name, isCommissioner: p.isCommissioner,
});

async function fullState(poolId) {
  const pool = await store.getPool(poolId);
  if (!pool) return null;
  const players = await store.getPlayers(poolId);
  const picks = await store.getPicks(poolId);
  return {
    pool: publicPool(pool),
    players: players.map(publicPlayer),
    picks: picks.map((p) => ({
      playerId: p.playerId, teamCode: p.teamCode, round: p.pot,
      pickNumber: p.pickNumber, team: teamByCode(p.teamCode),
    })),
    currentTurn: currentTurn(pool),
  };
}

async function broadcast(poolId, extra) {
  const state = await fullState(poolId);
  if (state) io.to(`pool:${poolId}`).emit('state', { ...state, ...extra });
  return state;
}

// ---- auth helpers ----------------------------------------------------------
async function requirePlayer(token, poolId) {
  if (!token) return null;
  const player = await store.getPlayerByToken(token);
  if (!player || player.poolId !== poolId) return null;
  return player;
}
async function requireCommissioner(token, poolId) {
  const player = await requirePlayer(token, poolId);
  return player && player.isCommissioner ? player : null;
}

// ---- routes ----------------------------------------------------------------
app.get('/api/health', (req, res) => res.json({ ok: true, backend: store.backend }));

app.get('/api/teams', (req, res) => res.json({
  teams: TEAMS, maxPlayers: MAX_PLAYERS, roundCount: ROUND_COUNT,
  teamsPerPlayer: TEAMS_PER_PLAYER, rounds: ROUND_INFO,
}));

// Create a pool (creator becomes commissioner)
app.post('/api/pools', async (req, res) => {
  const name = (req.body?.name || '').trim();
  const commissionerName = (req.body?.commissionerName || '').trim();
  if (!name || !commissionerName) return res.status(400).json({ error: 'name and commissionerName required' });
  const { pool, player } = await store.createPool({ name, commissionerName });
  res.json({
    pool: publicPool(pool),
    player: { ...publicPlayer(player), token: player.token },
  });
});

// Look up a pool by join code (for the join screen)
app.get('/api/pools/by-code/:code', async (req, res) => {
  const pool = await store.getPoolByCode(req.params.code);
  if (!pool) return res.status(404).json({ error: 'not found' });
  const players = await store.getPlayers(pool.id);
  res.json({ pool: publicPool(pool), playerCount: players.length });
});

// Join a pool
app.post('/api/pools/:code/join', async (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const pool = await store.getPoolByCode(req.params.code);
  if (!pool) return res.status(404).json({ error: 'pool not found' });
  if (pool.status !== 'setup') return res.status(409).json({ error: 'draft already started' });
  const players = await store.getPlayers(pool.id);
  if (players.length >= MAX_PLAYERS) return res.status(409).json({ error: `pool full (max ${MAX_PLAYERS})` });
  if (players.some((p) => p.name.toLowerCase() === name.toLowerCase()))
    return res.status(409).json({ error: 'name already taken in this pool' });
  const player = await store.addPlayer(pool.id, name);
  await broadcast(pool.id);
  res.json({
    pool: publicPool(pool),
    player: { ...publicPlayer(player), token: player.token },
  });
});

// Full pool state
app.get('/api/pools/:id', async (req, res) => {
  const state = await fullState(req.params.id);
  if (!state) return res.status(404).json({ error: 'not found' });
  res.json(state);
});

// Resolve a saved token -> who am I / which pool
app.get('/api/me', async (req, res) => {
  const player = await store.getPlayerByToken(req.query.token);
  if (!player) return res.status(404).json({ error: 'unknown token' });
  res.json({ player: publicPlayer(player), poolId: player.poolId });
});

// Set / shuffle the draft order (commissioner, during setup)
app.post('/api/pools/:id/order', async (req, res) => {
  const commissioner = await requireCommissioner(req.body?.token, req.params.id);
  if (!commissioner) return res.status(403).json({ error: 'commissioner only' });
  const pool = await store.getPool(req.params.id);
  if (pool.status !== 'setup') return res.status(409).json({ error: 'draft already started' });
  const players = await store.getPlayers(pool.id);
  const ids = players.map((p) => p.id);
  let order = Array.isArray(req.body?.order) ? req.body.order.filter((x) => ids.includes(x)) : null;
  if (!order || order.length !== ids.length) {
    // default: randomize
    order = [...ids].sort(() => Math.random() - 0.5);
  }
  await store.updatePool(pool.id, { draftOrder: order });
  const state = await broadcast(pool.id);
  res.json(state);
});

// Start the draft (commissioner)
app.post('/api/pools/:id/start', async (req, res) => {
  const commissioner = await requireCommissioner(req.body?.token, req.params.id);
  if (!commissioner) return res.status(403).json({ error: 'commissioner only' });
  const pool = await store.getPool(req.params.id);
  if (pool.status !== 'setup') return res.status(409).json({ error: 'already started' });
  const players = await store.getPlayers(pool.id);
  if (players.length < 2) return res.status(400).json({ error: 'need at least 2 players' });
  let order = pool.draftOrder;
  if (!order || order.length !== players.length) {
    order = players.map((p) => p.id).sort(() => Math.random() - 0.5);
  }
  await store.updatePool(pool.id, { draftOrder: order, status: 'drafting', potIndex: 0, pickIndex: 0 });
  const state = await broadcast(pool.id, { event: 'draft-started' });
  res.json(state);
});

// Draw the next team (commissioner, or the player whose turn it is)
app.post('/api/pools/:id/draw', async (req, res) => {
  const poolId = req.params.id;
  const player = await requirePlayer(req.body?.token, poolId);
  if (!player) return res.status(403).json({ error: 'join the pool first' });
  const pool = await store.getPool(poolId);
  if (!pool || pool.status !== 'drafting') return res.status(409).json({ error: 'not drafting' });
  const turn = currentTurn(pool);
  if (!turn) return res.status(409).json({ error: 'draft complete' });
  if (!player.isCommissioner && player.id !== turn.playerId)
    return res.status(403).json({ error: 'not your pick' });

  const picks = await store.getPicks(poolId);
  const team = randomTeamForTurn(pool, picks, turn);
  if (!team) return res.status(409).json({ error: 'no eligible teams left for this pick' });

  const pick = await store.recordPick({
    poolId, playerId: turn.playerId, teamCode: team.code,
    pot: turn.round, pickNumber: turn.pickNumber,
  });
  await store.updatePool(poolId, advance(pool));

  const state = await broadcast(poolId, {
    event: 'pick',
    pick: { playerId: turn.playerId, teamCode: team.code, round: turn.round, pickNumber: turn.pickNumber, team },
  });
  res.json({ pick, team, state });
});

// ---- scores / matches ------------------------------------------------------
app.get('/api/matches', async (req, res) => {
  res.json({ matches: await store.listMatches() });
});

app.get('/api/pools/:id/leaderboard', async (req, res) => {
  const pool = await store.getPool(req.params.id);
  if (!pool) return res.status(404).json({ error: 'not found' });
  const players = await store.getPlayers(pool.id);
  const picks = await store.getPicks(pool.id);
  const matches = await store.listMatches();
  res.json({
    leaderboard: leaderboard(players, picks, matches),
    byPlayer: Object.fromEntries(players.map((p) => [p.id, teamsForPlayer(picks, p.id)])),
  });
});

// Add / update / delete a match result (commissioner of *some* pool).
// Matches are global to the tournament; we authorize via any commissioner token.
async function isAnyCommissioner(token) {
  if (!token) return false;
  const player = await store.getPlayerByToken(token);
  return !!(player && player.isCommissioner);
}

app.post('/api/matches', async (req, res) => {
  if (!(await isAnyCommissioner(req.body?.token))) return res.status(403).json({ error: 'commissioner only' });
  const { teamA, teamB, scoreA, scoreB, stage } = req.body || {};
  if (!teamByCode(teamA) || !teamByCode(teamB)) return res.status(400).json({ error: 'unknown team code' });
  const match = await store.addMatch({
    teamA, teamB,
    scoreA: scoreA === '' || scoreA == null ? null : Number(scoreA),
    scoreB: scoreB === '' || scoreB == null ? null : Number(scoreB),
    stage: stage || 'Group',
  });
  io.emit('matches-updated');
  res.json({ match });
});

app.patch('/api/matches/:id', async (req, res) => {
  if (!(await isAnyCommissioner(req.body?.token))) return res.status(403).json({ error: 'commissioner only' });
  const fields = {};
  for (const k of ['teamA', 'teamB', 'stage']) if (k in req.body) fields[k] = req.body[k];
  for (const k of ['scoreA', 'scoreB']) if (k in req.body) fields[k] = req.body[k] === '' || req.body[k] == null ? null : Number(req.body[k]);
  const match = await store.updateMatch(req.params.id, fields);
  if (!match) return res.status(404).json({ error: 'not found' });
  io.emit('matches-updated');
  res.json({ match });
});

app.delete('/api/matches/:id', async (req, res) => {
  if (!(await isAnyCommissioner(req.query?.token))) return res.status(403).json({ error: 'commissioner only' });
  const ok = await store.deleteMatch(req.params.id);
  io.emit('matches-updated');
  res.json({ ok });
});

// ---- socket.io -------------------------------------------------------------
io.on('connection', (socket) => {
  socket.on('join-pool', async (poolId) => {
    if (typeof poolId !== 'string') return;
    socket.join(`pool:${poolId}`);
    const state = await fullState(poolId);
    if (state) socket.emit('state', state);
  });
  socket.on('leave-pool', (poolId) => socket.leave(`pool:${poolId}`));
});

// ---- SPA fallback ----------------------------------------------------------
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

server.listen(PORT, () => console.log(`World Cup Draw listening on :${PORT}`));
