// Pure draw-engine + scoring logic. No I/O — server records results via the store.
//
// Model: 4 pots of 12, snake order through the pots. Each player ends with
// exactly one team from each pot (one elite, one strong, one mid, one underdog).

import { TEAMS, teamsInPot, teamByCode } from '../data/teams.js';

export const POT_COUNT = 4;
export const POT_SIZE = 12; // teams per pot (== required player count)

// The order players draft in for a given pot index (0-based). Snake: even pots
// go in draft order, odd pots reverse — keeps things fair even though picks are
// random within a pot.
export function orderForPot(draftOrder, potIndex) {
  return potIndex % 2 === 0 ? draftOrder : [...draftOrder].reverse();
}

// Whose turn is it? Returns { playerId, pot, pickNumber } or null when complete.
export function currentTurn(pool) {
  if (pool.status !== 'drafting') return null;
  if (pool.potIndex >= POT_COUNT) return null;
  const order = orderForPot(pool.draftOrder, pool.potIndex);
  const playerId = order[pool.pickIndex];
  if (!playerId) return null;
  return {
    playerId,
    pot: pool.potIndex + 1,
    pickNumber: pool.potIndex * pool.draftOrder.length + pool.pickIndex + 1,
  };
}

// Advance the (potIndex, pickIndex) cursor after a pick. Returns the new
// progress + whether the draft is now complete.
export function advance(pool) {
  const n = pool.draftOrder.length;
  let { potIndex, pickIndex } = pool;
  pickIndex += 1;
  if (pickIndex >= n) {
    pickIndex = 0;
    potIndex += 1;
  }
  const done = potIndex >= POT_COUNT;
  return {
    potIndex,
    pickIndex,
    status: done ? 'done' : 'drafting',
  };
}

// Pick a random not-yet-taken team from the current pot. Returns the team or null.
export function randomTeamForCurrentPot(pool, picks) {
  const pot = pool.potIndex + 1;
  const taken = new Set(picks.map((p) => p.teamCode));
  const available = teamsInPot(pot).filter((t) => !taken.has(t.code));
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

// ----------------------------------------------------------------------------
// Scoring / leaderboard
// ----------------------------------------------------------------------------

// Per-team record from completed matches (both scores present).
export function teamRecords(matches) {
  const rec = {};
  const ensure = (code) =>
    (rec[code] ||= { code, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
  for (const m of matches) {
    if (m.scoreA == null || m.scoreB == null) continue;
    const a = ensure(m.teamA);
    const b = ensure(m.teamB);
    a.played++; b.played++;
    a.gf += m.scoreA; a.ga += m.scoreB;
    b.gf += m.scoreB; b.ga += m.scoreA;
    if (m.scoreA > m.scoreB) { a.w++; a.pts += 3; b.l++; }
    else if (m.scoreA < m.scoreB) { b.w++; b.pts += 3; a.l++; }
    else { a.d++; b.d++; a.pts += 1; b.pts += 1; }
  }
  return rec;
}

// Leaderboard: aggregate each player's teams. `picks` rows have {playerId, teamCode}.
export function leaderboard(players, picks, matches) {
  const records = teamRecords(matches);
  const byPlayer = new Map(players.map((p) => [p.id, {
    playerId: p.id, name: p.name, pts: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, played: 0, teams: [],
  }]));
  for (const pick of picks) {
    const row = byPlayer.get(pick.playerId);
    if (!row) continue;
    const team = teamByCode(pick.teamCode);
    const r = records[pick.teamCode];
    row.teams.push({ ...team, record: r || null });
    if (r) {
      row.pts += r.pts; row.w += r.w; row.d += r.d; row.l += r.l;
      row.gf += r.gf; row.ga += r.ga; row.played += r.played;
    }
  }
  return [...byPlayer.values()].sort(
    (a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf
  );
}

// Convenience: enrich a list of pick rows with full team objects, sorted by pot.
export function teamsForPlayer(picks, playerId) {
  return picks
    .filter((p) => p.playerId === playerId)
    .map((p) => ({ ...teamByCode(p.teamCode), pickNumber: p.pickNumber }))
    .sort((a, b) => a.pot - b.pot);
}

export { TEAMS };
