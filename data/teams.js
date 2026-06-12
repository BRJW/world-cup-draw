// World Cup 2026 — all 48 qualified teams, seeded into 8 tiers of 6 by Vegas
// outright odds to win the tournament (BetMGM, via Yahoo Sports, June 2026).
//
// Array order == seeding rank (1 = shortest odds). tier = ceil(rank / 6).
// `odds` is the fractional display (x/1). Update as lines move.

export const TEAMS = [
  // ---- Tier 1 (1–6) ----
  { code: 'ESP', name: 'Spain',         flag: '🇪🇸', tier: 1, odds: '4.5/1' },
  { code: 'FRA', name: 'France',        flag: '🇫🇷', tier: 1, odds: '5/1' },
  { code: 'ENG', name: 'England',       flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', tier: 1, odds: '7/1' },
  { code: 'POR', name: 'Portugal',      flag: '🇵🇹', tier: 1, odds: '8/1' },
  { code: 'ARG', name: 'Argentina',     flag: '🇦🇷', tier: 1, odds: '9/1' },
  { code: 'BRA', name: 'Brazil',        flag: '🇧🇷', tier: 1, odds: '9/1' },

  // ---- Tier 2 (7–12) ----
  { code: 'GER', name: 'Germany',       flag: '🇩🇪', tier: 2, odds: '14/1' },
  { code: 'NED', name: 'Netherlands',   flag: '🇳🇱', tier: 2, odds: '20/1' },
  { code: 'BEL', name: 'Belgium',       flag: '🇧🇪', tier: 2, odds: '33/1' },
  { code: 'NOR', name: 'Norway',        flag: '🇳🇴', tier: 2, odds: '33/1' },
  { code: 'COL', name: 'Colombia',      flag: '🇨🇴', tier: 2, odds: '40/1' },
  { code: 'MAR', name: 'Morocco',       flag: '🇲🇦', tier: 2, odds: '40/1' },

  // ---- Tier 3 (13–18) ----
  { code: 'JPN', name: 'Japan',         flag: '🇯🇵', tier: 3, odds: '50/1' },
  { code: 'USA', name: 'USA',           flag: '🇺🇸', tier: 3, odds: '50/1', host: true },
  { code: 'MEX', name: 'Mexico',        flag: '🇲🇽', tier: 3, odds: '66/1', host: true },
  { code: 'SEN', name: 'Senegal',       flag: '🇸🇳', tier: 3, odds: '66/1' },
  { code: 'SUI', name: 'Switzerland',   flag: '🇨🇭', tier: 3, odds: '66/1' },
  { code: 'TUR', name: 'Türkiye',       flag: '🇹🇷', tier: 3, odds: '66/1' },

  // ---- Tier 4 (19–24) ----
  { code: 'URU', name: 'Uruguay',       flag: '🇺🇾', tier: 4, odds: '66/1' },
  { code: 'CRO', name: 'Croatia',       flag: '🇭🇷', tier: 4, odds: '80/1' },
  { code: 'ECU', name: 'Ecuador',       flag: '🇪🇨', tier: 4, odds: '80/1' },
  { code: 'SWE', name: 'Sweden',        flag: '🇸🇪', tier: 4, odds: '100/1' },
  { code: 'AUT', name: 'Austria',       flag: '🇦🇹', tier: 4, odds: '150/1' },
  { code: 'CAN', name: 'Canada',        flag: '🇨🇦', tier: 4, odds: '150/1', host: true },

  // ---- Tier 5 (25–30) ----
  { code: 'CIV', name: "Côte d'Ivoire", flag: '🇨🇮', tier: 5, odds: '200/1' },
  { code: 'ALG', name: 'Algeria',       flag: '🇩🇿', tier: 5, odds: '250/1' },
  { code: 'BIH', name: 'Bosnia & Herz.',flag: '🇧🇦', tier: 5, odds: '250/1' },
  { code: 'CZE', name: 'Czechia',       flag: '🇨🇿', tier: 5, odds: '250/1' },
  { code: 'EGY', name: 'Egypt',         flag: '🇪🇬', tier: 5, odds: '250/1' },
  { code: 'KOR', name: 'Korea Rep.',    flag: '🇰🇷', tier: 5, odds: '250/1' },

  // ---- Tier 6 (31–36) ----
  { code: 'PAR', name: 'Paraguay',      flag: '🇵🇾', tier: 6, odds: '250/1' },
  { code: 'SCO', name: 'Scotland',      flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', tier: 6, odds: '250/1' },
  { code: 'AUS', name: 'Australia',     flag: '🇦🇺', tier: 6, odds: '500/1' },
  { code: 'GHA', name: 'Ghana',         flag: '🇬🇭', tier: 6, odds: '500/1' },
  { code: 'IRN', name: 'Iran',          flag: '🇮🇷', tier: 6, odds: '500/1' },
  { code: 'TUN', name: 'Tunisia',       flag: '🇹🇳', tier: 6, odds: '500/1' },

  // ---- Tier 7 (37–42) ----
  { code: 'COD', name: 'DR Congo',      flag: '🇨🇩', tier: 7, odds: '750/1' },
  { code: 'CPV', name: 'Cape Verde',    flag: '🇨🇻', tier: 7, odds: '1000/1' },
  { code: 'IRQ', name: 'Iraq',          flag: '🇮🇶', tier: 7, odds: '1000/1' },
  { code: 'JOR', name: 'Jordan',        flag: '🇯🇴', tier: 7, odds: '1000/1' },
  { code: 'NZL', name: 'New Zealand',   flag: '🇳🇿', tier: 7, odds: '1000/1' },
  { code: 'PAN', name: 'Panama',        flag: '🇵🇦', tier: 7, odds: '1000/1' },

  // ---- Tier 8 (43–48) ----
  { code: 'QAT', name: 'Qatar',         flag: '🇶🇦', tier: 8, odds: '1000/1' },
  { code: 'KSA', name: 'Saudi Arabia',  flag: '🇸🇦', tier: 8, odds: '1000/1' },
  { code: 'RSA', name: 'South Africa',  flag: '🇿🇦', tier: 8, odds: '1000/1' },
  { code: 'UZB', name: 'Uzbekistan',    flag: '🇺🇿', tier: 8, odds: '1000/1' },
  { code: 'CUW', name: 'Curaçao',       flag: '🇨🇼', tier: 8, odds: '2500/1' },
  { code: 'HAI', name: 'Haiti',         flag: '🇭🇹', tier: 8, odds: '2500/1' },
];

// Team colours (primary, secondary) + crest, for the draw announcements.
// Colours sourced from ESPN; crest images are ESPN's country logos.
const THEME = {
  ESP: ["#c60b1e", "#f1ff91"],
  FRA: ["#0c2fff", "#ffffff"],
  ENG: ["#ffffff", "#EA1F29"],
  POR: ["#da291c", "#d7e9f6"],
  ARG: ["#74acdf", "#173e69"],
  BRA: ["#fee000", "#009c37"],
  GER: ["#000000", "#db41a9"],
  NED: ["#fb5d00", "#010080"],
  BEL: ["#ef3340", "#d7e9f6"],
  NOR: ["#ef2b2d", "#002868"],
  COL: ["#fbd632", "#21418c"],
  MAR: ["#009060", "#df2027"],
  JPN: ["#ed1c24", "#ffffff"],
  USA: ["#213065", "#d42339"],
  MEX: ["#006847", "#ffffff"],
  SEN: ["#00853f", "#fdef42"],
  SUI: ["#d72b2c", "#ffffff"],
  TUR: ["#ffffff", "#ef3340"],
  URU: ["#003da5", "#ffffff"],
  CRO: ["#ff0000", "#0c2fff"],
  ECU: ["#ffdd00", "#034ea2"],
  SWE: ["#fecb00", "#006aa7"],
  AUT: ["#d72b2c", "#ffffff"],
  CAN: ["#ed2224", "#ffffff"],
  CIV: ["#d48c00", "#5bbd19"],
  ALG: ["#5bbd19", "#000000"],
  BIH: ["#112855", "#ffffff"],
  CZE: ["#d7141a", "#ffffff"],
  EGY: ["#D20300", "#000000"],
  KOR: ["#ce2028", "#1e4384"],
  PAR: ["#ea2300", "#0c2fff"],
  SCO: ["#1a2d69", "#dcf5f7"],
  AUS: ["#2a2d7c", "#ed2f31"],
  GHA: ["#ce2931", "#fbd632"],
  IRN: ["#da0000", "#239f40"],
  TUN: ["#D20300", "#000000"],
  COD: ["#418fde", "#C60000"],
  CPV: ["#0000ff", "#EF3340"],
  IRQ: ["#00843d", "#CE1126"],
  JOR: ["#E70000", "#000000"],
  NZL: ["#273476", "#ffffff"],
  PAN: ["#d21034", "#005293"],
  QAT: ["#691a40", "#691a40"],
  KSA: ["#dddddd", "#006233"],
  RSA: ["#087d5a", "#fbb516"],
  UZB: ["#0081d6", "#1EB53A"],
  CUW: ["#0537e4", "#000000"],
  HAI: ["#0033a0", "#D20300"],
};

for (const t of TEAMS) {
  const [color, alt] = THEME[t.code] || ['#1a2659', '#ffffff'];
  t.color = color;
  t.alt = alt;
  t.crest = `https://a.espncdn.com/i/teamlogos/countries/500/${t.code.toLowerCase()}.png`;
}

export const TIERS = [1, 2, 3, 4, 5, 6, 7, 8];

export function teamByCode(code) {
  return TEAMS.find((t) => t.code === code);
}

export function teamsInTier(tier) {
  return TEAMS.filter((t) => t.tier === tier);
}
