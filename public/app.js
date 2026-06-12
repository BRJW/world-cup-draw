// World Cup Draw 2026 — vanilla JS SPA. No build step.
/* global io */

import { playAnnouncement } from '/announce.js?v=15';

const $app = document.getElementById('app');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const S = {
  view: 'dashboard',     // 'dashboard' | 'forms' | 'pool' | 'joinPrompt' | 'notfound'
  myPools: null,         // dashboard summaries (null = loading)
  poolCode: null,        // code in the URL for the current pool
  joinPool: null,        // {pool} when prompting a non-member to join
  homeMode: 'create',    // 'create' | 'join' (forms screen)
  tab: 'draft',          // draft | teams | standings | scores
  sms: false,            // (legacy) text messaging configured?
  email: false,          // is email (magic-link) configured on the server?
  recoverStep: 'email',  // 'email' | 'sent' | 'verifying'
  recoverEmail: '',
  teams: [],
  maxPlayers: 12,
  teamsPerPlayer: 4,
  rounds: [],
  me: null,              // {id,name,isCommissioner,phone}
  token: null,
  pool: null,
  players: [],
  picks: [],
  currentTurn: null,
  leaderboard: [],
  byPlayer: {},
  matches: [],
  lastSync: null,
  scoreFilter: 'all',    // 'all' | 'mine'
  editMatchId: null,
  syncing: false,
  pendingImage: null,    // resized badge waiting to be saved
  error: '',
  notice: '',
  prefillCode: '',
  animating: false,
};

// Membership store: { [poolId]: { token, playerId, code, name } } — one entry
// per pool you're in. Migrates the old single-pool identity if present.
const LS_KEY = 'wcd:pools';
function loadPools() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; } }
function savePool(poolId, data) {
  const m = loadPools(); m[poolId] = { ...m[poolId], ...data };
  try { localStorage.setItem(LS_KEY, JSON.stringify(m)); } catch { /* private mode */ }
}
function removePoolLocal(poolId) {
  const m = loadPools(); delete m[poolId];
  try { localStorage.setItem(LS_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}
(function migrate() {
  try {
    const old = localStorage.getItem('wcd:identity');
    if (old) {
      const { token, poolId } = JSON.parse(old);
      if (token && poolId) savePool(poolId, { token });
      localStorage.removeItem('wcd:identity');
    }
  } catch { /* ignore */ }
})();

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `request failed (${res.status})`); e.status = res.status; throw e; }
  return data;
}

// ---------------------------------------------------------------------------
// Socket  (degrade gracefully if socket.io failed to load — never blank-screen)
// ---------------------------------------------------------------------------
const socket = (typeof io !== 'undefined')
  ? io({ autoConnect: true })
  : { on() {}, emit() {}, on_stub: true };
let joinedPoolId = null;

socket.on('connect', () => { if (S.pool) joinRoom(S.pool.id); });
socket.on('state', (state) => {
  applyState(state);
  if (state.event === 'pick' && state.pick) animateReveal(state.pick);
  else render();
});
socket.on('matches-updated', () => { if (S.tab === 'scores' || S.tab === 'standings') refreshAux(); });

function joinRoom(poolId) {
  if (joinedPoolId === poolId) return;
  if (joinedPoolId) socket.emit('leave-pool', joinedPoolId);
  socket.emit('join-pool', poolId);
  joinedPoolId = poolId;
}

function applyState(state) {
  S.pool = state.pool;
  S.players = state.players || [];
  S.picks = state.picks || [];
  S.currentTurn = state.currentTurn || null;
  // merge public player fields but keep self-only fields like phone
  if (S.token) { const full = S.players.find((p) => p.id === S.me?.id); if (full) S.me = { ...S.me, ...full }; }
}

// ---------------------------------------------------------------------------
// Routing  ( /  = dashboard,  /p/<CODE> = a pool )
// ---------------------------------------------------------------------------
function navigate(path, replace = false) {
  if (location.pathname + location.search !== path) {
    history[replace ? 'replaceState' : 'pushState']({}, '', path);
  }
  route();
}
window.addEventListener('popstate', () => route());

async function boot() {
  try {
    const t = await api('/api/teams');
    S.teams = t.teams; S.maxPlayers = t.maxPlayers;
    S.teamsPerPlayer = t.teamsPerPlayer || 4; S.rounds = t.rounds || [];
    S.sms = !!t.sms; S.email = !!t.email;
  } catch { /* non-fatal */ }
  route();
}

function storeMemberships(list) {
  for (const m of list) savePool(m.poolId, { token: m.token, playerId: m.playerId, code: m.code, name: m.name });
}

async function route() {
  const path = location.pathname;
  const params = new URLSearchParams(location.search);
  if (path === '/login') { await loginFromLink(params.get('t')); return; }
  // legacy share links: /?join=CODE  ->  /p/CODE
  const legacy = params.get('join');
  const m = path.match(/^\/p\/([A-Za-z0-9]{4,8})\/?$/);
  if (legacy && !m) { navigate(`/p/${legacy.toUpperCase()}`, true); return; }
  if (m) { await openPool(m[1].toUpperCase()); return; }
  await showDashboard();
}

// Tap-link recovery: ?t=<token> -> restore memberships -> dashboard.
async function loginFromLink(token) {
  if (!token) { S.view = 'recover'; S.recoverStep = 'email'; return render(); }
  S.view = 'recover'; S.recoverStep = 'verifying'; render();
  try {
    const r = await api('/api/auth/email/verify', { method: 'POST', body: { token } });
    storeMemberships(r.memberships);
    history.replaceState({}, '', '/');
    toast(`You're back in — ${r.memberships.length} pool${r.memberships.length === 1 ? '' : 's'} restored`);
    await showDashboard();
  } catch (e) {
    history.replaceState({}, '', '/login');
    S.error = e.message; S.recoverStep = 'email'; render();
  }
}

