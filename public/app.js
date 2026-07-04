// World Cup Draw 2026 — vanilla JS SPA. No build step.
/* global io */

import { playAnnouncement } from '/announce.js?v=39';
import { flagSVG } from '/flags.js?v=39';

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
let scoresAutoScrolled = false; // reset whenever the Scores tab is (re-)entered
let scoresScrollTarget = null;  // id of the first not-yet-finished fixture

socket.on('connect', () => { if (S.pool) joinRoom(S.pool.id); });
socket.on('state', (state) => {
  applyState(state);
  if (state.event === 'pick' && state.pick) animateReveal(state.pick);
  else render();
});
socket.on('matches-updated', () => {
  // re-render so live scores propagate to whichever match view is open
  if (['scores', 'standings', 'bracket'].includes(S.tab)) refreshAux().then(render);
});

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
  // Remember-me: bind known tokens to the server cookie and pull back any pools
  // the cookie remembers (restores them even if localStorage was wiped).
  try {
    const localTokens = Object.values(loadPools()).map((m) => m.token).filter(Boolean);
    const s = await api('/api/session/sync', { method: 'POST', body: { tokens: localTokens } });
    if (s.memberships?.length) storeMemberships(s.memberships);
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
    S.joinPool = byCode.pool;
    S.claimables = byCode.placeholders || [];
    S.view = 'joinPrompt'; render();
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
    if (S.tab === 'scores' || S.tab === 'standings' || S.tab === 'bracket') {
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
// Mirrors lib/draw.js's isFinal() — a manual commissioner override (manual:true)
// counts as final even if ESPN's own status field hasn't flipped to 'post' yet.
const isMatchFinal = (m) => m.status !== 'in' && !!(m.completed || m.manual || m.status === 'post');

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
  if (S.view === 'pool' && S.tab === 'scores') scrollToUpcomingMatch();
}

// Scroll the Scores tab down to the first fixture that isn't finished yet —
// once per tab-entry (the flag is reset in the `tab` action).
function scrollToUpcomingMatch() {
  if (scoresAutoScrolled || !scoresScrollTarget) return;
  scoresAutoScrolled = true;
  const id = scoresScrollTarget;
  requestAnimationFrame(() => {
    document.getElementById(`m-${id}`)?.scrollIntoView({ block: 'center' });
  });
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
  const started = p.status !== 'setup';
  const seats = S.claimables || [];
  const claimCard = seats.length ? `
    <div class="card">
      <h2>Is one of these you?</h2>
      <p class="sub">The commissioner saved you a seat${started ? ' — your teams are already drawn' : ''}. Tap your name to take it over.</p>
      <label>Email <span class="muted small">— optional, to log back in later</span></label>
      <input type="text" id="jp-email" inputmode="email" autocomplete="email" placeholder="you@example.com" />
      ${seats.map((s) => `<button class="secondary" data-action="claim-seat" data-id="${s.id}">That's me — ${esc(s.name)} →</button>`).join('')}
      <div class="error">${esc(S.error)}</div>
    </div>` : '';
  return `<div class="app-header">
      <button class="back-btn" data-action="go-dashboard">‹</button>
      <h1>${esc(p.name)}</h1>
    </div>
    ${claimCard}
    <div class="card">
      <h2>${started ? 'This draw has already started' : (seats.length ? 'Not on the list?' : "You're invited!")}</h2>
      <p class="sub">${started ? (seats.length ? 'You can also watch without claiming a seat.' : 'You can still watch, but joining is closed.') : `Join <b>${esc(p.name)}</b> and get your four teams in the live draw.`}</p>
      ${started ? `<button ${seats.length ? 'class="secondary"' : ''} data-action="watch-pool">Watch this draw →</button>` : `
        <label>Your name</label>
        <input type="text" id="jp-name" maxlength="24" placeholder="e.g. Buster" />
        ${seats.length ? '' : `<label>Email <span class="muted small">— to log back in later</span></label>
        <input type="text" id="jp-email" inputmode="email" autocomplete="email" placeholder="you@example.com" />`}
        <button data-action="join-prompt-submit">Join the draw →</button>`}
      ${seats.length ? '' : `<div class="error">${esc(S.error)}</div>`}
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
  else if (S.tab === 'bracket') body = renderBracketTab();
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
    ${tabBtn('bracket', '🏟️', 'Bracket')}
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
    ${isCommissioner() && S.players.length < S.maxPlayers ? `
      <label style="margin-top:14px">Hold a seat for someone</label>
      <div class="row">
        <input type="text" id="ph-name" maxlength="24" placeholder="e.g. Dave" />
        <button class="secondary btn-inline" data-action="add-placeholder" style="flex:0 0 auto">＋ Add</button>
      </div>
      <p class="muted small" style="margin-top:6px">You'll draw on their behalf; they can claim the seat from the invite link any time — even after the draft.</p>
    ` : ''}
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
    ${pl.placeholder ? '<span class="badge open">Open seat</span>' : ''}
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
  // merge so self-only fields (email) are present alongside public ones (teamName/image)
  const me = { ...(S.players.find((p) => p.id === S.me?.id) || {}), ...(S.me || {}) };
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
    ${me?.email ? `
      <label>Email <span class="muted small">— used to log back in</span></label>
      <div class="readonly-field">${esc(me.email)}</div>
    ` : `
      <label>Email <span class="muted small">— add one to log back in on a new device</span></label>
      <input type="text" id="club-email" inputmode="email" autocomplete="email" placeholder="you@example.com" />
    `}
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
  // Prefer the leaderboard row — it carries match records + elimination status;
  // byPlayer is just the raw picks (used only before the first scores land).
  const lbRow = S.leaderboard.find((r) => r.playerId === S.me.id);
  const mine = lbRow ? lbRow.teams
    : (S.byPlayer[S.me.id] || S.picks.filter((p) => p.playerId === S.me.id).map((p) => ({ ...teamByCode(p.teamCode) })));
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
      const out = t.status === 'out';
      return `<div class="team ${out ? 'team-out' : ''}">
        <span class="flag">${t.flag || '⚽'}</span>
        <span class="tname">${esc(t.name)}<br/><span class="muted small">${esc(t.odds || '')} to win</span></span>
        <span class="tier-pill t${t.tier}">TIER ${t.tier}</span>
        ${out ? '<span class="badge out">Out</span>' : ''}
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
    <div class="wta-banner"><span class="trophy">🏆</span><span>Winner takes all — whomever's team wins the cup, gets the cash!</span></div>
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
          <div class="lb-teams">${row.teams.map((t) => `<span class="${t.status === 'out' ? 'flag-out' : ''}">${t.flag}</span>`).join(' ')}</div>
          <div class="lb-sub">${row.w}W ${row.d}D ${row.l}L · GF ${row.gf} / GA ${row.ga}</div>
        </div>
        <div class="lb-pts">${row.pts}<div class="lb-sub" style="text-align:right">pts</div></div>
      </div>`;
    }).join('')}
  </div>`;
}

// ---- Bracket tab ----
// Which stages ever appear in the knockout data (Third-place is a side-note,
// not part of the winners' line towards the trophy).
const BRACKET_ORDER = ['Round of 32', 'Round of 16', 'Quarter-final', 'Semi-final', 'Final', 'Third-place'];
// The winners' line itself — each is exactly half the matches of the one
// before it, which is what lets the radial wheel nest a pair of outer wedges
// exactly under the inner wedge they feed (equal angular division per ring).
const BRACKET_FLOW = ['Round of 32', 'Round of 16', 'Quarter-final', 'Semi-final', 'Final'];

// The 2026 World Cup Round-of-16 bracket is a fixed template, but ESPN's live
// feed mis-pairs two of the still-undecided R16 slots — it sends Argentina's
// path into Switzerland/Algeria, when the real bracket is Argentina/Cape Verde
// vs Australia/Egypt and Switzerland/Algeria vs Colombia/Ghana (confirmed by
// Wikipedia, Sky Sports, CBS, Olympics.com, and ESPN's OWN editorial, which
// contradicts ESPN's structured feed). There's no reliable official-match-
// number field to derive the pairing from, so we pin it here: each entry is
// the two Round-of-32 fixtures (by sorted team codes) that feed one R16 slot,
// in official R16 order. Used to override the feed's pairing; anything not
// listed falls back to the feed's own placeholder data.
const WC2026_R16 = [
  [['RSA', 'CAN'], ['NED', 'MAR']],
  [['GER', 'PAR'], ['FRA', 'SWE']],
  [['BRA', 'JPN'], ['CIV', 'NOR']],
  [['MEX', 'ECU'], ['ENG', 'COD']],
  [['POR', 'CRO'], ['ESP', 'AUT']],
  [['USA', 'BIH'], ['BEL', 'SEN']],
  [['SUI', 'ALG'], ['COL', 'GHA']],
  [['AUS', 'EGY'], ['ARG', 'CPV']],
].map(([a, b]) => [a.slice().sort().join(','), b.slice().sort().join(',')]);

let bracketSelectedId = null;   // id of the match shown in the detail panel (cleared on tab-entry)
let bracketCoachFilter = null;  // playerId to spotlight (cleared on tab-entry)
let bracketHighlightCodes = null; // Set of team codes kept at full strength while filtering

const byKickoff = (a, b) => new Date(a.kickoff || 0) - new Date(b.kickoff || 0);

// Reconstruct the real bracket order for every round so that each match sits
// directly inward of the two it feeds from — the inner match at position j
// draws its feeders from outer positions 2j (its teamA side) and 2j+1 (its
// teamB side).
//
// The tree edges are NOT derivable from kickoff order or simple arithmetic:
// the World Cup bracket interleaves the halves (quarter-final 2 is fed by
// round-of-16 matches 5 and 6, not 3 and 4; round-of-16 5 is fed by round-of-
// 32 matches 11 and 12), so England and Argentina share a half while France
// sits in the other. That structure lives entirely in ESPN's OFFICIAL match
// numbering: the game IDs (`extId`) run in bracket-number order within each
// round, and every placeholder name ("Round of 16 5 Winner") references a
// feeder by that same official number. So:
//
//   1. Sort each round by extId -> official position (index i = match #i+1).
//   2. For each inner match, read its two feeders' official numbers: from the
//      placeholder number when abstract, or (once resolved) from the official
//      number of the outer match that team actually won. teamA's feeder first.
//   3. DFS from the Final outward, teamA-subtree before teamB-subtree. The
//      preorder walk emits each round left-to-right — the 2j / 2j+1 adjacency
//      the wheel needs — now following the true bracket, not kickoff order.
//
// Falls back to kickoff order for any round it can't fully build (a partly-
// synced schedule, or matches missing extId) rather than drawing a wrong tree.
const BRACKET_PREV = {
  'Round of 16': 'Round of 32', 'Quarter-final': 'Round of 16',
  'Semi-final': 'Quarter-final', 'Final': 'Semi-final',
};
function reconcileBracketOrder(byStage) {
  const kickoff = {}, official = {};
  for (const s of BRACKET_FLOW) {
    kickoff[s] = byStage[s] ? [...byStage[s]].sort(byKickoff) : [];
    // official (bracket) numbering = ascending game id; matches without an
    // extId sort last so real fixtures keep their true order.
    official[s] = [...kickoff[s]].sort((a, b) => (Number(a.extId) || Infinity) - (Number(b.extId) || Infinity));
  }
  const feederNum = (name) => { const m = /(\d+)\s*winner\s*$/i.exec(name || ''); return m ? Number(m[1]) : null; };
  const winnerCodeOf = (m) => {
    if (m.status === 'in' || m.scoreA == null || m.scoreB == null) return null;
    if (m.scoreA === m.scoreB) return m.shootout ? (m.winnerA ? m.teamA : m.teamB) : null;
    return m.scoreA > m.scoreB ? m.teamA : m.teamB;
  };
  // Official number (1-based) of the prev-round match a resolved side came from.
  const feederNumForSide = (code, name, prevStage) => {
    const ph = feederNum(name); if (ph != null) return ph;
    if (!code || !teamByCode(code)) return null;
    const idx = official[prevStage].findIndex((o) => winnerCodeOf(o) === code || o.teamA === code || o.teamB === code);
    return idx >= 0 ? idx + 1 : null;
  };

  // Round-of-32 fixture (sorted team-code key) -> its official number, for the
  // R16 template lookup below.
  const r32Key = (m) => [m.teamA, m.teamB].filter(Boolean).sort().join(',');
  const r32Num = new Map();
  official['Round of 32'].forEach((m, i) => r32Num.set(r32Key(m), i + 1));

  // Edge table: for each round, official match number -> [feederNumA, feederNumB].
  const edges = {};
  for (const s of BRACKET_FLOW) {
    if (s === 'Round of 32') continue;
    edges[s] = official[s].map((m, i) => {
      // R16 is pinned to the verified 2026 template (the feed mis-pairs two
      // slots — see WC2026_R16). Only override when both feeders resolve to
      // real R32 fixtures; otherwise fall through to the feed's own data.
      if (s === 'Round of 16' && WC2026_R16[i]) {
        let [kx, ky] = WC2026_R16[i];
        let nx = r32Num.get(kx), ny = r32Num.get(ky);
        if (nx && ny) {
          // Keep each side's feeder aligned with the side it actually sits on.
          // Either resolved side can prove a swap is needed (the feed may
          // resolve teamB while teamA is still a placeholder).
          const srcKeyOf = (code) => {
            if (!code || !teamByCode(code)) return null;
            const src = official['Round of 32'].find((o) => o.teamA === code || o.teamB === code);
            return src ? r32Key(src) : null;
          };
          if (srcKeyOf(m.teamA) === ky || srcKeyOf(m.teamB) === kx) [nx, ny] = [ny, nx];
          return [nx, ny];
        }
      }
      return [
        feederNumForSide(m.teamA, m.teamAName, BRACKET_PREV[s]),
        feederNumForSide(m.teamB, m.teamBName, BRACKET_PREV[s]),
      ];
    });
  }

  const ordered = {}; for (const s of BRACKET_FLOW) ordered[s] = [];
  let anchor = BRACKET_FLOW.length - 1; // innermost non-empty round
  while (anchor > 0 && !official[BRACKET_FLOW[anchor]].length) anchor--;
  const seen = new Set();
  const walk = (i, num) => {
    const list = official[BRACKET_FLOW[i]];
    const m = list[num - 1];
    if (!m || seen.has(m)) return; seen.add(m);
    ordered[BRACKET_FLOW[i]].push(m);
    if (i === 0) return;
    const [na, nb] = edges[BRACKET_FLOW[i]][num - 1] || [];
    if (na) walk(i - 1, na);
    if (nb) walk(i - 1, nb);
  };
  official[BRACKET_FLOW[anchor]].forEach((_, i) => walk(anchor, i + 1));
  // Any round the walk didn't fully populate (incomplete data) -> kickoff order.
  for (const s of BRACKET_FLOW) if (ordered[s].length !== kickoff[s].length) ordered[s] = kickoff[s];
  return ordered;
}

// ESPN's placeholder names ("Round of 32 8 Winner", "Quarterfinal 2 Winner")
// are too long to show inline — shorten them to "R32 Match 8" / "QF Match 2".
// ESPN's placeholder names repeat the source stage on every single wedge
// ("Round of 32 8 Winner", "Round of 32 11 Winner", ...) — the ring itself
// only ever references its own immediate previous round, so that's implied
// by context. Drop it and just say "Match 8" (or "Match 2 (L)" for a
// third-place loser reference) instead of saying the stage name over and
// over across a whole ring.
function shortenPlaceholder(name) {
  const m = /^(?:Round of \d+|Quarterfinal|Semifinal)\s+(\d+)\s+(Winner|Loser)$/i.exec(name || '');
  if (!m) return name;
  return `Match ${m[1]}${/loser/i.test(m[2]) ? ' (L)' : ''}`;
}

// Which side of a decided match lost (for strikethrough/greying)? Returns
// {outA, outB} — both false while the match is still open or ambiguous.
function bracketOutcome(m) {
  const hasScore = m.scoreA != null && m.scoreB != null;
  const final = isMatchFinal(m);
  let outA = false, outB = false;
  if (final && hasScore) {
    if (m.scoreA === m.scoreB && m.shootout && (m.winnerA != null || m.winnerB != null)) {
      outA = m.winnerA === false; outB = m.winnerB === false;
    } else if (m.scoreA > m.scoreB) outB = true;
    else if (m.scoreB > m.scoreA) outA = true;
  }
  return { outA, outB, final, live: m.status === 'in' };
}

const TAU = Math.PI * 2;
const polar = (cx, cy, r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];

function renderBracketTab() {
  const knockouts = S.matches.filter((m) => BRACKET_ORDER.includes(m.stage));
  if (!knockouts.length) {
    return `<div class="card empty">The bracket unlocks once the group stage wraps and the Round of 32 is set.</div>`;
  }
  const byStageRaw = {};
  for (const m of knockouts) (byStageRaw[m.stage] ||= []).push(m);
  const byStage = reconcileBracketOrder(byStageRaw);
  const third = byStageRaw['Third-place'] ? [...byStageRaw['Third-place']].sort(byKickoff)[0] : null;

  // Rings run outer (Round of 32) -> inner; the Final sits in the centre
  // bullseye instead of as a degenerate one-wedge ring.
  const ringStages = BRACKET_FLOW.slice(0, -1).filter((s) => byStage[s]?.length);
  const finalMatch = byStage['Final']?.[0] || null;

  // Coach spotlight: while a coach is selected, ALL of their teams stay at
  // full strength — eliminated ones included, keeping their grey/crossed
  // treatment, so you can see their whole campaign. Matches involving one
  // of their teams stay visible (including an upcoming one's kickoff
  // pill), with the opponent's node greyed unless it's also theirs;
  // matches involving none of their teams fade right back.
  bracketHighlightCodes = null;
  if (bracketCoachFilter) {
    const codes = S.picks.filter((p) => p.playerId === bracketCoachFilter).map((p) => p.teamCode);
    if (codes.length) bracketHighlightCodes = new Set(codes);
    else bracketCoachFilter = null; // player gone — fail open
  }

  const svg = renderBracketWheel(ringStages, byStage, finalMatch, third);
  // No default selection — showing an arbitrary match's detail card before
  // the user has tapped anything just reads as random. Live matches are
  // already highlighted directly on the wheel (see .bwedge-live).
  const selected = knockouts.find((m) => m.id === bracketSelectedId);

  const coaches = S.players.filter((pl) => S.picks.some((p) => p.playerId === pl.id));
  const filterRow = coaches.length ? `<div class="card bfilter">
    <button class="${!bracketCoachFilter ? 'active' : ''}" data-action="bracket-coach" data-id="">All</button>
    ${coaches.map((pl) => `<button class="${bracketCoachFilter === pl.id ? 'active' : ''}" data-action="bracket-coach" data-id="${pl.id}">${esc(pl.name.split(' ')[0])}</button>`).join('')}
  </div>` : '';

  return `<div class="card">
    <h2>Bracket</h2>
    <p class="sub">Tap any match on the wheel — outer ring is Round of 32, working in to the Final.</p>
  </div>
  <div class="card bracket-wheel-card">${svg}</div>
  ${filterRow}
  ${selected ? renderBracketDetail(selected) : ''}`;
}

// Tangential rotation for a label sitting at angle `aRad` (radians, 0 = 12
// o'clock, clockwise) — reads like a clock numeral, following the ring's
// curve, flipped 180° in the bottom half so it's never upside down. Used
// for the once-per-ring title sitting in the reserved top gap (angle 0),
// where it works out to perfectly horizontal.
function tangentDeg(aRad) {
  let deg = ((aRad * 180) / Math.PI) % 360;
  if (deg > 90 && deg < 270) deg += 180;
  return deg;
}

// Radial rotation — the label's baseline points straight along the spoke
// (like a wheel spoke / sunburst-chart leaf label) instead of curving with
// the ring, so two teams can sit side by side in one ring without doubling
// the wedge count. Flipped 180° on the left half so it's never upside down
// (the standard convention for radial dendrogram labels).
function radialDeg(aRad) {
  let deg = ((aRad * 180) / Math.PI - 90) % 360;
  if (deg < 0) deg += 360;
  if (deg > 90 && deg < 270) deg += 180;
  return deg % 360;
}

// A label that always fits its available space: compress (never stretch
// short text oddly wide) via textLength/lengthAdjust only when the natural
// size would overflow, so labels never collide.
function radialLabel(text, x, y, deg, availPx, fontSize, cls) {
  const estWidth = text.length * fontSize * 0.56;
  const constrain = estWidth > availPx ? ` textLength="${availPx.toFixed(1)}" lengthAdjust="spacingAndGlyphs"` : '';
  return `<text class="${cls || ''}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="middle" dominant-baseline="central" `
    + `font-size="${fontSize}" transform="rotate(${deg.toFixed(1)} ${x.toFixed(2)} ${y.toFixed(2)})"${constrain}>${esc(text)}</text>`;
}

