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

function knockoutWinner(m) {
  if (!m || m.status !== 'post' || m.scoreA == null || m.scoreB == null) return null;
  if (m.scoreA > m.scoreB) return { code: m.teamA, name: m.teamAName };
  if (m.scoreB > m.scoreA) return { code: m.teamB, name: m.teamBName };
  if (m.shootout && m.winnerA) return { code: m.teamA, name: m.teamAName };
  if (m.shootout && m.winnerB) return { code: m.teamB, name: m.teamBName };
  return null;
}

// Rewrite the sides of not-yet-started R16 matches in `incoming` from the
// official template. `existing` (the store's current matches) supplies context
// the incoming batch may lack — the live sync only fetches a 3-day window.
// Mutates and returns `incoming`. No-ops until the bracket is fully synced.
export function fixRound16Pairings(incoming, existing = []) {
  const byId = new Map();
  for (const m of existing) if (m.extId) byId.set(String(m.extId), m);
  for (const m of incoming) if (m.extId) byId.set(String(m.extId), m);
  const ofStage = (s) => [...byId.values()]
    .filter((m) => m.stage === s && Number(m.extId))
    .sort((a, b) => Number(a.extId) - Number(b.extId));
  const r32 = ofStage('Round of 32');
  const r16 = ofStage('Round of 16');
  if (r32.length !== 16 || r16.length !== 8) return incoming;

  const r32Key = (m) => [m.teamA, m.teamB].filter((c) => REAL_CODES.has(c)).sort().join(',');
  const r32ByKey = new Map(r32.map((m, i) => [r32Key(m), { m, num: i + 1 }]));
  const r16Slot = new Map(r16.map((m, i) => [String(m.extId), i]));

  for (const m of incoming) {
    if (m.stage !== 'Round of 16' || m.status !== 'pre') continue;
    const tpl = WC2026_R16_FEEDERS[r16Slot.get(String(m.extId))];
    if (!tpl) continue;
    const side = (key) => {
      const feeder = r32ByKey.get(key);
      if (!feeder) return null; // R32 itself not resolved to real teams yet
      return knockoutWinner(feeder.m)
        || { code: 'RD32', name: `Round of 32 ${feeder.num} Winner` };
    };
    const a = side(tpl[0]), b = side(tpl[1]);
    if (!a || !b) continue;
    m.teamA = a.code; m.teamAName = a.name;
    m.teamB = b.code; m.teamBName = b.name;
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
