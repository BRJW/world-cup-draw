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

export const TIERS = [1, 2, 3, 4, 5, 6, 7, 8];

export function teamByCode(code) {
  return TEAMS.find((t) => t.code === code);
}

export function teamsInTier(tier) {
  return TEAMS.filter((t) => t.tier === tier);
}
