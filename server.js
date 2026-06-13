import http from 'node:http';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server as SocketServer } from 'socket.io';

import { createStore } from './lib/store.js';
import {
  TEAMS, MAX_PLAYERS, ROUND_COUNT, TEAMS_PER_PLAYER, ROUND_INFO,
  currentTurn, advance, randomTeamForTurn, leaderboard, teamsForPlayer,
} from './lib/draw.js';
import { teamByCode } from './data/teams.js';
import { fetchAllMatches } from './lib/espn.js';
import { sendSMS, sendMany, smsEnabled, normalizePhone } from './lib/sms.js';
import { sendEmail, sendMany as sendEmails, emailEnabled, normalizeEmail, magicLinkEmail } from './lib/email.js';
import { id as randId } from './lib/ids.js';

const sixDigit = () => String(Math.floor(100000 + Math.random() * 900000));
const appUrl = (req) => (process.env.APP_URL || `https://${req.get('host')}`).replace(/\/$/, '');

// ---- remember-me: server-set HttpOnly cookie (survives localStorage eviction)
const SESSION_COOKIE = 'wcp';
const SESSION_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000; // ~browser maximum
function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (h) for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setSessionCookie(req, res, id) {
  const https = (req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http')) === 'https';
  res.cookie(SESSION_COOKIE, id, {
    maxAge: SESSION_MAX_AGE_MS, httpOnly: true, secure: https, sameSite: 'lax', path: '/',
  });
}
// Ensure a session cookie exists (reuse or mint) and optionally bind a token.
async function attachSession(req, res, token) {
  const existing = parseCookies(req)[SESSION_COOKIE];
  const sid = /^[a-f0-9]{16,}$/.test(existing || '') ? existing : randId(20);
  setSessionCookie(req, res, sid);
  if (token) await store.sessionAddToken(sid, token);
  return sid;
}
// Resolve everything a cookie session remembers: pools via bound tokens AND via
// any email it has seen (cookie -> email -> all that person's pools), minus any
// the user explicitly removed.
async function membershipsForSession(sid) {
  const { tokens, emails, hidden } = await store.sessionData(sid);
  const hide = new Set(hidden);
  const byPlayer = new Map();
  for (const tk of tokens) { const p = await store.getPlayerByToken(tk); if (p) byPlayer.set(p.id, p); }
  for (const em of emails) { for (const p of await store.getPlayersByEmail(em)) byPlayer.set(p.id, p); }
  const out = [];
  for (const p of byPlayer.values()) {
    if (hide.has(p.poolId)) continue;
    const pool = await store.getPool(p.poolId);
    if (pool) out.push({ poolId: pool.id, code: pool.joinCode, name: pool.name, token: p.token, playerId: p.id });
  }
  return out;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const store = await createStore();
console.log(`[store] backend = ${store.backend}`);

const app = express();
app.use(express.json({ limit: '2mb' })); // room for coach badge uploads
// no-cache: force revalidation (ETag 304s) so phones never run stale JS/CSS
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

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
  placeholder: !!p.placeholder,
  teamName: p.teamName || null, image: p.image || null,
});
// Self view includes the owner's own contact details (never broadcast).
const selfPlayer = (p) => p && ({ ...publicPlayer(p), phone: p.phone || null, email: p.email || null });

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
app.get('/api/health', (req, res) => res.json({ ok: true, backend: store.backend, sms: smsEnabled(), email: emailEnabled() }));

app.get('/api/teams', (req, res) => res.json({
  teams: TEAMS, maxPlayers: MAX_PLAYERS, roundCount: ROUND_COUNT,
  teamsPerPlayer: TEAMS_PER_PLAYER, rounds: ROUND_INFO,
  sms: smsEnabled(), email: emailEnabled(),
}));

