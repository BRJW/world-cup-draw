// World Cup Draw 2026 — vanilla JS SPA. No build step.
/* global io */

import { playAnnouncement } from '/announce.js';

const $app = document.getElementById('app');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const S = {
  screen: 'home',        // 'home' | 'pool'
  homeMode: 'create',    // 'create' | 'join'
  tab: 'draft',          // draft | teams | standings | scores
  teams: [],
  maxPlayers: 12,
  teamsPerPlayer: 4,
  rounds: [],
  me: null,              // {id,name,isCommissioner}
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

const LS_KEY = 'wcd:identity';
const saveIdentity = (token, poolId) => localStorage.setItem(LS_KEY, JSON.stringify({ token, poolId }));
const loadIdentity = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; } };
const clearIdentity = () => localStorage.removeItem(LS_KEY);

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
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

// ---------------------------------------------------------------------------
// Socket
// ---------------------------------------------------------------------------
const socket = io({ autoConnect: true });
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
  if (S.token) S.me = S.players.find((p) => p.id === (S.me?.id)) || S.me;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  const params = new URLSearchParams(location.search);
  const joinCode = params.get('join');
  if (joinCode) { S.homeMode = 'join'; S.prefillCode = joinCode.toUpperCase(); }

  try {
    const t = await api('/api/teams');
    S.teams = t.teams; S.maxPlayers = t.maxPlayers;
    S.teamsPerPlayer = t.teamsPerPlayer || 4; S.rounds = t.rounds || [];
  } catch { /* non-fatal */ }

  const ident = loadIdentity();
  if (ident?.token && ident?.poolId) {
    try {
      const me = await api(`/api/me?token=${ident.token}`);
      S.token = ident.token;
      S.me = me.player;
      await enterPool(me.poolId);
      return;
    } catch { clearIdentity(); }
  }
  render();
}

async function enterPool(poolId) {
  const state = await api(`/api/pools/${poolId}`);
  applyState(state);
  S.screen = 'pool';
  joinRoom(poolId);
  await refreshAux();
  render();
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
  $app.innerHTML = S.screen === 'home' ? renderHome() : renderPool();
}

function renderHome() {
  const create = S.homeMode === 'create';
  return `
  <div class="app-header"><span class="ball">⚽</span><h1>World Cup Draw 2026</h1></div>
  <div class="card">
    <div class="row" style="margin-bottom:16px">
      <button class="${create ? '' : 'secondary'}" data-action="mode" data-mode="create" style="margin:0">Create pool</button>
      <button class="${create ? 'secondary' : ''}" data-action="mode" data-mode="join" style="margin:0">Join pool</button>
    </div>
    ${create ? `
      <h2>Start a new pool</h2>
      <p class="sub">Up to 12 friends. 48 teams in 8 odds-based tiers, drafted in balanced pairs — every squad of four ends up equally weighted, so it comes down to who you back.</p>
      <label>Pool name</label>
      <input type="text" id="pool-name" placeholder="The Lads' World Cup" maxlength="40" />
      <label>Your name (you'll be commissioner)</label>
      <input type="text" id="commish-name" placeholder="e.g. Buster" maxlength="24" />
      <button data-action="create-pool">Create pool →</button>
    ` : `
      <h2>Join a pool</h2>
      <p class="sub">Enter the 6-letter code your commissioner shared.</p>
      <label>Join code</label>
      <input type="text" id="join-code" placeholder="ABC123" maxlength="6" value="${esc(S.prefillCode)}" style="text-transform:uppercase;letter-spacing:4px;font-weight:700" />
      <label>Your name</label>
      <input type="text" id="join-name" placeholder="e.g. Buster" maxlength="24" />
      <button data-action="join-pool">Join →</button>
    `}
    <div class="error">${esc(S.error)}</div>
  </div>
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
    <span class="ball">⚽</span>
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
  const link = `${location.origin}/?join=${S.pool.joinCode}`;
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
      <p class="sub">Order is randomized at kickoff (you can reshuffle). Four rounds: each player draws a headliner and a complementary balancer in each half of the field.</p>
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
    <div class="row">
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
    <p class="sub">Four teams, balanced across the tiers. Win = 3 pts, draw = 1.</p>
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
  if (!S.leaderboard.length) return `<div class="card empty">Standings appear once the draft is done and scores are in.</div>`;
  return `<div class="card">
    <h2>🏆 Standings</h2>
    <p class="sub">Combined points of each player's four teams.</p>
    ${S.leaderboard.map((row, i) => {
      const pl = S.players.find((p) => p.id === row.playerId);
      return `
      <div class="lb-row ${i === 0 ? 'top1' : ''}">
        <div class="lb-rank">${i + 1}</div>
        ${avatar(pl)}
        <div style="flex:1">
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

  async 'create-pool'() {
    S.error = '';
    const name = val('pool-name'), commissionerName = val('commish-name');
    if (!name || !commissionerName) { S.error = 'Fill in both fields.'; return render(); }
    try {
      const r = await api('/api/pools', { method: 'POST', body: { name, commissionerName } });
      S.token = r.player.token; S.me = r.player;
      saveIdentity(r.token ?? r.player.token, r.pool.id);
      saveIdentity(r.player.token, r.pool.id);
      await enterPool(r.pool.id);
    } catch (e) { S.error = e.message; render(); }
  },

  async 'join-pool'() {
    S.error = '';
    const code = val('join-code').toUpperCase(), name = val('join-name');
    if (!code || !name) { S.error = 'Enter the code and your name.'; return render(); }
    try {
      const r = await api(`/api/pools/${code}/join`, { method: 'POST', body: { name } });
      S.token = r.player.token; S.me = r.player;
      saveIdentity(r.player.token, r.pool.id);
      await enterPool(r.pool.id);
    } catch (e) { S.error = e.message; render(); }
  },

  tab(el) { S.tab = el.dataset.tab; S.error = ''; refreshAux().then(render); render(); },

  'copy-code'() { copy(S.pool.joinCode); toast('Code copied'); },
  'copy-link'() { copy(`${location.origin}/?join=${S.pool.joinCode}`); toast('Invite link copied'); },

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
    try {
      const r = await api('/api/players/me', { method: 'POST', body });
      S.me = { ...S.me, ...r.player };
      S.pendingImage = null;
      toast('Club saved'); render();
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
  if (e.key !== 'Enter' || S.screen !== 'home') return;
  if (S.homeMode === 'create') actions['create-pool']();
  else actions['join-pool']();
});

boot();