// Two stacked lines (team name, coach) that stay correctly stacked at *any*
// rotation angle. Stacking via two different radii (i.e. two independent
// radialLabel calls) only reads as vertical separation near a ±90° rotation
// — near 0°/180° that same radial gap becomes a *horizontal* offset far too
// small to keep two full-width labels apart, so they collide. Fix: rotate a
// single <g> around one shared pivot, and offset the second line via `y` in
// the *pre-rotation* frame — the rotation carries that offset along with it,
// so it always ends up perpendicular to the text's own reading direction.
function radialLabelStack(lines, x, y, deg, availPx) {
  let inner = '';
  let cursorY = y;
  lines.forEach(([text, fontSize, cls], i) => {
    if (i > 0) cursorY += fontSize * 0.95;
    const estWidth = text.length * fontSize * 0.56;
    const constrain = estWidth > availPx ? ` textLength="${availPx.toFixed(1)}" lengthAdjust="spacingAndGlyphs"` : '';
    inner += `<text class="${cls || ''}" x="${x.toFixed(2)}" y="${cursorY.toFixed(2)}" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}"${constrain}>${esc(text)}</text>`;
  });
  return `<g transform="rotate(${deg.toFixed(1)} ${x.toFixed(2)} ${y.toFixed(2)})">${inner}</g>`;
}