// Create a pool (creator becomes commissioner). Email lets them recover access.
app.post('/api/pools', async (req, res) => {
  const name = (req.body?.name || '').trim();
  const commissionerName = (req.body?.commissionerName || '').trim();
  if (!name || !commissionerName) return res.status(400).json({ error: 'name and commissionerName required' });
  const email = normalizeEmail(req.body?.email);
  if (req.body?.email && !email) return res.status(400).json({ error: 'enter a valid email address' });
  const { pool, player } = await store.createPool({ name, commissionerName });
  if (email) await store.updatePlayer(player.id, { email });
  const sid = await attachSession(req, res, player.token);
  if (email) await store.sessionAddEmail(sid, email);
  res.json({
    pool: publicPool(pool),
    player: { ...selfPlayer({ ...player, email }), token: player.token },
  });
});

// Look up a pool by join code (for the join screen)
app.get('/api/pools/by-code/:code', async (req, res) => {
  const pool = await store.getPoolByCode(req.params.code);
  if (!pool) return res.status(404).json({ error: 'not found' });
  const players = await store.getPlayers(pool.id);
  res.json({
    pool: publicPool(pool),
    playerCount: players.length,
    // open seats someone arriving via the invite link can claim
    placeholders: players.filter((p) => p.placeholder).map((p) => ({ id: p.id, name: p.name })),
  });
});

// Join a pool
app.post('/api/pools/:code/join', async (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const email = normalizeEmail(req.body?.email);
  if (req.body?.email && !email) return res.status(400).json({ error: 'enter a valid email address' });
  const pool = await store.getPoolByCode(req.params.code);
  if (!pool) return res.status(404).json({ error: 'pool not found' });
  if (pool.status !== 'setup') return res.status(409).json({ error: 'draft already started' });
  const players = await store.getPlayers(pool.id);
  if (players.length >= MAX_PLAYERS) return res.status(409).json({ error: `pool full (max ${MAX_PLAYERS})` });
  if (players.some((p) => p.name.toLowerCase() === name.toLowerCase()))
    return res.status(409).json({ error: 'name already taken in this pool' });
  const player = await store.addPlayer(pool.id, name);
  if (email) await store.updatePlayer(player.id, { email });
  const sid = await attachSession(req, res, player.token);
  if (email) await store.sessionAddEmail(sid, email);
  await broadcast(pool.id);
  res.json({
    pool: publicPool(pool),
    player: { ...selfPlayer({ ...player, email }), token: player.token },
  });
});

// Commissioner adds a named placeholder to hold a slot (lobby only). The
// commissioner draws on their behalf; the real person claims the name later.
app.post('/api/pools/:id/placeholders', async (req, res) => {
  const commissioner = await requireCommissioner(req.body?.token, req.params.id);
  if (!commissioner) return res.status(403).json({ error: 'commissioner only' });
  const pool = await store.getPool(req.params.id);
  if (pool.status !== 'setup') return res.status(409).json({ error: 'draft already started' });
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const players = await store.getPlayers(pool.id);
  if (players.length >= MAX_PLAYERS) return res.status(409).json({ error: `pool full (max ${MAX_PLAYERS})` });
  if (players.some((p) => p.name.toLowerCase() === name.toLowerCase()))
    return res.status(409).json({ error: 'name already taken in this pool' });
  await store.addPlayer(pool.id, name, false, true);
  await broadcast(pool.id);
  res.json(await fullState(pool.id));
});

// Claim a placeholder seat by name — works at ANY stage (even after the draft),
// so latecomers can take over the teams drawn for them.
app.post('/api/pools/:code/claim', async (req, res) => {
  const pool = await store.getPoolByCode(req.params.code);
  if (!pool) return res.status(404).json({ error: 'pool not found' });
  const playerId = req.body?.playerId;
  const players = await store.getPlayers(pool.id);
  const seat = players.find((p) => p.id === playerId && p.placeholder);
  if (!seat) return res.status(409).json({ error: 'that seat has already been claimed' });
  const email = normalizeEmail(req.body?.email);
  if (req.body?.email && !email) return res.status(400).json({ error: 'enter a valid email address' });
  const fields = { placeholder: false };
  if (email) fields.email = email;
  const claimed = await store.updatePlayer(seat.id, fields);
  const sid = await attachSession(req, res, claimed.token);
  if (claimed.email) await store.sessionAddEmail(sid, claimed.email);
  await broadcast(pool.id);
  res.json({
    pool: publicPool(pool),
    player: { ...selfPlayer(claimed), token: claimed.token },
  });
});

