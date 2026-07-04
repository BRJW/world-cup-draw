// Live World Cup data from ESPN's public API (free, no key required).
// Endpoint: site.api.espn.com — the FIFA World Cup league slug is `fifa.world`.
//
// Conveniently, ESPN's team abbreviations match our team codes exactly for all
// 48 sides, so mapping is a direct passthrough. Knockout fixtures whose teams
// aren't decided yet show placeholder competitors (e.g. "Group A Winner");
// those carry abbreviations that aren't real team codes, so they never affect
// scoring — they just appear in the schedule until the bracket resolves.

import { TEAMS } from '../data/teams.js';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';

export const REAL_CODES = new Set(TEAMS.map((t) => t.code));

// Tournament window (UTC). A little padding on each end is harmless.
const START = Date.UTC(2026, 5, 11); // Jun 11 2026
const END = Date.UTC(2026, 6, 20);   // Jul 20 2026

function dateStrings() {
  const out = [];
  for (let t = START; t <= END; t += 86400000) {
    const d = new Date(t);
    out.push(
      d.getUTCFullYear() +
      String(d.getUTCMonth() + 1).padStart(2, '0') +
      String(d.getUTCDate()).padStart(2, '0')
    );
  }
  return out;
}

// ESPN's per-event `season.slug` is the authoritative round identifier and
// stays correct as knockout teams resolve. Fall back to kickoff date if absent.
const STAGE_BY_SLUG = {
  'group-stage': 'Group',
  'round-of-32': 'Round of 32',
  'round-of-16': 'Round of 16',
  quarterfinals: 'Quarter-final',
  semifinals: 'Semi-final',
  '3rd-place-match': 'Third-place',
  final: 'Final',
};

export function stageForDate(iso) {
  const d = new Date(iso);
  const k = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const D = (m, day) => Date.UTC(2026, m, day);
  if (k >= D(6, 19)) return 'Final';
  if (k === D(6, 18)) return 'Third-place';
  if (k >= D(6, 14)) return 'Semi-final';
  if (k >= D(6, 9)) return 'Quarter-final';
  if (k >= D(6, 4)) return 'Round of 16';
  if (k >= D(5, 28)) return 'Round of 32';
  return 'Group';
}

