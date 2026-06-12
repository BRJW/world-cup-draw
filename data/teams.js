// World Cup 2026 — 48 teams, seeded into 4 pots of 12 by approximate FIFA ranking.
// Hosts (USA, Mexico, Canada) are placed in Pot 1 per FIFA convention.
//
// NOTE: 2026 qualification is still completing as of build time, so this is a
// sensible default field. Edit freely — pot balance only requires 12 per pot.
// `code` is the ISO-ish 3-letter code; `flag` is the unicode flag emoji.

export const TEAMS = [
  // ---- Pot 1 (strongest) ----
  { code: 'ARG', name: 'Argentina',    flag: '🇦🇷', pot: 1, rank: 1 },
  { code: 'FRA', name: 'France',       flag: '🇫🇷', pot: 1, rank: 2 },
  { code: 'ESP', name: 'Spain',        flag: '🇪🇸', pot: 1, rank: 3 },
  { code: 'ENG', name: 'England',      flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', pot: 1, rank: 4 },
  { code: 'BRA', name: 'Brazil',       flag: '🇧🇷', pot: 1, rank: 5 },
  { code: 'POR', name: 'Portugal',     flag: '🇵🇹', pot: 1, rank: 6 },
  { code: 'NED', name: 'Netherlands',  flag: '🇳🇱', pot: 1, rank: 7 },
  { code: 'BEL', name: 'Belgium',      flag: '🇧🇪', pot: 1, rank: 8 },
  { code: 'USA', name: 'USA',          flag: '🇺🇸', pot: 1, rank: 16, host: true },
  { code: 'MEX', name: 'Mexico',       flag: '🇲🇽', pot: 1, rank: 15, host: true },
  { code: 'CAN', name: 'Canada',       flag: '🇨🇦', pot: 1, rank: 31, host: true },
  { code: 'CRO', name: 'Croatia',      flag: '🇭🇷', pot: 1, rank: 9 },

  // ---- Pot 2 ----
  { code: 'ITA', name: 'Italy',        flag: '🇮🇹', pot: 2, rank: 10 },
  { code: 'GER', name: 'Germany',      flag: '🇩🇪', pot: 2, rank: 11 },
  { code: 'COL', name: 'Colombia',     flag: '🇨🇴', pot: 2, rank: 12 },
  { code: 'URU', name: 'Uruguay',      flag: '🇺🇾', pot: 2, rank: 13 },
  { code: 'MAR', name: 'Morocco',      flag: '🇲🇦', pot: 2, rank: 14 },
  { code: 'SUI', name: 'Switzerland',  flag: '🇨🇭', pot: 2, rank: 17 },
  { code: 'JPN', name: 'Japan',        flag: '🇯🇵', pot: 2, rank: 18 },
  { code: 'SEN', name: 'Senegal',      flag: '🇸🇳', pot: 2, rank: 19 },
  { code: 'DEN', name: 'Denmark',      flag: '🇩🇰', pot: 2, rank: 20 },
  { code: 'IRN', name: 'Iran',         flag: '🇮🇷', pot: 2, rank: 21 },
  { code: 'KOR', name: 'Korea Rep.',   flag: '🇰🇷', pot: 2, rank: 22 },
  { code: 'ECU', name: 'Ecuador',      flag: '🇪🇨', pot: 2, rank: 23 },

  // ---- Pot 3 ----
  { code: 'UKR', name: 'Ukraine',      flag: '🇺🇦', pot: 3, rank: 24 },
  { code: 'AUT', name: 'Austria',      flag: '🇦🇹', pot: 3, rank: 25 },
  { code: 'AUS', name: 'Australia',    flag: '🇦🇺', pot: 3, rank: 26 },
  { code: 'POL', name: 'Poland',       flag: '🇵🇱', pot: 3, rank: 27 },
  { code: 'WAL', name: 'Wales',        flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿', pot: 3, rank: 28 },
  { code: 'SRB', name: 'Serbia',       flag: '🇷🇸', pot: 3, rank: 29 },
  { code: 'EGY', name: 'Egypt',        flag: '🇪🇬', pot: 3, rank: 30 },
  { code: 'ALG', name: 'Algeria',      flag: '🇩🇿', pot: 3, rank: 32 },
  { code: 'SWE', name: 'Sweden',       flag: '🇸🇪', pot: 3, rank: 33 },
  { code: 'TUN', name: 'Tunisia',      flag: '🇹🇳', pot: 3, rank: 34 },
  { code: 'NGA', name: 'Nigeria',      flag: '🇳🇬', pot: 3, rank: 35 },
  { code: 'PER', name: 'Peru',         flag: '🇵🇪', pot: 3, rank: 36 },

  // ---- Pot 4 (underdogs) ----
  { code: 'GHA', name: 'Ghana',        flag: '🇬🇭', pot: 4, rank: 37 },
  { code: 'QAT', name: 'Qatar',        flag: '🇶🇦', pot: 4, rank: 38 },
  { code: 'KSA', name: 'Saudi Arabia', flag: '🇸🇦', pot: 4, rank: 39 },
  { code: 'CRC', name: 'Costa Rica',   flag: '🇨🇷', pot: 4, rank: 40 },
  { code: 'CMR', name: 'Cameroon',     flag: '🇨🇲', pot: 4, rank: 41 },
  { code: 'PAR', name: 'Paraguay',     flag: '🇵🇾', pot: 4, rank: 42 },
  { code: 'CIV', name: "Côte d'Ivoire",flag: '🇨🇮', pot: 4, rank: 43 },
  { code: 'CZE', name: 'Czechia',      flag: '🇨🇿', pot: 4, rank: 44 },
  { code: 'SCO', name: 'Scotland',     flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', pot: 4, rank: 45 },
  { code: 'NOR', name: 'Norway',       flag: '🇳🇴', pot: 4, rank: 46 },
  { code: 'PAN', name: 'Panama',       flag: '🇵🇦', pot: 4, rank: 47 },
  { code: 'NZL', name: 'New Zealand',  flag: '🇳🇿', pot: 4, rank: 48 },
];

export const POTS = [1, 2, 3, 4];

export function teamByCode(code) {
  return TEAMS.find((t) => t.code === code);
}

export function teamsInPot(pot) {
  return TEAMS.filter((t) => t.pot === pot);
}
