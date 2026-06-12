// Vector flag library — simplified but recognizable SVG geometry for all 48
// qualified teams, drawn in a 300x200 viewBox. Each flag is a list of layers
// painted in order; the announcement animates them in one by one.
//
// Complex emblems (eagles, coats of arms) are deliberately stylized — the
// announcement overlays the country's real crest on top, so the flag only has
// to read instantly, not be heraldically perfect.

// ---- primitives -------------------------------------------------------------
const R = (x, y, w, h, f, o = {}) => ({ t: 'r', x, y, w, h, f, ...o });
const C = (cx, cy, r, f, o = {}) => ({ t: 'c', cx, cy, r, f, ...o });
const P = (d, f, o = {}) => ({ t: 'p', d, f, ...o });
const PL = (pts, f, o = {}) => ({ t: 'pl', pts, f, ...o });

function starPath(cx, cy, r, points = 5, inner = 0.42, rot = -90) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (rot + (i * 180) / points) * (Math.PI / 180);
    const rr = i % 2 ? r * inner : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join('L')}Z`;
}
const ST = (cx, cy, r, f, points = 5, inner = 0.42, rot = -90, o = {}) =>
  P(starPath(cx, cy, r, points, inner, rot), f, o);

// Crescent via even-odd fill of two offset circles (opens to the right).
function crescentPath(cx, cy, r, dx = 0.38, ir = 0.84) {
  const c2x = cx + r * dx, r2 = r * ir;
  const circ = (x, rr) =>
    `M${(x - rr).toFixed(1)} ${cy} a${rr} ${rr} 0 1 0 ${2 * rr} 0 a${rr} ${rr} 0 1 0 ${-2 * rr} 0 Z`;
  return circ(cx, r) + ' ' + circ(c2x, r2);
}
const CR = (cx, cy, r, f, dx, ir) => P(crescentPath(cx, cy, r, dx, ir), f, { fr: 1 });

const H3 = (a, b, c) => [R(0, 0, 300, 67, a), R(0, 67, 300, 66, b), R(0, 133, 300, 67, c)];
const V3 = (a, b, c) => [R(0, 0, 100, 200, a), R(100, 0, 100, 200, b), R(200, 0, 100, 200, c)];
const NORDIC = (bg, c1, c2) => [
  R(0, 0, 300, 200, bg),
  R(75, 0, 50, 200, c1), R(0, 75, 300, 50, c1),
  ...(c2 ? [R(87, 0, 26, 200, c2), R(0, 87, 300, 26, c2)] : []),
];

// Mini Union Jack canton (for AUS / NZL), in a 150x100 corner.
const UNION_CANTON = [
  P('M0 0 L150 100', 'none', { stroke: '#fff', sw: 20 }),
  P('M150 0 L0 100', 'none', { stroke: '#fff', sw: 20 }),
  P('M0 0 L150 100', 'none', { stroke: '#C8102E', sw: 8 }),
  P('M150 0 L0 100', 'none', { stroke: '#C8102E', sw: 8 }),
  R(61, 0, 28, 100, '#fff'), R(0, 36, 150, 28, '#fff'),
  R(67, 0, 16, 100, '#C8102E'), R(0, 42, 150, 16, '#C8102E'),
];

// Qatar's nine-point serrated edge.
const qatarEdge = (() => {
  let d = 'M0 0 H70';
  for (let i = 0; i < 9; i++) {
    d += ` L108 ${((200 / 18) * (2 * i + 1)).toFixed(1)} L70 ${((200 / 18) * (2 * i + 2)).toFixed(1)}`;
  }
  return d + ' L0 200 Z';
})();

// ---- the flags --------------------------------------------------------------
export const FLAGS = {
  // Tier 1
  ESP: [R(0, 0, 300, 50, '#AA151B'), R(0, 50, 300, 100, '#F1BF00'), R(0, 150, 300, 50, '#AA151B'),
        C(95, 100, 16, '#AA151B')],
  FRA: V3('#0055A4', '#ffffff', '#EF4135'),
  ENG: [R(0, 0, 300, 200, '#ffffff'), R(125, 0, 50, 200, '#CE1124'), R(0, 75, 300, 50, '#CE1124')],
  POR: [R(0, 0, 120, 200, '#046A38'), R(120, 0, 180, 200, '#DA291C'),
        C(120, 100, 30, 'none', { stroke: '#FFE900', sw: 7 }), C(120, 100, 13, '#ffffff')],
  ARG: [R(0, 0, 300, 67, '#74ACDF'), R(0, 67, 300, 66, '#ffffff'), R(0, 133, 300, 67, '#74ACDF'),
        ST(150, 100, 26, '#F6B40E', 16, 0.72), C(150, 100, 13, '#F6B40E')],
  BRA: [R(0, 0, 300, 200, '#009C3B'), PL('150,18 282,100 150,182 18,100', '#FFDF00'),
        C(150, 100, 40, '#002776'), P('M115 92 q35 -14 70 6', 'none', { stroke: '#ffffff', sw: 7 })],

  // Tier 2
  GER: H3('#000000', '#DD0000', '#FFCE00'),
  NED: H3('#AE1C28', '#ffffff', '#21468B'),
  BEL: V3('#000000', '#FDDA24', '#EF3340'),
  NOR: NORDIC('#BA0C2F', '#ffffff', '#00205B'),
  COL: [R(0, 0, 300, 100, '#FCD116'), R(0, 100, 300, 50, '#003893'), R(0, 150, 300, 50, '#CE1126')],
  MAR: [R(0, 0, 300, 200, '#C1272D'), ST(150, 100, 46, 'none', 5, 0.42, -90, { stroke: '#006233', sw: 8 })],

  // Tier 3
  JPN: [R(0, 0, 300, 200, '#ffffff'), C(150, 100, 40, '#BC002D')],
  USA: [
    ...[...Array(7)].map((_, i) => R(0, (i * 200) / 7, 300, 200 / 7 + 0.5, i % 2 ? '#ffffff' : '#B31942')),
    R(0, 0, 125, 100, '#3C3B6E'),
    ...[20, 62, 104].flatMap((x) => [ST(x, 25, 8, '#ffffff'), ST(x, 75, 8, '#ffffff')]),
    ...[41, 83].map((x) => ST(x, 50, 8, '#ffffff')),
  ],
  MEX: [...V3('#006847', '#ffffff', '#CE1126'), C(150, 100, 24, 'none', { stroke: '#8C6D2F', sw: 5 })],
  SEN: [...V3('#00853F', '#FDEF42', '#E31B23'), ST(150, 100, 30, '#00853F')],
  SUI: [R(0, 0, 300, 200, '#DA291C'), R(127, 55, 46, 90, '#ffffff'), R(105, 77, 90, 46, '#ffffff')],
  TUR: [R(0, 0, 300, 200, '#E30A17'), CR(118, 100, 48), ST(192, 100, 18, '#ffffff', 5, 0.42, -90)],

  // Tier 4
  URU: [
    ...[...Array(9)].map((_, i) => R(0, i * 22.2, 300, 22.5, i % 2 ? '#0038A8' : '#ffffff')),
    R(0, 0, 133, 111, '#ffffff'),
    ST(66, 55, 30, '#FCD116', 16, 0.72), C(66, 55, 15, '#FCD116'),
  ],
  CRO: [R(0, 0, 300, 67, '#FF0000'), R(0, 67, 300, 66, '#ffffff'), R(0, 133, 300, 67, '#171796'),
        ...[...Array(10)].map((_, i) => {
          const c = i % 5, r = Math.floor(i / 5);
          return R(110 + c * 16, 30 + r * 16, 16, 16, (c + r) % 2 ? '#ffffff' : '#FF0000');
        })],
  ECU: [R(0, 0, 300, 100, '#FFDD00'), R(0, 100, 300, 50, '#034EA2'), R(0, 150, 300, 50, '#ED1C24'),
        C(150, 100, 18, 'none', { stroke: '#6E4C1E', sw: 5 })],
  SWE: NORDIC('#006AA7', '#FECC02'),
  AUT: H3('#ED2939', '#ffffff', '#ED2939'),
  CAN: [R(0, 0, 75, 200, '#FF0000'), R(75, 0, 150, 200, '#ffffff'), R(225, 0, 75, 200, '#FF0000'),
        P('M150 52 l10 20 17-9-6 19 20-3-13 16 18 9-20 7 9 17-22-7-3 22-10-18-10 18-3-22-22 7 9-17-20-7 18-9-13-16 20 3-6-19 17 9 z', '#FF0000'),
        R(147, 138, 6, 18, '#FF0000')],

  // Tier 5
  CIV: V3('#FF8200', '#ffffff', '#009A44'),
  ALG: [R(0, 0, 150, 200, '#006233'), R(150, 0, 150, 200, '#ffffff'),
        CR(148, 100, 45, '#D21034'), ST(176, 100, 16, '#D21034')],
  BIH: [R(0, 0, 300, 200, '#002F6C'), PL('105,0 245,0 245,200', '#FECB00'),
        ST(88, 22, 12, '#ffffff'), ST(122, 70, 12, '#ffffff'),
        ST(156, 118, 12, '#ffffff'), ST(190, 166, 12, '#ffffff')],
  CZE: [R(0, 0, 300, 100, '#ffffff'), R(0, 100, 300, 100, '#D7141A'), PL('0,0 150,100 0,200', '#11457E')],
  EGY: [...H3('#CE1126', '#ffffff', '#000000'), PL('150,82 162,100 150,118 138,100', '#C09300')],
  KOR: [R(0, 0, 300, 200, '#ffffff'), C(150, 100, 40, '#0047A0'),
        P('M110 100 a40 40 0 0 1 80 0 a20 20 0 0 1 -40 0 a20 20 0 1 0 -40 0 Z', '#CD2E3A'),
        R(60, 52, 34, 7, '#000'), R(60, 65, 34, 7, '#000'), R(60, 78, 34, 7, '#000'),
        R(206, 115, 34, 7, '#000'), R(206, 128, 34, 7, '#000'), R(206, 141, 34, 7, '#000')],

  // Tier 6
  PAR: [...H3('#D52B1E', '#ffffff', '#0038A8'),
        C(150, 100, 20, 'none', { stroke: '#009B3A', sw: 5 }), ST(150, 100, 9, '#FCD116')],
  SCO: [R(0, 0, 300, 200, '#005EB8'),
        P('M0 0 L300 200', 'none', { stroke: '#ffffff', sw: 40 }),
        P('M300 0 L0 200', 'none', { stroke: '#ffffff', sw: 40 })],
  AUS: [R(0, 0, 300, 200, '#012169'), ...UNION_CANTON,
        ST(75, 155, 17, '#ffffff', 7, 0.55),
        ST(232, 35, 10, '#ffffff', 7, 0.55), ST(196, 88, 10, '#ffffff', 7, 0.55),
        ST(268, 78, 10, '#ffffff', 7, 0.55), ST(232, 162, 11, '#ffffff', 7, 0.55),
        ST(251, 112, 6, '#ffffff')],
  GHA: [...H3('#CE1126', '#FCD116', '#006B3F'), ST(150, 100, 28, '#000000')],
  IRN: [...H3('#239F40', '#ffffff', '#DA0000'),
        P('M150 78 c-14 8 -14 28 0 40 c14 -12 14 -32 0 -40 Z', '#DA0000'),
        P('M150 74 v46', 'none', { stroke: '#DA0000', sw: 4 })],
  TUN: [R(0, 0, 300, 200, '#E70013'), C(150, 100, 50, '#ffffff'),
        CR(146, 100, 38, '#E70013', 0.34, 0.86), ST(166, 100, 15, '#E70013')],

  // Tier 7
  COD: [R(0, 0, 300, 200, '#007FFF'),
        PL('0,242 0,158 300,-42 300,42', '#F7D618'),
        PL('0,228 0,172 300,-28 300,28', '#CE1021'),
        ST(48, 42, 28, '#F7D618')],
  CPV: [R(0, 0, 300, 200, '#003893'),
        R(0, 118, 300, 17, '#ffffff'), R(0, 135, 300, 12, '#CF2027'), R(0, 147, 300, 17, '#ffffff'),
        ...[...Array(6)].map((_, i) => {
          const a = (i * 60 * Math.PI) / 180;
          return ST(105 + 30 * Math.cos(a), 132 + 30 * Math.sin(a), 8, '#F7D618');
        })],
  IRQ: [...H3('#CE1126', '#ffffff', '#000000'),
        P('M95 96 q12 -16 24 0 t24 0 t24 0 t24 0', 'none', { stroke: '#007A3D', sw: 6 })],
  JOR: [...H3('#000000', '#ffffff', '#007A3D'), PL('0,0 150,100 0,200', '#CE1126'),
        ST(55, 100, 15, '#ffffff', 7, 0.5)],
  NZL: [R(0, 0, 300, 200, '#012169'), ...UNION_CANTON,
        ST(232, 42, 11, '#C8102E', 5, 0.42, -90, { stroke: '#ffffff', sw: 3 }),
        ST(198, 88, 10, '#C8102E', 5, 0.42, -90, { stroke: '#ffffff', sw: 3 }),
        ST(266, 88, 10, '#C8102E', 5, 0.42, -90, { stroke: '#ffffff', sw: 3 }),
        ST(232, 150, 12, '#C8102E', 5, 0.42, -90, { stroke: '#ffffff', sw: 3 })],
  PAN: [R(0, 0, 150, 100, '#ffffff'), R(150, 0, 150, 100, '#D21034'),
        R(0, 100, 150, 100, '#005293'), R(150, 100, 150, 100, '#ffffff'),
        ST(75, 50, 22, '#005293'), ST(225, 150, 22, '#D21034')],

  // Tier 8
  QAT: [R(0, 0, 300, 200, '#8A1538'), P(qatarEdge, '#ffffff')],
  KSA: [R(0, 0, 300, 200, '#165D31'),
        R(62, 130, 168, 11, '#ffffff', { rx: 5 }), R(232, 126, 20, 14, '#ffffff', { rx: 4 }),
        P('M85 78 q14 -18 28 0 t28 0 t28 0 t28 0 t28 0', 'none', { stroke: '#ffffff', sw: 7 })],
  RSA: [R(0, 0, 300, 100, '#E03C31'), R(0, 100, 300, 100, '#001489'),
        P('M0 8 L132 100 L0 192', 'none', { stroke: '#ffffff', sw: 60 }),
        R(100, 64, 200, 72, '#ffffff'),
        P('M0 24 L138 100 L0 176', 'none', { stroke: '#007749', sw: 34 }),
        R(116, 82, 184, 36, '#007749'),
        PL('0,40 86,100 0,160', '#FFB81C'),
        PL('0,52 72,100 0,148', '#000000')],
  UZB: [R(0, 0, 300, 67, '#0099B5'), R(0, 67, 300, 10, '#CE1126'), R(0, 77, 300, 46, '#ffffff'),
        R(0, 123, 300, 10, '#CE1126'), R(0, 133, 300, 67, '#1EB53A'),
        CR(56, 33, 19), ST(100, 22, 6, '#ffffff'), ST(118, 34, 6, '#ffffff'), ST(100, 46, 6, '#ffffff')],
  CUW: [R(0, 0, 300, 200, '#002B7F'), R(0, 148, 300, 25, '#F9E814'),
        ST(45, 38, 9, '#ffffff'), ST(76, 74, 15, '#ffffff')],
  HAI: [R(0, 0, 300, 100, '#00209F'), R(0, 100, 300, 100, '#D21034'),
        R(108, 68, 84, 64, '#ffffff'), PL('150,80 168,112 132,112', '#007A3D')],
};

// crescents default to white fill
for (const layers of Object.values(FLAGS)) {
  for (const l of layers) if (l.fr && !l.f) l.f = '#ffffff';
}

// ---- renderer ---------------------------------------------------------------
const GENERIC = (c1, c2) => [R(0, 0, 300, 200, c1), PL('0,200 300,0 300,200', c2)];

export function flagSVG(code, team) {
  const layers = FLAGS[code] || GENERIC(team?.color || '#1a2659', team?.alt || '#ffffff');
  const els = layers.map((l, i) => {
    const at = `class="fl" style="animation-delay:${55 + i * 55}ms"`;
    const paint = l.stroke
      ? `fill="${l.f || 'none'}" stroke="${l.stroke}" stroke-width="${l.sw || 6}" stroke-linecap="round" stroke-linejoin="round"`
      : `fill="${l.f}"`;
    switch (l.t) {
      case 'r': return `<rect ${at} x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}"${l.rx ? ` rx="${l.rx}"` : ''} ${paint}/>`;
      case 'c': return `<circle ${at} cx="${l.cx}" cy="${l.cy}" r="${l.r}" ${paint}/>`;
      case 'p': return `<path ${at} d="${l.d}"${l.fr ? ' fill-rule="evenodd"' : ''} ${paint}/>`;
      case 'pl': return `<polygon ${at} points="${l.pts}" ${paint}/>`;
      default: return '';
    }
  }).join('');
  return `<svg viewBox="0 0 300 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${els}</svg>`;
}

// Distinct colours used by a flag — feeds the confetti burst.
export function flagPalette(code, team) {
  const layers = FLAGS[code] || GENERIC(team?.color || '#1a2659', team?.alt || '#ffffff');
  const out = new Set();
  for (const l of layers) {
    if (l.f && l.f !== 'none') out.add(l.f);
    if (l.stroke) out.add(l.stroke);
  }
  return [...out];
}