const RING_TITLES = {
  'Round of 32': 'ROUND OF 32', 'Round of 16': 'ROUND OF 16',
  'Quarter-final': 'QUARTER-FINAL', 'Semi-final': 'SEMI-FINAL',
};
// A small gap reserved at the top of every ring for that ring's one-time
// title label, so it never collides with a match wedge; matches fill the
// remaining angular space evenly instead of the full circle.
const WHEEL_GAP_RAD = (13 * Math.PI) / 180;
const WHEEL_USABLE_RAD = TAU - WHEEL_GAP_RAD;
const wheelAngleAt = (i, n) => WHEEL_GAP_RAD / 2 + (i / n) * WHEEL_USABLE_RAD;

// A standard tournament bracket's elbow connector (two right-angle turns
// joining a pair of entrants to the match they feed) bent into polar space:
// an arc at the child ring's own radius sweeping from each team's angle to
// their shared midpoint, then one radial line inward to the next node. The
// winning side's own arc + the shared inward line are highlighted so you
// can trace a team's path forward at a glance; the losing side's arc stays
// plain since that branch stops here.
// The winner's own arc + the shared inward line highlight green (their path
// keeps going). The loser's own arc highlights red — but only up to the
// point the two paths meet, never continuing inward, since that branch
// stops right there.
// `suppressWin` = draw the winner's arc + the inward line plain rather than
// green. Used under the coach filter when the winner isn't one of the
// filtered coach's teams: their onward path belongs to the opponent, so we
// don't trace it green past the juncture. The loser's red arc still shows,
// since that's where the coach's own team's run ended.
function elbowConnector(cx, cy, rChild, aA, aB, rParent, winnerSide, suppressWin) {
  const aMid = (aA + aB) / 2;
  const [xA, yA] = polar(cx, cy, rChild, aA);
  const [xB, yB] = polar(cx, cy, rChild, aB);
  const [xM, yM] = polar(cx, cy, rChild, aMid);
  const [xP, yP] = polar(cx, cy, rParent, aMid);
  const arc = (x1, y1, x2, y2) => `M${x1.toFixed(2)},${y1.toFixed(2)} A${rChild.toFixed(2)},${rChild.toFixed(2)} 0 0,1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
  const win = winnerSide && !suppressWin;
  const clsFor = (side) => !winnerSide ? 'belbow' : winnerSide === side ? (win ? 'belbow belbow-win' : 'belbow') : 'belbow belbow-loss';
  const lineCls = win ? 'belbow belbow-win' : 'belbow';
  return `<path class="${clsFor('A')}" d="${arc(xA, yA, xM, yM)}"></path>
    <path class="${clsFor('B')}" d="${arc(xM, yM, xB, yB)}"></path>
    <line class="${lineCls}" x1="${xM.toFixed(2)}" y1="${yM.toFixed(2)}" x2="${xP.toFixed(2)}" y2="${yP.toFixed(2)}"></line>`;
}

// Render a team's flag as a true circle: a <circle> filled with a pattern
// built from flagSVG's vector art. Real flag art instead of an emoji glyph,
// which some browsers (iOS Safari confirmed) render as a blank placeholder
// box inside SVG <text> — and a pattern-filled circle instead of a clipped
// nested <svg>, because an objectBoundingBox clip-path on a nested svg
// resolves against its 300x200 viewBox coordinate system and squashes the
// "circle" into a 3:2 ellipse. The circle element's own geometry can't be
// anything but round. One shared <pattern> def per team code, collected in
// bracketFlagDefs during a render pass and emitted once into the wheel's
// <defs>.
let bracketFlagDefs = null;
function flagBadge(code, team, cx, cy, r, dim = false) {
  if (bracketFlagDefs && !bracketFlagDefs.has(code)) {
    const raw = flagSVG(code, team || teamByCode(code));
    const inner = raw.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    bracketFlagDefs.set(code, `<pattern id="bflag-${esc(code)}" width="1" height="1" viewBox="0 0 300 200" preserveAspectRatio="xMidYMid slice">${inner}</pattern>`);
  }
  // `dim` = this nation is out of the tournament here: desaturate the flag
  // (SVG filter — CSS filters on SVG elements are patchier across engines)
  // and cross it out with a 45° X kept inside the circle (0.7071 ≈ cos 45°).
  let html = `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="url(#bflag-${esc(code)})"${dim ? ' filter="url(#bdesat)" opacity="0.7"' : ''}></circle>`;
  if (dim) {
    const d = r * 0.7071;
    html += `<line class="bcross" x1="${(cx - d).toFixed(2)}" y1="${(cy - d).toFixed(2)}" x2="${(cx + d).toFixed(2)}" y2="${(cy + d).toFixed(2)}"></line>`
      + `<line class="bcross" x1="${(cx - d).toFixed(2)}" y1="${(cy + d).toFixed(2)}" x2="${(cx + d).toFixed(2)}" y2="${(cy - d).toFixed(2)}"></line>`;
  }
  return html;
}

function renderBracketWheel(ringStages, byStage, finalMatch, thirdMatch) {
  const SIZE = 640, CX = SIZE / 2, CY = SIZE / 2;
  const OUTER_R = SIZE / 2 - 20, CENTER_R = 42;
  const ringCount = Math.max(ringStages.length, 1);
  const step = (OUTER_R - CENTER_R) / ringCount;

  bracketFlagDefs = new Map(); // flagBadge() fills this as nodes render
  let nodes = '', titles = '';
  ringStages.forEach((stage, ri) => {
    const matches = byStage[stage];
    const rRing = OUTER_R - ri * step;
    const rNext = ri + 1 < ringCount ? OUTER_R - (ri + 1) * step : CENTER_R;
    const n = matches.length;
    matches.forEach((m, i) => {
      const cell0 = wheelAngleAt(i, n), cell1 = wheelAngleAt(i + 1, n);
      const aMid = (cell0 + cell1) / 2;
      // teams sit at the midpoint of their own half of the match's cell —
      // never at cell0/cell1 themselves, which are shared with the
      // neighbouring match and would otherwise put two teams' dots in
      // the same spot.
      const aA = (cell0 + aMid) / 2, aB = (aMid + cell1) / 2;
      nodes += bracketNode(m, CX, CY, rRing, rNext, aA, aB);
    });
    const [tx, ty] = polar(CX, CY, rRing, 0);
    titles += `<text class="bring-title" x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" text-anchor="middle" dominant-baseline="central" font-size="9">${esc(RING_TITLES[stage] || stage)}</text>`;
  });

  const centerContent = finalMatch ? bracketCenter(finalMatch, CX, CY, CENTER_R) : `
    <circle cx="${CX}" cy="${CY}" r="${CENTER_R}" fill="var(--card2)" stroke="var(--line)" />
    <text x="${CX}" y="${CY + 4}" text-anchor="middle" font-size="22">🏆</text>`;
  // sits in the open cavity below the bullseye — see bracketThird
  const thirdContent = thirdMatch ? bracketThird(thirdMatch, CX, CY, CENTER_R) : '';

  // defs materialized last — flagBadge() registers a pattern per team code
  // while everything above renders (defs placement in the output doesn't
  // matter to SVG). bdesat is the eliminated-flag desaturation.
  const defs = `<defs><filter id="bdesat"><feColorMatrix type="saturate" values="0.15"></feColorMatrix></filter>${[...bracketFlagDefs.values()].join('')}</defs>`;
  bracketFlagDefs = null;

  return `<svg viewBox="0 0 ${SIZE} ${SIZE}" class="bracket-wheel" xmlns="http://www.w3.org/2000/svg">
    ${defs}
    ${nodes}
    ${centerContent}
    ${thirdContent}
    ${titles}
  </svg>`;
}

