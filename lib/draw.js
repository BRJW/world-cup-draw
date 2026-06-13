// Pure draw-engine + scoring logic. No I/O — the server records results.
//
// Model: 8 tiers of 6, seeded by Vegas odds. Each player ends with 4 teams via
// COMPLEMENTARY PAIRING that keeps every squad's tier-sum identical:
//
//   Upper half: Tier 1 (1–6)  pairs with Tier 4 (19–24)   [tier sum 5]
//               Tier 2 (7–12) pairs with Tier 3 (13–18)   [tier sum 5]
//   Lower half: Tier 5 (25–30) pairs with Tier 8 (43–48)  [tier sum 13]
//               Tier 6 (31–36) pairs with Tier 7 (37–42)  [tier sum 13]
//
// So if you draw a top-6 side you also get a 19–24 side (never a 13–18), etc.
// Every player's four teams sum to tiers (5 + 13) = 18.
//
// The draft runs in 4 rounds (snake order), worst first, saving the giants
// for a grandstand finish:
//   R1 "underdog"   — random team from Tier 7 ∪ Tier 8
//   R2 "dark horse" — its complement (Tier 8→5, Tier 7→6)
//   R3 "contender"  — random team from Tier 3 ∪ Tier 4
//   R4 "headliner"  — its complement (Tier 4→1, Tier 3→2)

import { TEAMS, teamByCode, teamsInTier } from '../data/teams.js';

export const MAX_PLAYERS = 12;
export const TIER_COUNT = 8;
export const TIER_SIZE = 6;
export const ROUND_COUNT = 4;
export const TEAMS_PER_PLAYER = 4;

// Tier complement within each half (bidirectional, so a draft started under
// the old top-first order can still resolve its balancer rounds).
const COMPLEMENT = { 1: 4, 4: 1, 2: 3, 3: 2, 5: 8, 8: 5, 6: 7, 7: 6 };

export const ROUND_INFO = [
  { round: 1, label: 'The Underdog', blurb: 'A team from Tier 7 or 8' },
  { round: 2, label: 'The Dark Horse', blurb: 'The complementary tier (5 or 6)' },
  { round: 3, label: 'The Contender', blurb: 'A team from Tier 3 or 4' },
  { round: 4, label: 'The Headliner', blurb: 'Your giant — Tier 1 or 2' },
];

export function orderForRound(draftOrder, roundIndex) {
  // snake: even rounds forward, odd rounds reversed
  return roundIndex % 2 === 0 ? draftOrder : [...draftOrder].reverse();
}

// Whose turn is it? Returns { playerId, round, pickNumber } or null when done.
export function currentTurn(pool) {
  if (pool.status !== 'drafting') return null;
  if (pool.potIndex >= ROUND_COUNT) return null;
  const order = orderForRound(pool.draftOrder, pool.potIndex);
  const playerId = order[pool.pickIndex];
  if (!playerId) return null;
  return {
    playerId,
    round: pool.potIndex + 1,
    pickNumber: pool.potIndex * pool.draftOrder.length + pool.pickIndex + 1,
  };
}

// Advance the (round, pick) cursor. Returns new progress + completion status.
export function advance(pool) {
  const n = pool.draftOrder.length;
  let { potIndex, pickIndex } = pool;
  pickIndex += 1;
  if (pickIndex >= n) { pickIndex = 0; potIndex += 1; }
  const done = potIndex >= ROUND_COUNT;
  return { potIndex, pickIndex, status: done ? 'done' : 'drafting' };
}

// Which tiers may the current pick come from? Lead rounds offer a union of two
// tiers; complement rounds are pinned to the partner of the player's lead pick.
// `picks` rows carry the round number in `pot`.
export function eligibleTiers(round, playerId, picks) {
  if (round === 1) return [7, 8];
  if (round === 3) return [3, 4];
  const leadRound = round === 2 ? 1 : 3;
  const lead = picks.find((p) => p.playerId === playerId && p.pot === leadRound);
  const t = lead ? teamByCode(lead.teamCode)?.tier : null;
  return COMPLEMENT[t] ? [COMPLEMENT[t]] : [];
}

// Pick a random not-yet-taken team that satisfies the current pick's tier rule.
export function randomTeamForTurn(pool, picks, turn) {
  const tiers = eligibleTiers(turn.round, turn.playerId, picks);
  const taken = new Set(picks.map((p) => p.teamCode));
  const available = TEAMS.filter((t) => tiers.includes(t.tier) && !taken.has(t.code));
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

// ----------------------------------------------------------------------------
// Scoring / leaderboard
// ----------------------------------------------------------------------------
// A match counts toward standings only when it is FINAL — never while it's in
// progress. ESPN sets `completed` at full-time; commissioner-entered (`manual`)
// results count too. An in-progress game (status 'in') is explicitly excluded.
export function isFinal(m) {
  if (m.status === 'in') return false;            // currently playing — never counts
  return !!(m.completed || m.manual || m.status === 'post');
}

export function teamRecords(matches) {
  const rec = {};
  const ensure = (code) =>
    (rec[code] ||= { code, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
  for (const m of matches) {
    if (m.scoreA == null || m.scoreB == null) continue;
    if (!isFinal(m)) continue;
    const a = ensure(m.teamA), b = ensure(m.teamB);
    a.played++; b.played++;
    a.gf += m.scoreA; a.ga += m.scoreB;
    b.gf += m.scoreB; b.ga += m.scoreA;
    if (m.scoreA > m.scoreB) { a.w++; a.pts += 3; b.l++; }
    else if (m.scoreA < m.scoreB) { b.w++; b.pts += 3; a.l++; }
    else { a.d++; b.d++; a.pts += 1; b.pts += 1; }
  }
  return rec;
}

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
  for (const row of byPlayer.values()) row.teams.sort((a, b) => a.tier - b.tier);
  return [...byPlayer.values()].sort(
    (a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf
  );
}

export function teamsForPlayer(picks, playerId) {
  return picks
    .filter((p) => p.playerId === playerId)
    .map((p) => ({ ...teamByCode(p.teamCode), round: p.pot, pickNumber: p.pickNumber }))
    .sort((a, b) => a.tier - b.tier);
}

export { TEAMS, teamsInTier };