async function openPool(code) {
  S.poolCode = code; S.error = '';
  let byCode;
  try { byCode = await api(`/api/pools/by-code/${code}`); }
  catch { S.view = 'notfound'; return render(); }

  const poolId = byCode.pool.id;
  const membership = loadPools()[poolId];
  if (membership?.token) {
    S.token = membership.token;
    S.me = membership.playerId ? { id: membership.playerId } : null;
    if (!S.me) {
      try { S.me = (await api(`/api/me?token=${membership.token}`)).player; savePool(poolId, { playerId: S.me.id }); }
      catch { /* token stale; fall through as member anyway */ }
    }
    await enterPool(poolId);
  } else {
    S.joinPool = byCode.pool; S.view = 'joinPrompt'; render();
  }
}

async function enterPool(poolId) {
  S.tab = 'draft';
  const state = await api(`/api/pools/${poolId}`);
  if (S.token) {
    try { S.me = { ...(S.me || {}), ...(await api(`/api/me?token=${S.token}`)).player }; } catch { /* ignore */ }
  }
  applyState(state);
  savePool(poolId, { code: state.pool.joinCode, name: state.pool.name });
  S.view = 'pool';
  joinRoom(poolId);
  await refreshAux();
  render();
}

async function showDashboard() {
  S.view = 'dashboard';
  const entries = Object.entries(loadPools());
  if (S.myPools === null) render(); // skeleton on first paint
  const summaries = await Promise.all(entries.map(([poolId, m]) => summarizePool(poolId, m)));
  S.myPools = summaries.filter(Boolean).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  render();
}

async function summarizePool(poolId, m) {
  try {
    const state = await api(`/api/pools/${poolId}`);
    let playerId = m.playerId;
    if (!playerId && m.token) {
      try { playerId = (await api(`/api/me?token=${m.token}`)).player.id; savePool(poolId, { playerId }); } catch { /* ignore */ }
    }
    savePool(poolId, { code: state.pool.joinCode, name: state.pool.name });
    const meP = state.players.find((p) => p.id === playerId) || null;
    const myTeams = state.picks.filter((p) => p.playerId === playerId)
      .map((p) => p.team || teamByCode(p.teamCode)).sort((a, b) => (a?.tier || 0) - (b?.tier || 0));
    return {
      poolId, code: state.pool.joinCode, name: state.pool.name, status: state.pool.status,
      createdAt: state.pool.createdAt, players: state.players.length, me: meP, myTeams,
    };
  } catch (e) {
    if (e.status === 404) { removePoolLocal(poolId); return null; } // pool gone
    return { poolId, code: m.code, name: m.name || 'A draw', status: '?', stale: true, players: 0, myTeams: [] };
  }
}