// A match is two flag-badge nodes (one per team, like leaves of a tree) plus
// the elbow connector feeding the winner into the next ring in — a smaller
// name (+ coach) label sits just inside each node. The node itself is the
// real vector flag art (not an emoji glyph — see flagBadge), ringed green
// once that team has won its tie or red once it's lost, and the winner's
// branch of the connector is highlighted so their path forward is obvious
// at a glance.
function bracketNode(m, cx, cy, rRing, rNext, aA, aB) {
  const a = dispTeam(m.teamA, m.teamAName), b = dispTeam(m.teamB, m.teamBName);
  const { outA, outB, final, live } = bracketOutcome(m);
  const ownA = a.real ? ownerInfo(m.teamA) : null;
  const ownB = b.real ? ownerInfo(m.teamB) : null;
  const selected = m.id === bracketSelectedId;
  // Only claim a colour once we're sure: a final match where exactly one
  // side is marked out. An ambiguous draw with no shootout data (a known
  // gap — see README) stays neutral rather than guessing a winner.
  const decided = final && (outA || outB);
  const winnerSide = decided ? (outA ? 'B' : 'A') : null;

  const annulus = rRing - rNext;
  const teamSpanRad = (aB - aA) / 2; // each team's own angular allocation
  const fontSize = Math.min(10, Math.max(7, teamSpanRad * rRing * 0.44));
  const coachFontSize = Math.max(6.5, fontSize - 2);
  const dotR = Math.min(13, Math.max(7, teamSpanRad * rRing * 0.42));

  // Undecided placeholder slots ("Round of 32 8 Winner") get a bare node —
  // no text, no flag. There's nothing useful to say about a slot until it
  // actually resolves to a team, and a whole ring of "Match N" labels was
  // just noise.
  const team = (angle, t, code, out, own, isWinner, gray = false) => {
    const [dx, dy] = polar(cx, cy, rRing, angle);
    const resultCls = decided ? (isWinner ? ' bnode-win' : ' bnode-loss') : '';
    let html = `<circle class="bnode${resultCls}${!t.real ? ' bnode-tbd' : ''}" cx="${dx.toFixed(2)}" cy="${dy.toFixed(2)}" r="${dotR.toFixed(2)}"></circle>`;
    if (t.real) {
      // Flag fills the node circle (inset just enough to keep the win/loss
      // ring stroke visible all the way around). The label block runs
      // inward on its own rotation — team name then coach as two lines
      // stacked in the text's own local frame (see radialLabelStack), so
      // they never collide with each other and are never upside down. The
      // stack's pivot is placed so the label's *near end* sits at `gap`
      // from the node centre: text-anchor is middle, so a centred pivot
      // must back off by half the actual rendered width or long names
      // would extend back over the flag.
      html += flagBadge(code, teamByCode(code), dx, dy, dotR - 1.5, out);
      const deg = radialDeg(angle);
      const gap = dotR + 5;
      const availLen = Math.max(20, annulus - gap - 10);
      const estName = t.name.length * fontSize * 0.56;
      const estCoach = own ? own.name.length * coachFontSize * 0.56 : 0;
      const span = Math.min(Math.max(estName, estCoach), availLen);
      const [nx, ny] = polar(cx, cy, rRing - gap - span / 2, angle);
      const lines = [[t.name, fontSize, out ? 'bwedge-out-text' : '']];
      if (own) lines.push([own.name, coachFontSize, `bwedge-coach${own.isMe ? ' me' : ''}`]);
      html += radialLabelStack(lines, nx, ny, deg, availLen);
    }
    return gray ? `<g class="bteam-dim">${html}</g>` : html;
  };

  const [jx, jy] = polar(cx, cy, rRing, (aA + aB) / 2);
  const scorePill = junctionPill(jx, jy, m, a.real && b.real);

  // Filter active + this match involves the coach: their side stays full
  // strength, the opponent's node greys individually (unless it's also one
  // of theirs). A match with none of their teams dims as a whole group.
  const hl = bracketHighlightCodes;
  const groupDim = bracketDimmed(m, a, b);
  const grayA = !!(hl && !groupDim && !(a.real && hl.has(m.teamA)));
  const grayB = !!(hl && !groupDim && !(b.real && hl.has(m.teamB)));
  // Under the filter, don't trace the green path onward when the winner isn't
  // one of the coach's teams (their team lost here, or neither is theirs).
  const winnerCode = winnerSide === 'A' ? m.teamA : winnerSide === 'B' ? m.teamB : null;
  const suppressWin = !!(hl && winnerCode && !hl.has(winnerCode));

  return `<g class="bwedge${selected ? ' bwedge-selected' : ''}${live ? ' bwedge-live' : ''}${groupDim ? ' bwedge-dim' : ''}" data-action="select-bracket-match" data-id="${esc(m.id)}">
    ${elbowConnector(cx, cy, rRing, aA, aB, rNext, winnerSide, suppressWin)}
    ${team(aA, a, m.teamA, outA, ownA, winnerSide === 'A', grayA)}
    ${team(aB, b, m.teamB, outB, ownB, winnerSide === 'B', grayB)}
    ${scorePill}
  </g>`;
}

