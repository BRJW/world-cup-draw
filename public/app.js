// World Cup Draw 2026 — vanilla JS SPA. No build step.
/* global io */

const $app = document.getElementById('app');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const S = {
  screen: 'home',        // 'home' | 'pool'
  homeMode: 'create',    // 'create' | 'join'
  tab: 'draft',          // draft | teams | standings | scores
  teams: [],
  potSize: 12,
  me: null,              // {id,name,isCommissioner}
  token: null,
  pool: null,
  players: [],
  picks: [],
  currentTurn: null,
  leaderboard: [],
  byPlayer: {},
  matches: [],
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
    S.teams = t.teams; S.potSize = t.potSize;
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
      S.matches = m.matches;
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
      <p class="sub">12 friends, 4 pots of 12. Everyone drafts one team from each pot — one giant, one contender, one dark horse, one minnow.</p>
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
    <p class="sub">Share this code or link. Up to ${S.potSize} players.</p>
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
    <h2>Players <span class="muted small">(${S.players.length}/${S.potSize})</span></h2>
    <div>${S.players.map(playerRow).join('')}</div>
  </div>
  <div class="card">
    ${isCommissioner() ? `
      <h2>Run the draft</h2>
      <p class="sub">Order is randomized at kickoff (you can reshuffle). Each player gets one team from every pot.</p>
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

function playerRow(pl) {
  const isMe = pl.id === S.me?.id;
  const isTurn = S.currentTurn?.playerId === pl.id;
  const orderIdx = S.pool.draftOrder ? null : null;
  return `<div class="player-row">
    <div class="avatar">${esc(initials(pl.name))}</div>
    <div class="name">${esc(pl.name)}</div>
    ${pl.isCommissioner ? '<span class="badge host">Commish</span>' : ''}
    ${isMe ? '<span class="badge you">You</span>' : ''}
    ${isTurn ? '<span class="badge turn">Picking</span>' : ''}
  </div>`;
}

function renderLiveDraft() {
  const turn = S.currentTurn;
  const totalPicks = S.players.length * 4;
  const made = S.picks.length;
  const pct = Math.round((made / totalPicks) * 100);
  const canDraw = turn && (isCommissioner() || S.me?.id === turn.playerId);
  const turnNm = turn ? playerName(turn.playerId) : '';
  const isMyTurn = turn && S.me?.id === turn.playerId;

  return `
  <div class="stage">
    <div class="turnline">Pot ${turn ? turn.pot : 4} · Pick ${made + (turn ? 1 : 0)} of ${totalPicks}</div>
    <div class="turnname">${turn ? `${esc(turnNm)}${isMyTurn ? ' (you)' : ''} is up` : 'Draw complete'}</div>
    <div class="reveal" id="reveal">${lastFlag()}</div>
    <div class="reveal-name" id="reveal-name"></div>
    <div class="progress"><div style="width:${pct}%"></div></div>
    <div class="small muted">${made}/${totalPicks} teams drawn</div>
  </div>
  ${canDraw ? `<button data-action="draw-next" id="draw-btn">${isMyTurn ? '🎲 Draw your team!' : '🎲 Draw next team'}</button>` : ''}
  ${!canDraw && turn ? `<p class="center muted">Waiting for ${esc(turnNm)} to draw…</p>` : ''}
  <div class="error">${esc(S.error)}</div>
  ${renderPotBoard()}
  ${renderRecentPicks()}`;
}

function lastFlag() {
  const last = S.picks[S.picks.length - 1];
  return last ? (teamByCode(last.teamCode)?.flag || '⚽') : '🎩';
}

function renderPotBoard() {
  const taken = takenCodes();
  let cols = '';
  for (const pot of [1, 2, 3, 4]) {
    const teams = S.teams.filter((t) => t.pot === pot).sort((a, b) => a.rank - b.rank);
    cols += `<div class="pot-col">
      <h4><span class="pot-pill pot-${pot}">POT ${pot}</span></h4>
      ${teams.map((t) => `<div class="mini-team ${taken.has(t.code) ? 'taken' : ''}"><span>${t.flag}</span><span>${esc(t.name)}</span></div>`).join('')}
    </div>`;
  }
  return `<div class="card"><h2>The pots</h2><div class="pot-board">${cols}</div></div>`;
}

function renderRecentPicks() {
  if (!S.picks.length) return '';
  const recent = [...S.picks].slice(-6).reverse();
  return `<div class="card"><h2>Latest picks</h2>
    ${recent.map((p) => {
      const t = p.team || teamByCode(p.teamCode);
      return `<div class="team"><span class="flag">${t?.flag || '⚽'}</span>
        <span class="tname">${esc(t?.name || p.teamCode)}</span>
        <span class="pot-pill pot-${p.pot}">P${p.pot}</span>
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
        .sort((a, b) => a.pot - b.pot)
        .map((p) => (p.team || teamByCode(p.teamCode))?.flag || '⚽').join(' ');
      return `<div class="player-row">
        <div class="avatar">${esc(initials(pl.name))}</div>
        <div class="name">${esc(pl.name)}</div>
        <div style="font-size:20px;letter-spacing:2px">${teams}</div>
      </div>`;
    }).join('')}
  </div>`;
}

// ---- My Teams tab ----
function renderTeamsTab() {
  if (!S.me) return `<div class="card empty">Join a pool to see your teams.</div>`;
  const mine = S.byPlayer[S.me.id] || S.picks.filter((p) => p.playerId === S.me.id).map((p) => ({ ...teamByCode(p.teamCode) }));
  if (!mine.length) {
    return `<div class="card empty">You don't have any teams yet.<br/>They'll appear here once the draft runs.</div>`;
  }
  const sorted = [...mine].sort((a, b) => a.pot - b.pot);
  return `<div class="card">
    <h2>Your squad, ${esc(S.me.name)}</h2>
    <p class="sub">One from each pot. Win = 3 pts, draw = 1.</p>
    ${sorted.map((t) => {
      const r = t.record;
      const rec = r ? `${r.played}P · ${r.w}W ${r.d}D ${r.l}L · ${r.pts} pts` : 'No matches yet';
      return `<div class="team">
        <span class="flag">${t.flag || '⚽'}</span>
        <span class="tname">${esc(t.name)}</span>
        <span class="pot-pill pot-${t.pot}">POT ${t.pot}</span>
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
    ${S.leaderboard.map((row, i) => `
      <div class="lb-row ${i === 0 ? 'top1' : ''}">
        <div class="lb-rank">${i + 1}</div>
        <div>
          <div class="lb-name">${esc(row.name)} ${row.playerId === S.me?.id ? '<span class="badge you">You</span>' : ''}</div>
          <div class="lb-teams">${row.teams.map((t) => t.flag).join(' ')}</div>
          <div class="lb-sub">${row.w}W ${row.d}D ${row.l}L · GF ${row.gf} / GA ${row.ga}</div>
        </div>
        <div class="lb-pts">${row.pts}<div class="lb-sub" style="text-align:right">pts</div></div>
      </div>`).join('')}
  </div>`;
}

// ---- Scores tab ----
function renderScoresTab() {
  const opts = S.teams.map((t) => `<option value="${t.code}">${t.flag} ${esc(t.name)}</option>`).join('');
  return `
  ${isCommissioner() ? `
  <div class="card">
    <h2>Add a result</h2>
    <p class="sub">Enter final scores as games finish. Leave scores blank for an upcoming fixture.</p>
    <div class="row">
      <div><label>Home</label><select id="m-a">${opts}</select></div>
      <div><label>Away</label><select id="m-b">${opts}</select></div>
    </div>
    <div class="row">
      <div><label>Home goals</label><input type="number" id="m-sa" min="0" inputmode="numeric" /></div>
      <div><label>Away goals</label><input type="number" id="m-sb" min="0" inputmode="numeric" /></div>
    </div>
    <label>Stage</label>
    <select id="m-stage">
      <option>Group</option><option>Round of 32</option><option>Round of 16</option>
      <option>Quarter-final</option><option>Semi-final</option><option>Final</option>
    </select>
    <button data-action="add-match">Save result</button>
    <div class="error">${esc(S.error)}</div>
  </div>` : ''}
  <div class="card">
    <h2>Results & fixtures</h2>
    ${S.matches.length ? S.matches.map(matchRow).join('') : '<div class="empty">No matches recorded yet.</div>'}
  </div>`;
}

function matchRow(m) {
  const a = teamByCode(m.teamA), b = teamByCode(m.teamB);
  const score = (m.scoreA == null || m.scoreB == null) ? '<span class="muted">vs</span>' : `${m.scoreA} – ${m.scoreB}`;
  return `<div class="match-row">
    <span class="t right" style="text-align:right">${esc(a?.name || m.teamA)} ${a?.flag || ''}</span>
    <span class="sc">${score}</span>
    <span class="t">${b?.flag || ''} ${esc(b?.name || m.teamB)}</span>
    ${isCommissioner() ? `<button class="danger" data-action="del-match" data-id="${m.id}">✕</button>` : ''}
  </div>
  <div class="small muted" style="text-align:center;margin:-4px 0 6px">${esc(m.stage || '')}</div>`;
}

// ---------------------------------------------------------------------------
// Live reveal animation
// ---------------------------------------------------------------------------
function animateReveal(pick) {
  render(); // ensure stage exists with new state
  const reveal = document.getElementById('reveal');
  const nameEl = document.getElementById('reveal-name');
  const team = pick.team || teamByCode(pick.teamCode);
  if (!reveal || !team) { render(); return; }
  S.animating = true;
  const btn = document.getElementById('draw-btn');
  if (btn) btn.disabled = true;

  const potTeams = S.teams.filter((t) => t.pot === pick.pot);
  let ticks = 0;
  const spin = setInterval(() => {
    const r = potTeams[Math.floor(Math.random() * potTeams.length)];
    reveal.textContent = r.flag;
    if (nameEl) nameEl.textContent = '…';
    if (++ticks > 11) {
      clearInterval(spin);
      reveal.textContent = team.flag;
      reveal.classList.add('pop');
      if (nameEl) nameEl.textContent = `${team.name} → ${playerName(pick.playerId)}`;
      setTimeout(() => { S.animating = false; render(); }, 1400);
    }
  }, 70);
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

  async 'add-match'() {
    S.error = '';
    const body = {
      token: S.token, teamA: val('m-a'), teamB: val('m-b'),
      scoreA: val('m-sa'), scoreB: val('m-sb'), stage: val('m-stage'),
    };
    if (body.teamA === body.teamB) { S.error = 'Pick two different teams.'; return render(); }
    try {
      await api('/api/matches', { method: 'POST', body });
      await refreshAux(); toast('Result saved'); render();
    } catch (e) { S.error = e.message; render(); }
  },

  async 'del-match'(el) {
    try { await api(`/api/matches/${el.dataset.id}?token=${S.token}`, { method: 'DELETE' }); await refreshAux(); render(); }
    catch (e) { S.error = e.message; render(); }
  },
};

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