// Full pool state
app.get('/api/pools/:id', async (req, res) => {
  const state = await fullState(req.params.id);
  if (!state) return res.status(404).json({ error: 'not found' });
  res.json(state);
});

// Remember-me: bind any known tokens to the cookie session and return ALL
// memberships the cookie remembers (restores pools even if localStorage was
// wiped by the browser, e.g. Safari's 7-day cap or an in-app browser).
app.post('/api/session/sync', async (req, res) => {
  const tokens = Array.isArray(req.body?.tokens) ? req.body.tokens.filter((t) => typeof t === 'string') : [];
  const sid = await attachSession(req, res);
  for (const tk of tokens) {
    const p = await store.getPlayerByToken(tk);
    if (p) { await store.sessionAddToken(sid, tk); if (p.email) await store.sessionAddEmail(sid, p.email); }
  }
  res.json({ memberships: await membershipsForSession(sid) });
});

// Stop remembering a pool (when removed from the dashboard) — drop its token and
// hide its pool so email-resolution doesn't bring it back.
app.post('/api/session/forget', async (req, res) => {
  const sid = parseCookies(req)[SESSION_COOKIE];
  const token = req.body?.token;
  if (sid && token) {
    const p = await store.getPlayerByToken(token);
    await store.sessionRemoveToken(sid, token);
    if (p) await store.sessionHide(sid, p.poolId);
  }
  res.json({ ok: true });
});

// Resolve a saved token -> who am I / which pool
app.get('/api/me', async (req, res) => {
  const player = await store.getPlayerByToken(req.query.token);
  if (!player) return res.status(404).json({ error: 'unknown token' });
  res.json({ player: selfPlayer(player), poolId: player.poolId });
});

// Update your coach profile: club name, badge image, phone (for text recovery).
app.post('/api/players/me', async (req, res) => {
  const player = await store.getPlayerByToken(req.body?.token);
  if (!player) return res.status(403).json({ error: 'unknown token' });
  const fields = {};
  if ('teamName' in req.body) {
    const tn = String(req.body.teamName || '').trim().slice(0, 30);
    fields.teamName = tn || null;
  }
  if ('image' in req.body) {
    const img = req.body.image;
    if (img === null || img === '') fields.image = null;
    else if (typeof img === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(img) && img.length <= 400_000) {
      fields.image = img;
    } else {
      return res.status(400).json({ error: 'image must be a small jpeg/png/webp data URL' });
    }
  }
  if ('phone' in req.body) {
    const ph = req.body.phone;
    if (ph === null || ph === '') fields.phone = null;
    else {
      const n = normalizePhone(ph);
      if (!n) return res.status(400).json({ error: 'enter a valid phone number' });
      fields.phone = n;
    }
  }
  if ('email' in req.body) {
    const em = req.body.email;
    if (em === null || em === '') fields.email = null;
    else {
      const n = normalizeEmail(em);
      if (!n) return res.status(400).json({ error: 'enter a valid email address' });
      fields.email = n;
    }
  }
  const updated = await store.updatePlayer(player.id, fields);
  // keep the remember-me cookie in step with the player's identity
  const sid = await attachSession(req, res, player.token);
  if (fields.email) await store.sessionAddEmail(sid, fields.email);
  await broadcast(player.poolId);
  res.json({ player: selfPlayer(updated || player) });
});