// A small pill at a match's juncture (where the two teams' branches meet).
// Played/in-play matches show the score (order matches the nodes: left
// number = first team clockwise), with the penalty result on a second line
// when the tie went to a shootout. A match whose teams are both set but
// hasn't kicked off yet shows its kickoff date + time (viewer's local
// timezone) instead. The wheel re-renders on every live sync, so an
// in-play score ticks up in place.
function junctionPill(jx, jy, m, bothReal) {
  const pill = (lines, extraCls = '') => {
    const w = Math.max(...lines.map(([t, fs]) => t.length * fs * 0.62)) + 8;
    const h = lines.length > 1 ? 21 : 13;
    const ys = lines.length > 1 ? [jy - 4.5, jy + 5.5] : [jy + 0.5];
    return `<g class="bscore${extraCls}">
      <rect x="${(jx - w / 2).toFixed(2)}" y="${(jy - h / 2).toFixed(2)}" width="${w.toFixed(2)}" height="${h}" rx="6.5"></rect>
      ${lines.map(([t, fs, cls], i) => `<text class="${cls || ''}" x="${jx.toFixed(2)}" y="${ys[i].toFixed(2)}" text-anchor="middle" dominant-baseline="central" font-size="${fs}">${esc(t)}</text>`).join('')}
    </g>`;
  };
  if (m.scoreA != null && m.scoreB != null) {
    const lines = [[`${m.scoreA}–${m.scoreB}`, 8.5, '']];
    if (m.shootout && m.penA != null && m.penB != null) lines.push([`p ${m.penA}–${m.penB}`, 6.5, 'bscore-sub']);
    return pill(lines);
  }
  if (bothReal && m.status === 'pre' && m.kickoff) {
    const d = new Date(m.kickoff);
    return pill([
      [d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), 7, ''],
      [d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }), 6.5, 'bscore-sub'],
    ], ' bscore-kick');
  }
  return '';
}

