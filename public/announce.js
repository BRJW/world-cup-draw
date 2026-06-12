// Full-screen draw announcement — shared by the app (real picks) and the
// flags-preview page (demo mode). Self-contained: pass in the team, a round
// label, and an optional coach {name, teamName, image}.

import { flagSVG, flagPalette } from '/flags.js?v=14';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = (name) => String(name || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

let timers = [];
let doneCb = null;
const later = (fn, ms) => timers.push(setTimeout(fn, ms));

function coachLine(coach) {
  if (!coach) return '';
  const av = coach.image
    ? `<img class="announce-coach-img" src="${coach.image}" alt="" />`
    : `<span class="announce-coach-init">${esc(initials(coach.name))}</span>`;
  const club = coach.teamName ? ` · <i>${esc(coach.teamName)}</i>` : '';
  return `${av}<span>drafted by <b>${esc(coach.name)}</b>${club}</span>`;
}

export function playAnnouncement({ team, roundLabel = '', coach = null, drumrollMs = 750, holdMs = 2850 }, done) {
  // tear down any announcement already on screen (its callback is dropped)
  timers.forEach(clearTimeout); timers = [];
  document.getElementById('announce')?.remove();
  doneCb = done || null;

  const el = document.createElement('div');
  el.id = 'announce';
  el.className = 'announce';
  el.style.setProperty('--c1', team.color || '#1a2659');
  el.style.setProperty('--c2', team.alt || '#0b1437');
  el.innerHTML = `
    <div class="announce-bg"></div>
    <div class="announce-rays"></div>
    <div class="announce-inner">
      <div class="announce-round">${esc(roundLabel)}</div>
      <div class="announce-stage">
        <div class="announce-flagwrap" id="ann-flag"><div class="announce-dice">🎲</div></div>
        <img class="announce-crest" id="ann-crest" alt="" />
      </div>
      <div class="announce-name" id="ann-name"><span class="drawing">Drawing<i>.</i><i>.</i><i>.</i></span></div>
      <div class="announce-odds" id="ann-odds"></div>
      <div class="announce-coach" id="ann-coach"></div>
      <div class="announce-skip">tap anywhere to skip</div>
    </div>
    <div class="announce-confetti" id="ann-conf"></div>`;
  el.addEventListener('click', finishAnnouncement);
  document.body.appendChild(el);

  // Phase 2 — the reveal: flag builds layer by layer, crest drops, name slams.
  later(() => {
    const root = document.getElementById('announce');
    if (!root) return;
    root.classList.add('revealed');

    root.querySelector('#ann-flag').innerHTML = flagSVG(team.code, team);

    const crest = root.querySelector('#ann-crest');
    crest.onload = () => crest.classList.add('show');
    crest.onerror = () => crest.remove();
    crest.src = team.crest || '';

    root.querySelector('#ann-name').innerHTML = team.name.split('').map((ch, i) =>
      `<span class="ltr" style="animation-delay:${380 + i * 26}ms">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`
    ).join('');

    later(() => { root.querySelector('#ann-odds').textContent = `${team.odds} to lift the trophy`; }, 650);
    if (coach) later(() => { root.querySelector('#ann-coach').innerHTML = coachLine(coach); }, 850);
    later(() => burstConfetti(root.querySelector('#ann-conf'), flagPalette(team.code, team)), 420);
    later(finishAnnouncement, drumrollMs + holdMs);
  }, drumrollMs);
}

function burstConfetti(box, colors) {
  if (!box) return;
  let html = '';
  for (let i = 0; i < 44; i++) {
    const c = colors[i % colors.length];
    const tx = (Math.random() * 2 - 1) * 190;
    const ty = -30 - Math.random() * 160;
    const rot = (Math.random() * 2 - 1) * 540;
    const dur = 1200 + Math.random() * 900;
    const del = Math.random() * 180;
    const sz = 5 + Math.random() * 7;
    html += `<span class="cf" style="background:${c};width:${sz}px;height:${sz * (0.6 + Math.random())}px;` +
      `--tx:${tx.toFixed(0)}px;--ty:${ty.toFixed(0)}px;--rot:${rot.toFixed(0)}deg;` +
      `animation-duration:${dur.toFixed(0)}ms;animation-delay:${del.toFixed(0)}ms"></span>`;
  }
  box.innerHTML = html;
}

export function finishAnnouncement() {
  timers.forEach(clearTimeout); timers = [];
  const el = document.getElementById('announce');
  const cb = doneCb; doneCb = null;
  if (el) {
    el.classList.add('out');
    setTimeout(() => { el.remove(); if (cb) cb(); }, 380);
  } else if (cb) {
    cb();
  }
}