function stageFor(e) {
  return STAGE_BY_SLUG[e.season?.slug] || stageForDate(e.date);
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Normalize one ESPN event into our match shape.
function normalize(e) {
  const c = e.competitions?.[0];
  if (!c) return null;
  const home = c.competitors.find((x) => x.homeAway === 'home') || c.competitors[0];
  const away = c.competitors.find((x) => x.homeAway === 'away') || c.competitors[1];
  if (!home || !away) return null;
  const state = e.status?.type?.state || 'pre';     // 'pre' | 'in' | 'post'
  const started = state !== 'pre';
  // Knockout matches level after 120 minutes go to penalties. ESPN marks this
  // with status.type.name === 'STATUS_FINAL_PEN' and sets a `winner` boolean on
  // each competitor (true for the shootout winner) even though the score stays
  // level — that's the only way to tell who actually advances.
  const shootout = e.status?.type?.name === 'STATUS_FINAL_PEN';
  return {
    extId: String(e.id),
    kickoff: e.date,
    stage: stageFor(e),
    teamA: home.team.abbreviation,
    teamB: away.team.abbreviation,
    teamAName: home.team.displayName,
    teamBName: away.team.displayName,
    scoreA: started ? num(home.score) : null,
    scoreB: started ? num(away.score) : null,
    status: state,
    statusDetail: e.status?.type?.shortDetail || e.status?.type?.detail || '',
    completed: !!e.status?.type?.completed,
    shootout,
    winnerA: shootout ? !!home.winner : null,
    winnerB: shootout ? !!away.winner : null,
    penA: shootout ? num(home.shootoutScore) : null,
    penB: shootout ? num(away.shootoutScore) : null,
  };
}

// ---- Round-of-16 pairing correction ----------------------------------------
// ESPN's structured feed mis-pairs the last two Round-of-16 slots: it routes
// Argentina's path into Switzerland/Algeria, when the official 2026 bracket
// (verified against Wikipedia, Sky Sports, CBS, Olympics.com, and ESPN's OWN
// editorial) is Australia/Egypt vs Argentina/Cape Verde and Switzerland/Algeria
// vs Colombia/Ghana. Left alone, the feed resolves real R32 winners into the
// wrong fixtures, which then poisons every view (scores, bracket, next match).
//
// Each entry is the two Round-of-32 fixtures (by sorted team-code key) that
// feed one R16 slot, teamA side first, in official R16 order (ascending game
// id). For any R16 fixture that hasn't kicked off yet, both sides are rebuilt
// from this template + the actual R32 results, so the pairing is always the
// official one no matter what the feed projected. Once a match is live or
// finished we trust the feed — real games report their real teams.
const WC2026_R16_FEEDERS = [
  [['RSA', 'CAN'], ['NED', 'MAR']],
  [['GER', 'PAR'], ['FRA', 'SWE']],
  [['BRA', 'JPN'], ['CIV', 'NOR']],
  [['MEX', 'ECU'], ['ENG', 'COD']],
  [['POR', 'CRO'], ['ESP', 'AUT']],
  [['USA', 'BIH'], ['BEL', 'SEN']],
  [['SUI', 'ALG'], ['COL', 'GHA']],
  [['AUS', 'EGY'], ['ARG', 'CPV']],
].map(([a, b]) => [a.slice().sort().join(','), b.slice().sort().join(',')]);

// Later rounds route by official match number within the previous round
// (ascending game id): QF1 = R16 winners 1v2, QF2 = 5v6, QF3 = 3v4, QF4 = 7v8
// (the halves interleave — that's why England and Argentina share a half);
// SF1 = QF 1v2, SF2 = QF 3v4; Final = SF winners, Third place = SF losers.
// Verified against the same sources as the R16 template.
const WC2026_QF_FEEDERS = [[1, 2], [5, 6], [3, 4], [7, 8]];
const WC2026_SF_FEEDERS = [[1, 2], [3, 4]];

function knockoutWinner(m) {
  if (!m || m.status !== 'post' || m.scoreA == null || m.scoreB == null) return null;
  if (m.scoreA > m.scoreB) return { code: m.teamA, name: m.teamAName };
  if (m.scoreB > m.scoreA) return { code: m.teamB, name: m.teamBName };
  if (m.shootout && m.winnerA) return { code: m.teamA, name: m.teamAName };
  if (m.shootout && m.winnerB) return { code: m.teamB, name: m.teamBName };
  return null;
}

function knockoutLoser(m) {
  const w = knockoutWinner(m);
  if (!w) return null;
  return w.code === m.teamA
    ? { code: m.teamB, name: m.teamBName }
    : { code: m.teamA, name: m.teamAName };
}

// Rewrite the sides of every not-yet-started knockout match in `incoming`
// from the official bracket template + actual results, working outward-in so
// each round chains off the corrected previous round. Matches that are live
// or finished are trusted as-is — real games report their real teams; the
// feed's routing errors only exist in its pre-game projections.
//
// `existing` (the store's current matches) supplies context the incoming
// batch may lack — the live sync only fetches a 3-day window. Mutates and
// returns `incoming`. No-ops for any round the feed hasn't fully synced.
export function fixKnockoutPairings(incoming, existing = []) {
  const byId = new Map();
  for (const m of existing) if (m.extId) byId.set(String(m.extId), m);
  for (const m of incoming) if (m.extId) byId.set(String(m.extId), m);
  const ofStage = (s) => [...byId.values()]
    .filter((m) => m.stage === s && Number(m.extId))
    .sort((a, b) => Number(a.extId) - Number(b.extId));
  const inBatch = new Map(incoming.filter((m) => m.extId).map((m) => [String(m.extId), m]));

  const r32 = ofStage('Round of 32');
  if (r32.length !== 16) return incoming;
  const r32Key = (m) => [m.teamA, m.teamB].filter((c) => REAL_CODES.has(c)).sort().join(',');
  const r32ByKey = new Map(r32.map((m, i) => [r32Key(m), { m, num: i + 1 }]));

  // One side of a slot: the feeder's actual winner/loser once decided, else a
  // numbered placeholder ("Round of 16 2 Winner") the client knows how to read.
  const sideFrom = (feeder, label, kind = 'Winner') => {
    if (!feeder || !feeder.m) return null;
    const decided = kind === 'Winner' ? knockoutWinner(feeder.m) : knockoutLoser(feeder.m);
    return decided || { code: 'TBD', name: `${label} ${feeder.num} ${kind}` };
  };
  // Correct one round. `feedersOf(i)` -> [feederA, feederB] ({m, num} each).
  // Returns the corrected round in official order (virtual copies for matches
  // outside the incoming batch, so the next round chains off corrected data).
  const correctRound = (stage, size, feedersOf, label, kind = 'Winner') => {
    const list = ofStage(stage);
    if (list.length !== size) return null;
    return list.map((m, i) => {
      if (m.status !== 'pre') return m;
      const [fa, fb] = feedersOf(i) || [];
      const a = sideFrom(fa, label, kind), b = sideFrom(fb, label, kind);
      if (!a || !b) return m;
      const target = inBatch.get(String(m.extId)) || { ...m };
      target.teamA = a.code; target.teamAName = a.name;
      target.teamB = b.code; target.teamBName = b.name;
      return target;
    });
  };

  const r16 = correctRound('Round of 16', 8,
    (i) => WC2026_R16_FEEDERS[i].map((key) => r32ByKey.get(key)), 'Round of 32');
  const byNum = (round) => (nums) => nums.map((n) => round && { m: round[n - 1], num: n });
  const qf = r16 && correctRound('Quarter-final', 4,
    (i) => byNum(r16)(WC2026_QF_FEEDERS[i]), 'Round of 16');
  const sf = qf && correctRound('Semi-final', 2,
    (i) => byNum(qf)(WC2026_SF_FEEDERS[i]), 'Quarterfinal');
  if (sf) {
    correctRound('Final', 1, () => byNum(sf)([1, 2]), 'Semifinal');
    correctRound('Third-place', 1, () => byNum(sf)([1, 2]), 'Semifinal', 'Loser');
  }
  return incoming;
}

async function fetchDate(ds, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${BASE}?dates=${ds}`, { signal: ctrl.signal });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.events || []).map(normalize).filter(Boolean);
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

// Fetch every fixture across the tournament window. Returns normalized matches
// sorted by kickoff. Resilient: a failed day yields no rows rather than throwing.
export async function fetchAllMatches() {
  const days = dateStrings();
  const all = [];
  // modest concurrency to be gentle on the API
  const BATCH = 5;
  for (let i = 0; i < days.length; i += BATCH) {
    const chunk = days.slice(i, i + BATCH);
    const results = await Promise.all(chunk.map((d) => fetchDate(d)));
    for (const list of results) all.push(...list);
  }
  // de-dupe by extId (a fixture can surface on adjacent date queries)
  const byId = new Map();
  for (const m of all) byId.set(m.extId, m);
  return [...byId.values()].sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
}

// Lightweight fetch of just the days around `when` (yesterday/today/tomorrow in
// UTC) — enough to catch any in-progress game regardless of viewer timezone,
// at ~3 requests instead of the full ~40-date sweep. For minute-by-minute
// live polling.
export async function fetchMatchesAround(when = new Date()) {
  const fmt = (offsetDays) => {
    const d = new Date(when.getTime() + offsetDays * 86400000);
    return d.getUTCFullYear()
      + String(d.getUTCMonth() + 1).padStart(2, '0')
      + String(d.getUTCDate()).padStart(2, '0');
  };
  const days = [fmt(-1), fmt(0), fmt(1)];
  const results = await Promise.all(days.map((d) => fetchDate(d)));
  const byId = new Map();
  for (const list of results) for (const m of list) byId.set(m.extId, m);
  return [...byId.values()];
}