// Coach spotlight: dim any match that doesn't involve one of the filtered
// coach's still-remaining teams (the opponent in a relevant match stays
// visible — you want to see who they're up against).
function bracketDimmed(m, a, b) {
  const hl = bracketHighlightCodes;
  return !!(hl && !((a.real && hl.has(m.teamA)) || (b.real && hl.has(m.teamB))));
}

function bracketCenter(m, cx, cy, r) {
  const a = dispTeam(m.teamA, m.teamAName), b = dispTeam(m.teamB, m.teamBName);
  const { outA, outB, final } = bracketOutcome(m);
  const selected = m.id === bracketSelectedId;
  const avail = r * 1.5;
  // Coach filter applies here too — but only the per-side grey, never the
  // whole-group fade: the FINAL bullseye is the wheel's anchor and washing
  // it out reads as a rendering bug rather than a filter.
  const hl = bracketHighlightCodes;
  const grayA = !!(hl && !(a.real && hl.has(m.teamA)));
  const grayB = !!(hl && !(b.real && hl.has(m.teamB)));
  if (final) {
    const champCode = outA ? m.teamB : outB ? m.teamA : null;
    const champ = outA ? b : outB ? a : null;
    const champGray = !!(hl && champCode && !hl.has(champCode));
    return `<g class="bwedge${selected ? ' bwedge-selected' : ''}" data-action="select-bracket-match" data-id="${esc(m.id)}">
      <circle cx="${cx}" cy="${cy}" r="${r}" class="bcenter-final"></circle>
      ${champGray ? '<g class="bteam-dim">' : ''}
      ${champ ? flagBadge(champCode, teamByCode(champCode), cx, cy - 12, r * 0.42) : `<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="22">🏆</text>`}
      ${champ ? radialLabel(champ.name, cx, cy + 16, 0, avail, 12, 'bcenter-name') : ''}
      ${champGray ? '</g>' : ''}
      <text x="${cx}" y="${cy + (champ ? 30 : 22)}" text-anchor="middle" font-size="9" class="bcenter-label">${champ ? 'CHAMPION' : 'FINAL'}</text>
    </g>`;
  }
  // There's only one Final match, whether or not its two finalists are
  // known yet — never label the two (still-empty) sides "Match 1"/"Match 2"
  // the way an undecided wedge elsewhere shows no text at all. Only show a
  // finalist's flag once that side has actually resolved to a real team.
  const side = (real, inner, gray) => !real ? '' : gray ? `<g class="bteam-dim">${inner}</g>` : inner;
  return `<g class="bwedge${selected ? ' bwedge-selected' : ''}" data-action="select-bracket-match" data-id="${esc(m.id)}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--card2)" stroke="var(--line)"></circle>
    ${side(a.real, flagBadge(m.teamA, teamByCode(m.teamA), cx - r * 0.36, cy - r * 0.3, r * 0.34)
      + radialLabel(a.name, cx - r * 0.36, cy + r * 0.32, 0, r * 0.66, 8, outA ? 'bwedge-out-text' : ''), grayA)}
    ${side(b.real, flagBadge(m.teamB, teamByCode(m.teamB), cx + r * 0.36, cy - r * 0.3, r * 0.34)
      + radialLabel(b.name, cx + r * 0.36, cy + r * 0.32, 0, r * 0.66, 8, outB ? 'bwedge-out-text' : ''), grayB)}
    <text x="${cx}" y="${cy + r * 0.62}" text-anchor="middle" font-size="9" class="bcenter-label">FINAL</text>
  </g>`;
}