async function refreshAux() {
  if (!S.pool) return;
  try {
    if (S.tab === 'standings' || S.tab === 'teams') {
      const lb = await api(`/api/pools/${S.pool.id}/leaderboard`);
      S.leaderboard = lb.leaderboard; S.byPlayer = lb.byPlayer;
    }
    if (S.tab === 'scores' || S.tab === 'standings') {
      const m = await api('/api/matches');
      S.matches = m.matches; S.lastSync = m.lastSync;
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = (name) => name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const playerName = (id) => S.players.find((p) => p.id === id)?.name || '—';
const teamByCode = (code) => S.teams.find((t) => t.code === code);
const isCommissioner = () => !!S.me?.isCommissioner;
const takenCodes = () => new Set(S.picks.map((p) => p.teamCode));

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function render() {
  if (S.animating) return; // don't clobber a running reveal
  let html;
  if (S.view === 'pool') html = renderPool();
  else if (S.view === 'joinPrompt') html = renderJoinPrompt();
  else if (S.view === 'forms') html = renderForms();
  else if (S.view === 'recover') html = renderRecover();
  else if (S.view === 'notfound') html = renderNotFound();
  else html = renderDashboard();
  $app.innerHTML = html;
}

function poolUrl(code) { return `${location.origin}/p/${code}`; }

function renderDashboard() {
  const pools = S.myPools;
  const header = `<div class="app-header"><span class="ball">⚽</span><h1>World Cup Pool</h1></div>`;
  if (pools === null) {
    return header + `<div class="card"><div class="empty">Loading your draws…</div></div>`;
  }
  if (pools.length === 0) {
    // first run — go straight to the create/join forms
    return renderForms();
  }
  const cards = pools.map((p) => {
    const statusChip = { setup: 'Lobby', drafting: 'Live draft', done: 'Drafted', '?': 'Offline' }[p.status] || p.status;
    const flags = p.myTeams && p.myTeams.length ? p.myTeams.map((t) => t?.flag || '⚽').join(' ') : '';
    const sub = p.me
      ? (p.me.teamName ? esc(p.me.teamName) : `as ${esc(p.me.name)}`)
      : 'tap to open';
    return `<div class="card pool-card" data-action="open-pool" data-code="${p.code}">
      <button class="pool-x" data-action="remove-pool" data-id="${p.poolId}" title="Remove from list">✕</button>
      <div class="pool-card-top">
        <div style="flex:1;min-width:0">
          <div class="pool-card-name">${esc(p.name)}</div>
          <div class="club-sub">${sub}${p.me?.isCommissioner ? ' · Commish' : ''}</div>
        </div>
        <span class="chip">${statusChip}</span>
      </div>
      <div class="pool-card-bottom">
        <span class="muted small">${p.players} player${p.players === 1 ? '' : 's'}</span>
        <span class="pool-flags">${flags}</span>
      </div>
    </div>`;
  }).join('');
  return `${header}
    <div class="dash-actions">
      <button data-action="go-create">➕ New draw</button>
      <button class="secondary" data-action="go-join">Join with code</button>
    </div>
    <h3 class="section-h">Your draws</h3>
    ${cards}
    ${S.email ? `<p class="center small" style="margin-top:18px"><a class="link" data-action="go-recover">On a new device? Email me a login link →</a></p>` : ''}`;
}

function renderNotFound() {
  return `<div class="app-header"><span class="ball">⚽</span><h1>World Cup Pool</h1></div>
    <div class="card center">
      <div style="font-size:40px">🤔</div>
      <h2>Draw not found</h2>
      <p class="sub" style="text-align:center">That code doesn't match a draw. Check the link, or head back.</p>
      <button data-action="go-dashboard">← Your draws</button>
    </div>`;
}

function renderRecover() {
  if (S.recoverStep === 'verifying') {
    return `<div class="app-header"><span class="ball">⚽</span><h1>World Cup Pool</h1></div>
      <div class="card center"><div class="empty">Logging you in…</div></div>`;
  }
  const sent = S.recoverStep === 'sent';
  return `<div class="app-header">
      <button class="back-btn" data-action="go-dashboard">‹</button>
      <h1>Get back in</h1>
    </div>
    <div class="card">
    ${sent ? `
      <h2>Check your email 📬</h2>
      <p class="sub">If <b>${esc(S.recoverEmail)}</b> matches an email saved in a draw, a magic link is on its way — tap it, or enter the 6-digit code here. Nothing arriving? Check spam, and make sure it's the exact email you registered with.</p>
      <label>Code from the email</label>
      <input type="text" id="rec-code" inputmode="numeric" maxlength="6" placeholder="123456" style="letter-spacing:6px;font-weight:700;text-align:center" />
      <button data-action="recover-verify">Log in →</button>
      <button class="ghost" data-action="recover-back">Use a different email</button>
    ` : `
      <h2>Lost access?</h2>
      <p class="sub">Enter the email you registered with and we'll send a link to get back into all your draws — on any device.</p>
      <label>Email address</label>
      <input type="text" id="rec-email" inputmode="email" autocomplete="email" placeholder="you@example.com" value="${esc(S.recoverEmail)}" />
      <button data-action="recover-request">Email me a link →</button>
    `}
      <div class="error">${esc(S.error)}</div>
    </div>`;
}

function renderJoinPrompt() {
  const p = S.joinPool;
  const full = p.status !== 'setup';
  return `<div class="app-header">
      <button class="back-btn" data-action="go-dashboard">‹</button>
      <h1>${esc(p.name)}</h1>
    </div>
    <div class="card">
      <h2>${full ? 'This draw has already started' : "You're invited!"}</h2>
      <p class="sub">${full ? 'You can still watch, but joining is closed.' : `Join <b>${esc(p.name)}</b> and get your four teams in the live draw.`}</p>
      ${full ? `<button data-action="watch-pool">Watch this draw →</button>` : `
        <label>Your name</label>
        <input type="text" id="jp-name" maxlength="24" placeholder="e.g. Buster" />
        <label>Email <span class="muted small">— to log back in later</span></label>
        <input type="text" id="jp-email" inputmode="email" autocomplete="email" placeholder="you@example.com" />
        <button data-action="join-prompt-submit">Join the draw →</button>`}
      <div class="error">${esc(S.error)}</div>
      <button class="ghost" data-action="go-dashboard" style="margin-top:10px">Your other draws</button>
    </div>`;
}

function renderForms() {
  const create = S.homeMode === 'create';
  const hasPools = (S.myPools && S.myPools.length) || Object.keys(loadPools()).length;
  return `
  <div class="app-header">
    ${hasPools ? '<button class="back-btn" data-action="go-dashboard">‹</button>' : '<span class="ball">⚽</span>'}
    <h1>World Cup Pool</h1>
  </div>
  ${hasPools ? '' : '<p class="hero-tag">Draft the World Cup with your mates. <b>Winner takes all.</b></p>'}
  <div class="card">
    <div class="row" style="margin-bottom:16px">
      <button class="${create ? '' : 'secondary'}" data-action="mode" data-mode="create" style="margin:0">Create pool</button>
      <button class="${create ? 'secondary' : ''}" data-action="mode" data-mode="join" style="margin:0">Join pool</button>
    </div>
    ${create ? `
      <h2>Start a new pool</h2>
      <p class="sub">Up to 12 friends. 48 teams in 8 odds-based tiers, drafted in balanced pairs — every squad of four is equally weighted, so it comes down to who you back. Most points by the final wins it all.</p>
      <label>Pool name</label>
      <input type="text" id="pool-name" placeholder="The Lads' World Cup" maxlength="40" />
      <label>Your name (you'll be commissioner)</label>
      <input type="text" id="commish-name" placeholder="e.g. Buster" maxlength="24" />
      <label>Email <span class="muted small">— so you can log back in on any device</span></label>
      <input type="text" id="reg-email" inputmode="email" autocomplete="email" placeholder="you@example.com" />
      <button data-action="create-pool">Create pool →</button>
    ` : `
      <h2>Join a pool</h2>
      <p class="sub">Enter the 6-letter code your commissioner shared.</p>
      <label>Join code</label>
      <input type="text" id="join-code" placeholder="ABC123" maxlength="6" value="${esc(S.prefillCode)}" style="text-transform:uppercase;letter-spacing:4px;font-weight:700" />
      <label>Your name</label>
      <input type="text" id="join-name" placeholder="e.g. Buster" maxlength="24" />
      <label>Email <span class="muted small">— so you can log back in on any device</span></label>
      <input type="text" id="reg-email" inputmode="email" autocomplete="email" placeholder="you@example.com" />
      <button data-action="join-pool">Join →</button>
    `}
    <div class="error">${esc(S.error)}</div>
  </div>
  ${S.email ? `<p class="center small"><a class="link" data-action="go-recover">Already registered, on a new device? Email me a link →</a></p>` : ''}
  <p class="center muted small">Live draw · see your teams · track scores</p>`;
}

function renderPool() {
  const p = S.pool;
  let body = '';
  if (S.tab === 'draft') body = renderDraftTab();
  else if (S.tab === 'teams') body = renderTeamsTab();
  else if (S.tab === 'standings') body = renderStandingsTab();
  else if (S.tab === 'scores') body = renderScoresTab();

  const statusChip = { setup: 'Lobby', drafting: 'Live draft', done: 'Drafted' }[p.status] || p.status;
  return `
  <div class="app-header">
    <button class="back-btn" data-action="go-dashboard">‹</button>
    <h1>${esc(p.name)}</h1>
    <span class="spacer"></span>
    <span class="chip">${statusChip}</span>
  </div>
  ${body}
  <div class="tabs">
    ${tabBtn('draft', '🎲', 'Draft')}
    ${tabBtn('teams', '👤', 'My Teams')}
    ${tabBtn('standings', '🏆', 'Standings')}
    ${tabBtn('scores', '⚽', 'Scores')}
  </div>`;
}

const tabBtn = (id, ico, label) =>
  `<button class="${S.tab === id ? 'active' : ''}" data-action="tab" data-tab="${id}"><span class="ico">${ico}</span>${label}</button>`;

// ---- Draft tab ----
function renderDraftTab() {
  const p = S.pool;
  if (p.status === 'setup') return renderLobby();
  if (p.status === 'drafting') return renderLiveDraft();
  return renderDraftDone();
}

function renderLobby() {
  const link = poolUrl(S.pool.joinCode);
  const canStart = isCommissioner() && S.players.length >= 2;
  return `
  <div class="card">
    <h2>Invite your crew</h2>
    <p class="sub">Share this code or link. Up to ${S.maxPlayers} players.</p>
    <div class="share-box">
      <span class="code">${esc(S.pool.joinCode)}</span>
      <button class="secondary btn-inline" data-action="copy-code">Copy</button>
    </div>
    <div class="share-box" style="margin-top:8px">
      <span class="small muted" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(link)}</span>
      <button class="secondary btn-inline" data-action="copy-link">Copy link</button>
    </div>
  </div>
  <div class="card">
    <h2>Players <span class="muted small">(${S.players.length}/${S.maxPlayers})</span></h2>
    <div>${S.players.map(playerRow).join('')}</div>
  </div>
  <div class="card">
    ${isCommissioner() ? `
      <h2>Run the draft</h2>
      <p class="sub">Order is randomized at kickoff (you can reshuffle). Four rounds, worst first: underdog → dark horse → contender → headliner. The giants land last.</p>
      <button class="secondary" data-action="shuffle-order">🔀 Shuffle draft order</button>
      <button data-action="start-draft" ${canStart ? '' : 'disabled'}>Start the live draw →</button>
      ${S.players.length < 2 ? '<p class="muted small center">Need at least 2 players to start.</p>' : ''}
    ` : `
      <p class="center muted">Waiting for the commissioner to start the draw…</p>
      <p class="center small muted">This page updates live.</p>
    `}
    <div class="error">${esc(S.error)}</div>
    <div class="notice">${esc(S.notice)}</div>
  </div>`;
}

function avatar(pl) {
  return pl?.image
    ? `<img class="avatar avatar-img" src="${pl.image}" alt="" />`
    : `<div class="avatar">${esc(initials(pl?.name || '?'))}</div>`;
}

function playerRow(pl) {
  const isMe = pl.id === S.me?.id;
  const isTurn = S.currentTurn?.playerId === pl.id;
  return `<div class="player-row">
    ${avatar(pl)}
    <div class="name">${esc(pl.name)}${pl.teamName ? `<div class="club-sub">${esc(pl.teamName)}</div>` : ''}</div>
    ${pl.isCommissioner ? '<span class="badge host">Commish</span>' : ''}
    ${isMe ? '<span class="badge you">You</span>' : ''}
    ${isTurn ? '<span class="badge turn">Picking</span>' : ''}
  </div>`;
}

function renderLiveDraft() {
  const turn = S.currentTurn;
  const totalPicks = S.players.length * S.teamsPerPlayer;
  const made = S.picks.length;
  const pct = Math.round((made / totalPicks) * 100);
  const canDraw = turn && (isCommissioner() || S.me?.id === turn.playerId);
  const turnNm = turn ? playerName(turn.playerId) : '';
  const isMyTurn = turn && S.me?.id === turn.playerId;
  const ri = turn ? S.rounds[turn.round - 1] : null;
  const roundLabel = turn ? `Round ${turn.round}/4 · ${ri ? ri.label : ''}` : 'Draw complete';

  return `
  <div class="stage">
    <div class="turnline">${esc(roundLabel)} · Pick ${made + (turn ? 1 : 0)} of ${totalPicks}</div>
    <div class="turnname">${turn ? `${esc(turnNm)}${isMyTurn ? ' (you)' : ''} is up` : 'Draw complete'}</div>
    <div class="reveal" id="reveal">${lastFlag()}</div>
    <div class="reveal-name" id="reveal-name"></div>
    <div class="progress"><div style="width:${pct}%"></div></div>
    <div class="small muted">${made}/${totalPicks} teams drawn</div>
  </div>
  ${canDraw ? `<button data-action="draw-next" id="draw-btn">${isMyTurn ? '🎲 Draw your team!' : '🎲 Draw next team'}</button>` : ''}
  ${!canDraw && turn ? `<p class="center muted">Waiting for ${esc(turnNm)} to draw…</p>` : ''}
  <div class="error">${esc(S.error)}</div>
  ${renderTierBoard()}
  ${renderRecentPicks()}`;
}

function lastFlag() {
  const last = S.picks[S.picks.length - 1];
  return last ? (teamByCode(last.teamCode)?.flag || '⚽') : '🎩';
}

const PAIR_HINT = { 1: '↔ T4', 2: '↔ T3', 3: '↔ T2', 4: '↔ T1', 5: '↔ T8', 6: '↔ T7', 7: '↔ T6', 8: '↔ T5' };

function renderTierBoard() {
  const taken = takenCodes();
  let cols = '';
  for (const tier of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const teams = S.teams.filter((t) => t.tier === tier);
    cols += `<div class="pot-col">
      <h4><span class="tier-pill t${tier}">TIER ${tier}</span> <span class="muted" style="font-size:10px">${PAIR_HINT[tier]}</span></h4>
      ${teams.map((t) => `<div class="mini-team ${taken.has(t.code) ? 'taken' : ''}"><span>${t.flag}</span><span class="mt-name">${esc(t.name)}</span><span class="mt-odds">${esc(t.odds)}</span></div>`).join('')}
    </div>`;
  }
  return `<div class="card"><h2>The 8 tiers <span class="muted small">· odds to win</span></h2><div class="pot-board">${cols}</div></div>`;
}

function renderRecentPicks() {
  if (!S.picks.length) return '';
  const recent = [...S.picks].slice(-6).reverse();
  return `<div class="card"><h2>Latest picks</h2>
    ${recent.map((p) => {
      const t = p.team || teamByCode(p.teamCode);
      return `<div class="team"><span class="flag">${t?.flag || '⚽'}</span>
        <span class="tname">${esc(t?.name || p.teamCode)}</span>
        <span class="tier-pill t${t?.tier || 1}">T${t?.tier || '?'}</span>
        <span class="rec">→ ${esc(playerName(p.playerId))}</span></div>`;
    }).join('')}
  </div>`;
}

function renderDraftDone() {
  return `
  <div class="card center">
    <div style="font-size:44px">🎉</div>
    <h2>Draft complete!</h2>
    <p class="sub" style="text-align:center">Every player has their four teams. Head to <b>My Teams</b> to see yours, and <b>Standings</b> to track the race.</p>
    <button class="secondary" data-action="tab" data-tab="teams">See my teams →</button>
  </div>
  ${renderAllSquads()}`;
}

function renderAllSquads() {
  return `<div class="card"><h2>All squads</h2>
    ${S.players.map((pl) => {
      const teams = S.picks.filter((p) => p.playerId === pl.id)
        .map((p) => p.team || teamByCode(p.teamCode))
        .sort((a, b) => (a?.tier || 0) - (b?.tier || 0))
        .map((t) => t?.flag || '⚽').join(' ');
      return `<div class="player-row">
        ${avatar(pl)}
        <div class="name">${esc(pl.name)}${pl.teamName ? `<div class="club-sub">${esc(pl.teamName)}</div>` : ''}</div>
        <div style="font-size:20px;letter-spacing:2px">${teams}</div>
      </div>`;
    }).join('')}
  </div>`;
}

// ---- My Teams tab ----
function renderClubCard() {
  const me = S.players.find((p) => p.id === S.me?.id) || S.me;
  const preview = S.pendingImage || me?.image;
  return `<div class="card">
    <h2>Your club</h2>
    <p class="sub">Name your team of teams and add a badge — it shows up in the draw and the standings.</p>
    <div class="club-row">
      ${preview ? `<img class="club-avatar" src="${preview}" alt="" />` : `<div class="club-avatar club-avatar-empty">${esc(initials(me?.name || '?'))}</div>`}
      <div style="flex:1">
        <label>Club name</label>
        <input type="text" id="club-name" maxlength="30" placeholder="e.g. Buster's Galácticos" value="${esc(me?.teamName || '')}" />
      </div>
    </div>
    <label>Email ${me?.email ? '<span class="muted small">(saved ✓)</span>' : '<span class="muted small">— to log back in on a new device</span>'}</label>
    <input type="text" id="club-email" inputmode="email" autocomplete="email" placeholder="you@example.com" value="${esc(me?.email || '')}" />
    <div class="row" style="margin-top:14px">
      <button class="secondary" data-action="pick-badge">📷 ${preview ? 'Change badge' : 'Upload badge'}</button>
      <button data-action="save-profile">Save</button>
    </div>
    <input type="file" id="club-file" accept="image/*" style="display:none" />
    <div class="error">${esc(S.error)}</div>
  </div>`;
}

function renderTeamsTab() {
  if (!S.me) return `<div class="card empty">Join a pool to see your teams.</div>`;
  const club = renderClubCard();
  const mine = S.byPlayer[S.me.id] || S.picks.filter((p) => p.playerId === S.me.id).map((p) => ({ ...teamByCode(p.teamCode) }));
  if (!mine.length) {
    return club + `<div class="card empty">You don't have any teams yet.<br/>They'll appear here once the draft runs.</div>`;
  }
  const sorted = [...mine].sort((a, b) => a.tier - b.tier);
  return club + `<div class="card">
    <h2>${esc(S.players.find((p) => p.id === S.me.id)?.teamName || `Your squad, ${S.me.name}`)}</h2>
    <p class="sub">Four teams, balanced across the tiers. Every win banks 3 pts, a draw 1 — most points by the final takes the whole pool.</p>
    ${sorted.map((t) => {
      const r = t.record;
      const rec = r ? `${r.played}P · ${r.w}W ${r.d}D ${r.l}L · ${r.pts} pts` : 'No matches yet';
      return `<div class="team">
        <span class="flag">${t.flag || '⚽'}</span>
        <span class="tname">${esc(t.name)}<br/><span class="muted small">${esc(t.odds || '')} to win</span></span>
        <span class="tier-pill t${t.tier}">TIER ${t.tier}</span>
        <span class="rec" style="margin-left:8px">${rec}</span>
      </div>`;
    }).join('')}
  </div>`;
}

// ---- Standings tab ----
function renderStandingsTab() {
  if (!S.leaderboard.length) return `<div class="card empty">Standings appear once the draft is done and the first scores are in.</div>`;
  const leader = S.leaderboard[0];
  const tie = S.leaderboard.filter((r) => r.pts === leader.pts).length > 1;
  return `<div class="card">
    <h2>Standings</h2>
    <div class="wta-banner"><span class="trophy">🏆</span><span>Winner takes all — whoever's four teams bank the most points by the final lifts the trophy.</span></div>
    ${S.leaderboard.map((row, i) => {
      const pl = S.players.find((p) => p.id === row.playerId);
      const isLeader = i === 0 && row.pts > 0 && !tie;
      return `
      <div class="lb-row ${i === 0 ? 'top1' : ''}">
        <div class="lb-rank">${isLeader ? '👑' : i + 1}</div>
        ${avatar(pl)}
        <div style="flex:1;min-width:0">
          <div class="lb-name">${esc(pl?.teamName || row.name)} ${row.playerId === S.me?.id ? '<span class="badge you">You</span>' : ''}</div>
          ${pl?.teamName ? `<div class="club-sub">${esc(row.name)}</div>` : ''}
          <div class="lb-teams">${row.teams.map((t) => t.flag).join(' ')}</div>
          <div class="lb-sub">${row.w}W ${row.d}D ${row.l}L · GF ${row.gf} / GA ${row.ga}</div>
        </div>
        <div class="lb-pts">${row.pts}<div class="lb-sub" style="text-align:right">pts</div></div>
      </div>`;
    }).join('')}
  </div>`;
}

// ---- Scores tab ----
const myCodes = () => new Set(S.picks.filter((p) => p.playerId === S.me?.id).map((p) => p.teamCode));

function syncLine() {
  if (!S.lastSync) return 'Auto-updates hourly from ESPN';
  const mins = Math.round((Date.now() - new Date(S.lastSync)) / 60000);
  const ago = mins <= 0 ? 'just now' : mins === 1 ? '1 min ago' : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)}h ago`;
  return `Auto-updates hourly · last synced ${ago}`;
}

function renderScoresTab() {
  const mine = myCodes();
  let list = S.matches;
  if (S.scoreFilter === 'mine' && mine.size) list = list.filter((m) => mine.has(m.teamA) || mine.has(m.teamB));

  // group by local date
  const groups = [];
  const idx = {};
  for (const m of list) {
    const d = m.kickoff ? new Date(m.kickoff) : null;
    const key = d ? d.toDateString() : 'TBD';
    if (!(key in idx)) { idx[key] = groups.length; groups.push({ key, date: d, items: [] }); }
    groups[idx[key]].items.push(m);
  }

  const filterToggle = mine.size ? `
    <div class="row" style="margin-bottom:12px">
      <button class="${S.scoreFilter === 'all' ? '' : 'secondary'}" data-action="score-filter" data-f="all" style="margin:0">All games</button>
      <button class="${S.scoreFilter === 'mine' ? '' : 'secondary'}" data-action="score-filter" data-f="mine" style="margin:0">My teams</button>
    </div>` : '';

  return `
  <div class="card">
    <h2>Scores & schedule</h2>
    <p class="sub">${esc(syncLine())}</p>
    ${filterToggle}
    ${isCommissioner() ? `<button class="secondary" data-action="sync-now" ${S.syncing ? 'disabled' : ''}>${S.syncing ? 'Syncing…' : '↻ Sync now'}</button>` : ''}
    <div class="error">${esc(S.error)}</div>
  </div>
  ${groups.length ? groups.map(renderDateGroup).join('') : '<div class="card"><div class="empty">No fixtures yet — they\'ll load from the live feed shortly.</div></div>'}`;
}

function renderDateGroup(g) {
  const label = g.date
    ? g.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    : 'To be decided';
  return `<div class="card">
    <h3 class="date-head">${esc(label)}</h3>
    ${g.items.map(matchRow).join('')}
  </div>`;
}

function dispTeam(code, name) {
  const t = teamByCode(code);
  return t ? { flag: t.flag, name: t.name, real: true } : { flag: '⬚', name: name || code, real: false };
}

function matchRow(m) {
  const a = dispTeam(m.teamA, m.teamAName), b = dispTeam(m.teamB, m.teamBName);
  const editing = S.editMatchId === m.id;
  const hasScore = m.scoreA != null && m.scoreB != null;
  const live = m.status === 'in';
  const kickoff = m.kickoff ? new Date(m.kickoff).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';

  let mid;
  if (live) mid = `<span class="sc live">${m.scoreA}–${m.scoreB}</span>`;
  else if (hasScore) mid = `<span class="sc">${m.scoreA}–${m.scoreB}</span>`;
  else mid = `<span class="sc vs">${esc(kickoff || 'vs')}</span>`;

  const statusTag = live ? `<span class="live-dot"></span>${esc(m.statusDetail || 'LIVE')}`
    : m.status === 'post' ? 'FT'
    : (m.stage && m.stage !== 'Group' ? esc(m.stage) : esc(kickoff));

  const editBtn = (isCommissioner() && a.real && b.real)
    ? `<button class="mini-edit" data-action="edit-match" data-id="${m.id}">✎</button>` : '';

  const editor = editing ? `
    <div class="match-edit">
      <input type="number" id="ms-a-${m.id}" min="0" inputmode="numeric" value="${m.scoreA ?? ''}" />
      <span>–</span>
      <input type="number" id="ms-b-${m.id}" min="0" inputmode="numeric" value="${m.scoreB ?? ''}" />
      <button class="btn-inline" data-action="save-match" data-id="${m.id}">Save</button>
      ${m.manual ? `<button class="ghost btn-inline" data-action="auto-match" data-id="${m.id}">↻ auto</button>` : ''}
      <button class="ghost btn-inline" data-action="cancel-edit">✕</button>
    </div>` : '';

  return `<div class="match-row">
    <span class="t right">${esc(a.name)} ${a.flag}</span>
    ${mid}
    <span class="t">${b.flag} ${esc(b.name)}</span>
    ${editBtn}
  </div>
  <div class="match-meta">${statusTag}${m.manual ? ' · <span class="manual-tag">manual</span>' : ''}</div>
  ${editor}`;
}

// ---------------------------------------------------------------------------
// Full-screen SVG country announcement (shared module: /announce.js)
// ---------------------------------------------------------------------------
function animateReveal(pick) {
  const team = pick.team || teamByCode(pick.teamCode);
  render(); // refresh board/state underneath
  if (!team) { S.animating = false; return; }
  S.animating = true;
  const ri = S.rounds[(pick.round || 1) - 1];
  const coach = S.players.find((p) => p.id === pick.playerId) || { name: playerName(pick.playerId) };
  playAnnouncement(
    { team, roundLabel: `${ri ? ri.label : 'Pick'} · TIER ${team.tier}`, coach },
    () => { S.animating = false; render(); }
  );
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
const val = (id) => document.getElementById(id)?.value.trim() || '';

const actions = {
  mode(el) { S.homeMode = el.dataset.mode; S.error = ''; render(); },

  // ---- navigation ----
  'go-dashboard'() { S.error = ''; navigate('/'); },
  'go-create'() { S.error = ''; S.homeMode = 'create'; S.view = 'forms'; render(); },
  'go-join'() { S.error = ''; S.homeMode = 'join'; S.prefillCode = ''; S.view = 'forms'; render(); },
  'open-pool'(el) { navigate(`/p/${el.dataset.code}`); },
  'remove-pool'(el) {
    removePoolLocal(el.dataset.id);
    S.myPools = (S.myPools || []).filter((p) => p.poolId !== el.dataset.id);
    render();
  },

  async 'create-pool'() {
    S.error = '';
    const name = val('pool-name'), commissionerName = val('commish-name'), email = val('reg-email');
    if (!name || !commissionerName) { S.error = 'Fill in the pool name and your name.'; return render(); }
    try {
      const r = await api('/api/pools', { method: 'POST', body: { name, commissionerName, email } });
      S.token = r.player.token; S.me = r.player;
      savePool(r.pool.id, { token: r.player.token, playerId: r.player.id, code: r.pool.joinCode, name: r.pool.name });
      navigate(`/p/${r.pool.joinCode}`);
    } catch (e) { S.error = e.message; render(); }
  },

  async 'join-pool'() {
    S.error = '';
    const code = val('join-code').toUpperCase(), name = val('join-name'), email = val('reg-email');
    if (!code || !name) { S.error = 'Enter the code and your name.'; return render(); }
    try {
      const r = await api(`/api/pools/${code}/join`, { method: 'POST', body: { name, email } });
      S.token = r.player.token; S.me = r.player;
      savePool(r.pool.id, { token: r.player.token, playerId: r.player.id, code: r.pool.joinCode, name: r.pool.name });
      navigate(`/p/${r.pool.joinCode}`);
    } catch (e) { S.error = e.message; render(); }
  },

  async 'join-prompt-submit'() {
    S.error = '';
    const name = val('jp-name'), email = val('jp-email');
    if (!name) { S.error = 'Enter your name.'; return render(); }
    try {
      const r = await api(`/api/pools/${S.joinPool.joinCode}/join`, { method: 'POST', body: { name, email } });
      savePool(r.pool.id, { token: r.player.token, playerId: r.player.id, code: r.pool.joinCode, name: r.pool.name });
      navigate(`/p/${r.pool.joinCode}`);
    } catch (e) { S.error = e.message; render(); }
  },

  async 'watch-pool'() {
    // open as a spectator (no token) — view-only
    S.token = null; S.me = null;
    await enterPool(S.joinPool.id);
  },

  // ---- email magic-link login / recovery ----
  'go-recover'() { S.error = ''; S.recoverStep = 'email'; S.recoverEmail = ''; S.view = 'recover'; render(); },
  'recover-back'() { S.error = ''; S.recoverStep = 'email'; render(); },

  async 'recover-request'() {
    S.error = '';
    const email = val('rec-email');
    if (!email) { S.error = 'Enter your email address.'; return render(); }
    try {
      await api('/api/auth/email/request', { method: 'POST', body: { email } });
      S.recoverEmail = email; S.recoverStep = 'sent'; render();
    } catch (e) { S.error = e.message; render(); }
  },

  async 'recover-verify'() {
    S.error = '';
    const code = val('rec-code');
    if (!code) { S.error = 'Enter the code from the email.'; return render(); }
    try {
      const r = await api('/api/auth/email/verify', { method: 'POST', body: { email: S.recoverEmail, code } });
      if (!r.memberships.length) { S.error = 'No draws found for that email.'; return render(); }
      storeMemberships(r.memberships);
      toast(`You're back in — ${r.memberships.length} pool${r.memberships.length === 1 ? '' : 's'} restored`);
      navigate('/');
    } catch (e) { S.error = e.message; render(); }
  },

  tab(el) { S.tab = el.dataset.tab; S.error = ''; refreshAux().then(render); render(); },

  'copy-code'() { copy(S.pool.joinCode); toast('Code copied'); },
  'copy-link'() { copy(poolUrl(S.pool.joinCode)); toast('Invite link copied'); },

  async 'shuffle-order'() {
    try { await api(`/api/pools/${S.pool.id}/order`, { method: 'POST', body: { token: S.token } }); S.notice = 'Draft order shuffled.'; render(); }
    catch (e) { S.error = e.message; render(); }
  },

  async 'start-draft'() {
    S.error = '';
    try { await api(`/api/pools/${S.pool.id}/start`, { method: 'POST', body: { token: S.token } }); }
    catch (e) { S.error = e.message; render(); }
  },

  async 'draw-next'(el) {
    el.disabled = true; S.error = '';
    try { await api(`/api/pools/${S.pool.id}/draw`, { method: 'POST', body: { token: S.token } }); }
    catch (e) { S.error = e.message; el.disabled = false; render(); }
  },

  'score-filter'(el) { S.scoreFilter = el.dataset.f; render(); },

  async 'sync-now'() {
    S.error = ''; S.syncing = true; render();
    try { await api('/api/sync', { method: 'POST', body: { token: S.token } }); await refreshAux(); toast('Scores refreshed'); }
    catch (e) { S.error = e.message; }
    finally { S.syncing = false; render(); }
  },

  'edit-match'(el) { S.editMatchId = el.dataset.id; render(); },
  'cancel-edit'() { S.editMatchId = null; render(); },

  async 'save-match'(el) {
    const id = el.dataset.id; S.error = '';
    const body = { token: S.token, scoreA: val(`ms-a-${id}`), scoreB: val(`ms-b-${id}`) };
    try {
      await api(`/api/matches/${id}`, { method: 'PATCH', body });
      S.editMatchId = null; await refreshAux(); toast('Score saved (override)'); render();
    } catch (e) { S.error = e.message; render(); }
  },

  async 'auto-match'(el) {
    try {
      await api(`/api/matches/${el.dataset.id}`, { method: 'PATCH', body: { token: S.token, auto: true } });
      S.editMatchId = null; await refreshAux(); toast('Reverted to live feed'); render();
    } catch (e) { S.error = e.message; render(); }
  },

  'pick-badge'() { document.getElementById('club-file')?.click(); },

  async 'save-profile'() {
    S.error = '';
    const body = { token: S.token, teamName: val('club-name') };
    if (S.pendingImage) body.image = S.pendingImage;
    if (document.getElementById('club-email')) body.email = val('club-email');
    try {
      const r = await api('/api/players/me', { method: 'POST', body });
      S.me = { ...S.me, ...r.player };
      S.pendingImage = null;
      toast('Saved'); render();
    } catch (e) { S.error = e.message; render(); }
  },
};

// Resize an uploaded badge to a small square JPEG before sending.
async function resizeBadge(file, size = 160) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, err) => {
      const i = new Image();
      i.onload = () => ok(i); i.onerror = err; i.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const s = Math.min(img.width, img.height); // center-crop to square
    ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

document.addEventListener('change', async (e) => {
  if (e.target?.id !== 'club-file' || !e.target.files?.[0]) return;
  try {
    S.pendingImage = await resizeBadge(e.target.files[0]);
    render();
    toast('Badge ready — hit Save');
  } catch {
    S.error = "Couldn't read that image."; render();
  }
});

function copy(text) {
  if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el); }
});

// Enter-to-submit on home inputs
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (S.view === 'joinPrompt') return actions['join-prompt-submit']();
  if (S.view === 'recover') return actions[S.recoverStep === 'sent' ? 'recover-verify' : 'recover-request']();
  if (S.view !== 'forms' && !(S.view === 'dashboard' && (!S.myPools || !S.myPools.length))) return;
  if (S.homeMode === 'create') actions['create-pool']();
  else actions['join-pool']();
});

boot();