// ---- email magic-link login / recovery -------------------------------------
app.post('/api/auth/email/request', async (req, res) => {
  if (!emailEnabled()) return res.status(503).json({ error: "email login isn't set up yet" });
  const email = normalizeEmail(req.body?.email);
  if (!email) return res.status(400).json({ error: 'enter a valid email address' });
  const players = await store.getPlayersByEmail(email);
  if (players.length) {
    const token = randId(20);
    const code = sixDigit();
    await store.createLoginRequest({ email, code, token, ttlMs: 30 * 60 * 1000 });
    const link = `${appUrl(req)}/login?t=${token}`;
    const poolNames = [];
    for (const p of players) { const pool = await store.getPool(p.poolId); if (pool) poolNames.push(pool.name); }
    const { html, text } = magicLinkEmail({ link, code, poolNames: [...new Set(poolNames)] });
    const r = await sendEmail({ to: email, subject: 'Your World Cup Pool login link', html, text });
    console.log(`[auth] login link for ${email} (${players.length} membership${players.length === 1 ? '' : 's'}) ->`,
      r.ok ? `sent ${r.id}` : `FAILED ${r.error || r.status || 'unknown'}`);
  } else {
    console.log(`[auth] login request for unregistered email ${email} — nothing sent`);
  }
  res.json({ ok: true }); // generic — don't reveal whether the email is known
});

app.post('/api/auth/email/verify', async (req, res) => {
  let lr;
  if (req.body?.token) {
    lr = await store.findLoginRequest({ token: req.body.token });
    if (!lr) return res.status(400).json({ error: 'that link expired — request a new one' });
  } else {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || '').replace(/\D/g, '');
    if (!email || !code) return res.status(400).json({ error: 'enter your email and the code' });
    lr = await store.findLoginRequest({ email, code });
    if (!lr) return res.status(400).json({ error: 'wrong or expired code' });
  }
  await store.useLoginRequest(lr.token);
  const sid = await attachSession(req, res);
  await store.sessionAddEmail(sid, lr.email); // cookie now remembers this identity
  res.json({ memberships: await membershipsForSession(sid) });
});

// ---- text-message login / recovery -----------------------------------------
// Request a login text: sends a tap-link + 6-digit code to a known phone.
app.post('/api/auth/sms/request', async (req, res) => {
  if (!smsEnabled()) return res.status(503).json({ error: "texting isn't set up yet" });
  const phone = normalizePhone(req.body?.phone);
  if (!phone) return res.status(400).json({ error: 'enter a valid phone number' });
  const players = await store.getPlayersByPhone(phone);
  if (players.length) {
    const token = randId(20);
    const code = sixDigit();
    await store.createLoginRequest({ phone, code, token, ttlMs: 15 * 60 * 1000 });
    const link = `${appUrl(req)}/login?t=${token}`;
    await sendSMS(phone, `World Cup Pool: tap to get back in ${link} — or enter code ${code}. Expires in 15 min.`);
  }
  // Generic response — don't reveal whether the number is registered.
  res.json({ ok: true });
});

// ---- admin: override a draft with a manually-conducted result --------------
// Guarded by ADMIN_SECRET (header x-admin-key). Rewrites every pick.
const tierToRound = (tier) => (tier >= 7 ? 1 : tier >= 5 ? 2 : tier >= 3 ? 3 : 4);