function renderBracketDetail(m) {
  const a = dispTeam(m.teamA, m.teamAName), b = dispTeam(m.teamB, m.teamBName);
  const nameA = a.real ? a.name : shortenPlaceholder(a.name);
  const nameB = b.real ? b.name : shortenPlaceholder(b.name);
  const hasScore = m.scoreA != null && m.scoreB != null;
  const { outA, outB, final, live } = bracketOutcome(m);
  const ownA = a.real ? ownerInfo(m.teamA) : null;
  const ownB = b.real ? ownerInfo(m.teamB) : null;
  const ownerLine = (o) => o ? `<div class="bm-owner ${o.isMe ? 'me' : ''}">${esc(o.name)}</div>` : '';

  let meta = '';
  if (live) meta = `<div class="bm-meta live"><span class="live-dot"></span>${esc(m.statusDetail || 'LIVE')}</div>`;
  else if (final) {
    const label = m.shootout ? `Pens ${m.penA ?? '?'}-${m.penB ?? '?'}` : (m.status === 'post' && m.statusDetail ? m.statusDetail : 'FT');
    meta = `<div class="bm-meta">${esc(label)}</div>`;
  } else if (m.kickoff) meta = `<div class="bm-meta">${esc(new Date(m.kickoff).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }))}</div>`;

  return `<div class="card bracket-detail">
    <h3 class="date-head">${esc(m.stage === 'Third-place' ? '🥉 Third place' : m.stage)}</h3>
    <div class="bracket-match">
      <div class="bm-team ${outA ? 'bm-out' : ''}">
        <span class="bm-flag">${a.flag}</span><span class="bm-name">${esc(nameA)}</span>
        ${hasScore ? `<span class="bm-score">${esc(m.scoreA)}</span>` : ''}
      </div>
      ${ownerLine(ownA)}
      <div class="bm-team ${outB ? 'bm-out' : ''}">
        <span class="bm-flag">${b.flag}</span><span class="bm-name">${esc(nameB)}</span>
        ${hasScore ? `<span class="bm-score">${esc(m.scoreB)}</span>` : ''}
      </div>
      ${ownerLine(ownB)}
      ${meta}
    </div>
  </div>`;
}

// The third-place match lives inside the wheel, in the open cavity just
// below the FINAL bullseye — it isn't part of the winners' line (nothing
// feeds into or out of it), so it gets no connectors, just its two nodes,
// a title, and the same score/kickoff pill every other match has. Drawn
// horizontally: at the bottom-centre of the wheel that's the natural
// reading orientation.
function bracketThird(m, cx, cy, centerR) {
  const a = dispTeam(m.teamA, m.teamAName), b = dispTeam(m.teamB, m.teamBName);
  const { outA, outB, final, live } = bracketOutcome(m);
  const decided = final && (outA || outB);
  const winnerSide = decided ? (outA ? 'B' : 'A') : null;
  const selected = m.id === bracketSelectedId;
  const y = cy + centerR + 32;
  const nodeR = 10;

  const node = (x, t, code, out, isWinner, gray) => {
    const resultCls = decided ? (isWinner ? ' bnode-win' : ' bnode-loss') : '';
    let html = `<circle class="bnode${resultCls}${!t.real ? ' bnode-tbd' : ''}" cx="${x.toFixed(2)}" cy="${y}" r="${nodeR}"></circle>`;
    if (t.real) {
      html += flagBadge(code, teamByCode(code), x, y, nodeR - 1.5, out);
      const own = ownerInfo(code);
      const lines = [[t.name, 6.5, out ? 'bwedge-out-text' : '']];
      if (own) lines.push([own.name, 6, `bwedge-coach${own.isMe ? ' me' : ''}`]);
      html += radialLabelStack(lines, x, y + nodeR + 8, 0, 54);
    }
    return gray ? `<g class="bteam-dim">${html}</g>` : html;
  };

  const hl = bracketHighlightCodes;
  const groupDim = bracketDimmed(m, a, b);
  const grayA = !!(hl && !groupDim && !(a.real && hl.has(m.teamA)));
  const grayB = !!(hl && !groupDim && !(b.real && hl.has(m.teamB)));

  return `<g class="bwedge${selected ? ' bwedge-selected' : ''}${live ? ' bwedge-live' : ''}${groupDim ? ' bwedge-dim' : ''}" data-action="select-bracket-match" data-id="${esc(m.id)}">
    <text class="bring-title" x="${cx}" y="${y - nodeR - 12}" text-anchor="middle" dominant-baseline="central" font-size="8">🥉 3RD PLACE</text>
    ${node(cx - 32, a, m.teamA, outA, winnerSide === 'A', grayA)}
    ${node(cx + 32, b, m.teamB, outB, winnerSide === 'B', grayB)}
    ${junctionPill(cx, y, m, a.real && b.real)}
  </g>`;
}

// ---- Scores tab ----
const myCodes = () => new Set(S.picks.filter((p) => p.playerId === S.me?.id).map((p) => p.teamCode));

function syncLine() {
  const liveNow = S.matches.some((m) => m.status === 'in');
  if (!S.lastSync) return 'Updates every minute during games';
  const mins = Math.round((Date.now() - new Date(S.lastSync)) / 60000);
  const ago = mins <= 0 ? 'just now' : mins === 1 ? '1 min ago' : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)}h ago`;
  return `${liveNow ? 'Updating live (every minute)' : 'Updates live during games · hourly otherwise'} · synced ${ago}`;
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

  // Auto-scroll target: the first fixture that isn't finished yet (live or upcoming).
  scoresScrollTarget = list.find((m) => !isMatchFinal(m))?.id || null;

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
    ${g.items.map((m) => `<div id="m-${esc(m.id)}">${matchRow(m)}</div>`).join('')}
  </div>`;
}

function dispTeam(code, name) {
  const t = teamByCode(code);
  return t ? { flag: t.flag, name: t.name, real: true } : { flag: '⬚', name: name || code, real: false };
}

// Which coach in THIS pool drafted a given country (for the "Ben vs Shiv" line).
function ownerInfo(code) {
  const pick = S.picks.find((p) => p.teamCode === code);
  if (!pick) return null;
  const pl = S.players.find((p) => p.id === pick.playerId);
  if (!pl) return null;
  return { id: pl.id, name: pl.name.split(' ')[0], isMe: pl.id === S.me?.id };
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

  const ownA = a.real ? ownerInfo(m.teamA) : null;
  const ownB = b.real ? ownerInfo(m.teamB) : null;
  const owner = (o) => o ? `<span class="ow ${o.isMe ? 'me' : ''}">${esc(o.name)}</span>` : '';
  const ownersLine = (ownA || ownB) ? `<div class="match-owners">
      <span class="t right">${owner(ownA)}</span>
      <span class="ow-vs">vs</span>
      <span class="t">${owner(ownB)}</span>
    </div>` : '';

  return `<div class="match-row">
    <span class="t right">${esc(a.name)} ${a.flag}</span>
    ${mid}
    <span class="t">${b.flag} ${esc(b.name)}</span>
    ${editBtn}
  </div>
  ${ownersLine}
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
    const id = el.dataset.id;
    const tok = loadPools()[id]?.token;
    removePoolLocal(id);
    if (tok) api('/api/session/forget', { method: 'POST', body: { token: tok } }).catch(() => {});
    S.myPools = (S.myPools || []).filter((p) => p.poolId !== id);
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

  async 'add-placeholder'() {
    S.error = '';
    const name = val('ph-name');
    if (!name) { S.error = 'Enter a name for the seat.'; return render(); }
    try {
      await api(`/api/pools/${S.pool.id}/placeholders`, { method: 'POST', body: { token: S.token, name } });
      toast(`Seat held for ${name}`);
    } catch (e) { S.error = e.message; render(); }
  },

  async 'claim-seat'(el) {
    S.error = '';
    try {
      const r = await api(`/api/pools/${S.joinPool.joinCode}/claim`, {
        method: 'POST', body: { playerId: el.dataset.id, email: val('jp-email') },
      });
      savePool(r.pool.id, { token: r.player.token, playerId: r.player.id, code: r.pool.joinCode, name: r.pool.name });
      toast(`Welcome, ${r.player.name} — this seat is yours`);
      navigate(`/p/${r.pool.joinCode}`);
    } catch (e) { S.error = e.message; render(); }
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

  tab(el) {
    const next = el.dataset.tab;
    if (next !== S.tab) { scoresAutoScrolled = false; bracketSelectedId = null; bracketCoachFilter = null; }
    S.tab = next; S.error = ''; refreshAux().then(render); render();
  },

  'select-bracket-match'(el) { bracketSelectedId = el.dataset.id; render(); },

  'bracket-coach'(el) { bracketCoachFilter = el.dataset.id || null; render(); },

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