app.post('/api/admin/pools/:code/override', async (req, res) => {
  if (!process.env.ADMIN_SECRET || req.get('x-admin-key') !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const pool = await store.getPoolByCode(req.params.code);
  if (!pool) return res.status(404).json({ error: 'pool not found' });
  const squads = Array.isArray(req.body?.squads) ? req.body.squads : null;
  if (!squads) return res.status(400).json({ error: 'squads array required' });

  const players = await store.getPlayers(pool.id);
  const norm = (s) => String(s || '').trim().toLowerCase();
  const matchPlayer = (name) => {
    const n = norm(name);
    let m = players.filter((p) => norm(p.name) === n);
    if (m.length !== 1) m = players.filter((p) => norm(p.name).startsWith(n) || norm(p.name).split(/\s+/)[0] === n);
    if (m.length !== 1) m = players.filter((p) => norm(p.name).includes(n));
    return m.length === 1 ? m[0] : null;
  };

  // Resolve + validate everything before touching the DB.
  const resolved = [];
  const usedCodes = new Set();
  for (const squad of squads) {
    const player = matchPlayer(squad.name);
    if (!player) return res.status(400).json({ error: `no unique player match for "${squad.name}"` });
    const teams = [];
    for (const code of (squad.teams || [])) {
      const t = teamByCode(code);
      if (!t) return res.status(400).json({ error: `unknown team code "${code}" for ${squad.name}` });
      if (usedCodes.has(t.code)) return res.status(400).json({ error: `team ${t.code} assigned twice` });
      usedCodes.add(t.code);
      teams.push(t);
    }
    resolved.push({ player, teams });
  }

  await store.clearPicks(pool.id);
  let pickNumber = 0;
  // insert round by round (worst tiers first) for tidy ordering
  for (let round = 1; round <= ROUND_COUNT; round++) {
    for (const { player, teams } of resolved) {
      for (const t of teams) {
        if (tierToRound(t.tier) !== round) continue;
        pickNumber += 1;
        await store.recordPick({ poolId: pool.id, playerId: player.id, teamCode: t.code, pot: round, pickNumber });
      }
    }
  }
  await store.updatePool(pool.id, {
    status: 'done', potIndex: ROUND_COUNT, pickIndex: 0,
    draftOrder: pool.draftOrder?.length ? pool.draftOrder : players.map((p) => p.id),
  });
  const state = await broadcast(pool.id, { event: 'draft-overridden' });
  console.log(`[admin] overrode draft for ${pool.joinCode}: ${pickNumber} picks across ${resolved.length} squads`);
  res.json({ ok: true, picks: pickNumber, squads: resolved.length, state });
});

// Verify a login (by tap-link token, or phone + code) -> returns memberships.
app.post('/api/auth/sms/verify', async (req, res) => {
  let lr;
  if (req.body?.token) {
    lr = await store.findLoginRequest({ token: req.body.token });
    if (!lr) return res.status(400).json({ error: 'that link expired — request a new text' });
  } else {
    const phone = normalizePhone(req.body?.phone);
    const code = String(req.body?.code || '').replace(/\D/g, '');
    if (!phone || !code) return res.status(400).json({ error: 'enter your phone and the code' });
    lr = await store.findLoginRequest({ phone, code });
    if (!lr) return res.status(400).json({ error: 'wrong or expired code' });
  }
  await store.useLoginRequest(lr.token);
  const players = await store.getPlayersByPhone(lr.phone);
  const memberships = [];
  for (const p of players) {
    const pool = await store.getPool(p.poolId);
    if (pool) memberships.push({ poolId: pool.id, code: pool.joinCode, name: pool.name, token: p.token, playerId: p.id });
  }
  res.json({ memberships });
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
  // Email everyone who left an address (except the commissioner kicking it off).
  if (emailEnabled()) {
    const link = `${appUrl(req)}/p/${pool.joinCode}`;
    const targets = players.filter((p) => p.email && p.id !== commissioner.id).map((p) => ({
      to: p.email,
      subject: `🏆 The draft for "${pool.name}" is starting`,
      text: `The draft for "${pool.name}" is starting now! Watch it live: ${link}`,
      html: `<div style="font-family:system-ui;padding:20px"><h2>🏆 "${pool.name}" — the draft is starting!</h2><p><a href="${link}">Watch it live →</a></p></div>`,
    }));
    if (targets.length) sendEmails(targets).catch(() => {});
  }
  res.json(state);
});

// Invite people by text (commissioner) — sends the join link to phone numbers.
app.post('/api/pools/:id/invite', async (req, res) => {
  if (!smsEnabled()) return res.status(503).json({ error: "texting isn't set up yet" });
  const commissioner = await requireCommissioner(req.body?.token, req.params.id);
  if (!commissioner) return res.status(403).json({ error: 'commissioner only' });
  const pool = await store.getPool(req.params.id);
  if (!pool) return res.status(404).json({ error: 'not found' });
  const raw = Array.isArray(req.body?.phones) ? req.body.phones : String(req.body?.phones || '').split(/[,\n]+/);
  const phones = [...new Set(raw.map(normalizePhone).filter(Boolean))];
  if (!phones.length) return res.status(400).json({ error: 'add at least one valid phone number' });
  const link = `${appUrl(req)}/p/${pool.joinCode}`;
  const r = await sendMany(phones.map((to) => ({
    to, body: `${commissioner.name} invited you to “${pool.name}” on World Cup Pool ⚽ Join: ${link}`,
  })));
  res.json({ sent: r.sent, total: r.total });
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
  res.json({ matches: await store.listMatches(), lastSync });
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
  // Reverting to the live feed: clear the manual override so the poller resumes.
  if (req.body.auto === true) fields.manual = false;
  // Any commissioner score edit locks the result against the auto-sync.
  else if ('scoreA' in fields || 'scoreB' in fields) fields.manual = true;
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

// ---- live schedule + score sync (ESPN, hourly) ----------------------------
const SCHEDULE_SNAPSHOT = (() => {
  try { return JSON.parse(readFileSync(path.join(__dirname, 'data', 'schedule.json'), 'utf8')); }
  catch { return []; }
})();

let lastSync = null;
let syncing = false;

async function syncSchedule({ seedIfEmpty = false } = {}) {
  if (syncing) return { skipped: true };
  syncing = true;
  try {
    let matches = await fetchAllMatches().catch((e) => {
      console.error('[sync] ESPN fetch failed:', e.message);
      return [];
    });
    let source = 'espn';
    if (!matches.length) {
      const existing = await store.listMatches();
      if (seedIfEmpty && existing.length === 0 && SCHEDULE_SNAPSHOT.length) {
        console.log('[sync] ESPN unavailable — seeding from committed snapshot');
        matches = SCHEDULE_SNAPSHOT; source = 'snapshot';
      } else {
        return { updated: 0, source: 'none', lastSync };
      }
    }
    for (const m of matches) {
      try { await store.upsertMatchByExtId(m); }
      catch (e) { console.error('[sync] upsert failed for', m.extId, e.message); }
    }
    lastSync = new Date().toISOString();
    io.emit('matches-updated');
    console.log(`[sync] ${matches.length} fixtures from ${source} at ${lastSync}`);
    return { updated: matches.length, source, lastSync };
  } finally {
    syncing = false;
  }
}

// Force a refresh now (commissioner).
app.post('/api/sync', async (req, res) => {
  if (!(await isAnyCommissioner(req.body?.token))) return res.status(403).json({ error: 'commissioner only' });
  const result = await syncSchedule();
  res.json(result);
});

app.get('/api/sync/status', (req, res) => res.json({ lastSync }));

// ---- scheduled jobs (driven by the cron service) --------------------------
// Registry of named jobs the cron service can trigger. Add new scheduled tasks
// here, then point a cron service at them via CRON_JOBS + a cronSchedule.
const JOBS = {
  sync: () => syncSchedule(),
};

app.post('/api/cron/:job', async (req, res) => {
  const key = req.get('x-cron-key');
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const job = JOBS[req.params.job];
  if (!job) return res.status(404).json({ error: `unknown job: ${req.params.job}` });
  try {
    const result = await job();
    res.json({ job: req.params.job, ok: true, ...result });
  } catch (e) {
    console.error(`[cron] job ${req.params.job} failed:`, e.message);
    res.status(500).json({ job: req.params.job, ok: false, error: e.message });
  }
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

server.listen(PORT, () => {
  console.log(`World Cup Draw listening on :${PORT}`);
  // Always sync once on boot (seed from snapshot if ESPN is unreachable).
  syncSchedule({ seedIfEmpty: true }).catch((e) => console.error('[sync] boot:', e.message));
  // Self-heal backstop: keep an in-process hourly sync unless an external cron
  // service owns scheduling (set SELF_SYNC=off on the web service then).
  if (process.env.SELF_SYNC !== 'off') {
    setInterval(() => syncSchedule().catch((e) => console.error('[sync] hourly:', e.message)), 60 * 60 * 1000);
  }
});
