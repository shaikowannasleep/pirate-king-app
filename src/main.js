// Pirate King player app: title -> sea chart -> shipwright -> battle -> results.
import '../vendor/pirate-king-runtime.js'; // IIFE build of the editor runtime; defines globalThis.PirateKing
import levelsFile from './levels.json';
import { loadSave, saveSave, resetSave } from './storage.js';
import { WHEEL, COMPASS, islandSvg, LOCK, STAR, GEAR, BACK, COIN, UPGRADE_ICONS } from './art.js';
import './styles.css';
import { startLiveUpdate } from './live-update.js';

const PK = globalThis.PirateKing;
// Converted character models ship inside the site under dist/assets/idlefarm (relative, so GitHub project pages work).
const ASSET_ROOT = 'assets/idlefarm/';
const LEVELS = levelsFile.levels;
const UP = PK.config.UPGRADES;
const stage = document.getElementById('stage'), ui = document.getElementById('ui');
let save = loadSave();
let runtime = null, screen = '', modal = null;

// Chart positions (percent of the chart box) for the 5 islands, and the route between them.
const CHART = [
  { x: 16, y: 74, seed: 3 }, { x: 35, y: 44, seed: 7 }, { x: 56, y: 68, seed: 11 }, { x: 70, y: 32, seed: 5 }, { x: 87, y: 60, seed: 19 },
];
const ENV_LABEL = { dawn: 'Dawn', noon: 'Midday', sunset: 'Sunset', storm: 'Storm', night: 'Moonlit night' };
const UPGRADE_INFO = {
  hull: { name: 'Hull', text: (l) => `+${Math.round(UP.hull.hpPerLevel * 100 * l)}% hull strength` },
  cannons: { name: 'Cannons', text: (l) => `+${Math.round(UP.cannons.damagePerLevel * 100 * l)}% damage, ${Math.round(UP.cannons.reloadPerLevel * 100 * l)}% faster reload` },
  sails: { name: 'Sails', text: (l) => `+${Math.round(UP.sails.speedPerLevel * 100 * l)}% speed, +${Math.round(UP.sails.turnPerLevel * 100 * l)}% turning` },
};

const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const totalStars = () => Object.values(save.stars).reduce((a, b) => a + b, 0);
const persist = () => saveSave(save);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
let audioCtx = null;
function blip(freq = 660, dur = 0.08) {
  if (!save.settings.sound) return;
  try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); const t = audioCtx.currentTime, o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.type = 'triangle'; o.frequency.value = freq; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + dur + 0.02); } catch {}
}

function stopRuntime() { if (runtime) { try { runtime.dispose(); } catch (e) { console.warn(e); } runtime = null; } }
function setScreen(name, el) {
  screen = name; closeModal();
  ui.replaceChildren(el); ui.dataset.screen = name; document.body.dataset.screen = name;
  requestAnimationFrame(() => el.classList.add('in'));
  window.__app = { screen, save, runtime, levels: LEVELS };
startLiveUpdate(() => screen);
}

// ---------------- Title ----------------
function showTitle() {
  if (!runtime || runtime.__attract !== true) {
    stopRuntime();
    try { runtime = PK.boot(stage, { assetRoot: ASSET_ROOT, levels: [LEVELS[0]], mode: 'attract', hud: false, quality: save.settings.quality, sound: false, seed: 4, autoQuality: !save.settings.qualityLocked, onEvent: (e) => { if (e.type === 'quality') onAutoQuality(e); } }); runtime.__attract = true; } catch (e) { console.error(e); }
  }
  const el = h(`<section class="screen title">
    <div class="title-vignette"></div>
    <div class="title-top"><button class="icon-btn" data-act="settings" aria-label="Settings">${GEAR}</button></div>
    <div class="title-center">
      ${WHEEL}
      <div class="kicker">A tale of cannon &amp; gold</div>
      <h1 class="logo"><span>Pirate</span><span>King</span></h1>
      <div class="rule"><i></i><b></b><i></i></div>
      <p class="tagline">Rule the seven seas. Sink the fleet. Claim the crown.</p>
      <div class="mode-select">
        <button class="btn primary big" data-act="play" aria-label="Play campaign">Campaign</button>
        <button class="btn big crew-btn" data-act="crew" aria-label="Crew Seas, online crews">Crew Seas <span class="mode-sub">online crews</span></button>
      </div>
      <div class="title-meta">${totalStars()} / ${LEVELS.length * 3} stars &nbsp;&middot;&nbsp; ${COIN} ${fmt(save.gold)}</div>
    </div>
    <div class="title-foot"><span class="hint-kb">Keyboard: A/D steer &middot; W/S sails &middot; Q/E fire &middot; Space auto-fire</span><span class="hint-touch">Drag the wheel to steer &middot; tap to fire broadsides</span></div>
  </section>`);
  el.addEventListener('click', (e) => { const a = e.target.closest('[data-act]')?.dataset.act; if (a === 'play') { blip(523); showMap(); } else if (a === 'crew') { blip(523); showCrew(); } else if (a === 'settings') openSettings(); });
  setScreen('title', el);
}

// ---------------- Crew Seas (Mode 2 multiplayer) ----------------
let crewUI = null;
function stopCrew() { if (crewUI) { try { crewUI.dispose(); } catch (e) { console.warn(e); } crewUI = null; } }
function showCrew(joinCode) {
  if (typeof PK.lobby !== 'function') {
    // This runtime build predates Mode 2: keep the campaign untouched and say so.
    openModal(`<div class="modal-card" data-testid="crew-soon"><div class="kicker">Crew Seas</div><h3>Coming soon</h3><p class="brief-text">Multiplayer crews are not in this build yet. The campaign is ready to play.</p><div class="row"><button class="btn primary" data-act="close">Back</button></div></div>`, (a) => { if (a === 'close') closeModal(); });
    return;
  }
  stopRuntime(); stopCrew(); closeModal();
  screen = 'crew'; ui.replaceChildren(); ui.dataset.screen = 'crew'; document.body.dataset.screen = 'crew';
  const extra = {}; // the runtime wires its own net/sim/bootCrew; pass them only if exposed separately
  for (const k of ['bootCrew', 'net', 'sim']) if (PK[k]) extra[k] = PK[k];
  window.__app = { screen, save, runtime: null, levels: LEVELS };
  startLiveUpdate(() => screen);
  crewUI = PK.lobby(stage, {
    ...extra, quality: save.settings.quality, playerName: save.settings.name || '', joinCode: joinCode || undefined,
    onEvent: (e) => { if (e?.type === 'name') { save.settings.name = String(e.name || '').slice(0, 16); persist(); } },
    onExit: () => { stopCrew(); showTitle(); },
  });
}

// ---------------- Sea chart (level select) ----------------
function showMap() {
  stopRuntime();
  const portrait = window.innerHeight > window.innerWidth * 1.1;
  const pos = (i) => { const p = CHART[i] || { x: 10 + i * 18, y: 50, seed: i }; return portrait ? { x: p.y, y: 100 - p.x, seed: p.seed } : p; };
  const W = portrait ? 620 : 1000, H = portrait ? 1000 : 620;
  const nodes = LEVELS.map((l, i) => {
    const p = pos(i);
    const locked = i + 1 > save.unlocked, stars = save.stars[l.id] || 0, current = i + 1 === save.unlocked && !save.stars[l.id];
    return `<button class="isle${locked ? ' locked' : ''}${current ? ' current' : ''}" style="left:${p.x}%;top:${p.y}%" data-level="${i}" ${locked ? 'aria-disabled="true"' : ''} aria-label="Level ${i + 1}: ${l.name}${locked ? ' (locked)' : ''}">
      <span class="isle-art">${islandSvg(p.seed, locked)}</span>
      <span class="isle-num">${locked ? LOCK : i + 1}</span>
      <span class="isle-label"><b>${l.name}</b><span class="isle-stars">${[0, 1, 2].map((k) => STAR(k < stars)).join('')}</span></span>
    </button>`;
  }).join('');
  const route = LEVELS.map((_, i) => pos(i)).map((p, i) => `${i ? 'L' : 'M'}${(p.x * W) / 100} ${(p.y * H) / 100}`).join(' ');
  const el = h(`<section class="screen map">
    <header class="bar">
      <button class="icon-btn" data-act="back" aria-label="Back to title">${BACK}</button>
      <div class="bar-title"><span class="kicker">Captain's chart</span><h2>The Seven Seas</h2></div>
      <div class="bar-right"><div class="purse">${COIN}<b>${fmt(save.gold)}</b></div><button class="icon-btn" data-act="settings" aria-label="Settings">${GEAR}</button></div>
    </header>
    <div class="chart-wrap"><div class="chart${portrait ? ' portrait' : ''}">
      <svg class="chart-bg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <filter id="paper"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" seed="4"/><feColorMatrix values="0 0 0 0 .45  0 0 0 0 .33  0 0 0 0 .17  0 0 0 .22 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
          <radialGradient id="burn" cx="50%" cy="50%" r="72%"><stop offset=".62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#3a2410" stop-opacity=".75"/></radialGradient>
          <pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse"><path d="M100 0H0V100" fill="none" stroke="#7a5a32" stroke-width=".7" opacity=".35"/></pattern>
        </defs>
        <rect width="${W}" height="${H}" fill="#ead6a6"/><rect width="${W}" height="${H}" fill="url(#grid)"/>
        <rect width="${W}" height="${H}" filter="url(#paper)" fill="#ead6a6"/>
        <g fill="none" stroke="#8aa9a0" stroke-width="1.2" opacity=".55">${[0, 1, 2, 3, 4, 5].map((i) => `<path d="M${(W * (0.06 + i * 0.16)).toFixed(0)} ${(H * (0.15 + (i % 3) * 0.27)).toFixed(0)}q14-8 28 0t28 0"/>`).join('')}</g>
        <path d="${route}" fill="none" stroke="#8a2e1b" stroke-width="3" stroke-dasharray="2 12" stroke-linecap="round" opacity=".85"/>
        <rect width="${W}" height="${H}" fill="url(#burn)"/>
      </svg>
      <div class="compass">${COMPASS}</div>
      <div class="cartouche">Mare Piratica</div>
      ${nodes}
    </div></div>
    <footer class="map-foot"><span>${totalStars()} / ${LEVELS.length * 3} stars</span><span class="dot">&middot;</span><span>Tap an island to set sail</span><button class="btn ghost" data-act="shop">Shipwright</button></footer>
  </section>`);
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-level],[data-act]'); if (!t) return;
    if (t.dataset.act === 'back') return showTitle();
    if (t.dataset.act === 'settings') return openSettings();
    if (t.dataset.act === 'shop') return showShop(null);
    const i = Number(t.dataset.level);
    if (i + 1 > save.unlocked) { t.classList.remove('shake'); void t.offsetWidth; t.classList.add('shake'); blip(180, 0.12); return; }
    blip(587); openBriefing(i);
  });
  setScreen('map', el);
}

function openBriefing(i) {
  const l = LEVELS[i];
  const enemies = (l.enemies || []).reduce((m, e) => ((m[e.kind] = (m[e.kind] || 0) + 1), m), {});
  const foes = Object.entries(enemies).map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(', ') + ((l.forts || []).length ? `, ${(l.forts || []).length} fort${l.forts.length > 1 ? 's' : ''}` : '');
  openModal(`<div class="modal-card brief" data-testid="briefing">
    <div class="kicker">Level ${i + 1} &middot; ${ENV_LABEL[l.env?.time] || 'Open sea'}</div>
    <h3>${l.name}</h3>
    <p class="brief-text">${l.description || PK.goalBrief(l)}</p>
    <dl class="brief-grid"><div><dt>Objective</dt><dd>${PK.goalBrief(l)}</dd></div><div><dt>Enemies</dt><dd>${foes || 'None sighted'}</dd></div><div><dt>Wind</dt><dd>${l.wind?.speed ?? 8} knots</dd></div><div><dt>Best</dt><dd class="brief-stars">${[0, 1, 2].map((k) => STAR(k < (save.stars[l.id] || 0))).join('')}</dd></div></dl>
    <div class="row"><button class="btn ghost" data-act="close">Back</button><button class="btn ghost" data-act="shop">Shipwright</button><button class="btn primary" data-act="sail">Set sail</button></div>
  </div>`, (a) => { if (a === 'sail') { closeModal(); startLevel(i); } else if (a === 'shop') { closeModal(); showShop(i); } else closeModal(); });
}

// ---------------- Shipwright (upgrade shop) ----------------
function showShop(nextLevel) {
  stopRuntime();
  const cards = Object.keys(UPGRADE_INFO).map((k) => {
    const lv = save.upgrades[k] || 0, max = lv >= UP.maxLevel, cost = max ? 0 : UP.costs[lv], afford = !max && save.gold >= cost;
    return `<article class="up-card${max ? ' maxed' : ''}" data-up="${k}">
      <div class="up-icon">${UPGRADE_ICONS[k]}</div>
      <div class="up-body"><h4>${UPGRADE_INFO[k].name}</h4>
        <div class="pips">${Array.from({ length: UP.maxLevel }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}<span>Lv ${lv}/${UP.maxLevel}</span></div>
        <p>${lv ? UPGRADE_INFO[k].text(lv) : 'Standard issue'}${max ? '' : `<br><small>Next: ${UPGRADE_INFO[k].text(lv + 1)}</small>`}</p></div>
      <button class="btn ${afford ? 'primary' : 'ghost'} buy" data-buy="${k}" ${afford ? '' : 'disabled'}>${max ? 'Maxed' : `${COIN}<b>${fmt(cost)}</b>`}</button>
    </article>`;
  }).join('');
  const el = h(`<section class="screen shop">
    <header class="bar">
      <button class="icon-btn" data-act="back" aria-label="Back to chart">${BACK}</button>
      <div class="bar-title"><span class="kicker">Port Royal</span><h2>Shipwright</h2></div>
      <div class="bar-right"><div class="purse" data-testid="purse">${COIN}<b>${fmt(save.gold)}</b></div></div>
    </header>
    <div class="shop-body">
      <p class="shop-lead">Spend your plunder to strengthen your brig. Upgrades carry into every battle.</p>
      <div class="up-list">${cards}</div>
    </div>
    <footer class="shop-foot">${nextLevel != null ? `<button class="btn primary big" data-act="sail">Set sail &middot; ${LEVELS[nextLevel].name}</button>` : '<button class="btn primary big" data-act="back">Back to chart</button>'}</footer>
  </section>`);
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act],[data-buy]'); if (!t) return;
    if (t.dataset.buy) {
      const k = t.dataset.buy, lv = save.upgrades[k] || 0, cost = UP.costs[lv];
      if (lv < UP.maxLevel && save.gold >= cost) { save.gold -= cost; save.upgrades[k] = lv + 1; persist(); blip(880, 0.12); blip(1320, 0.18); showShop(nextLevel); }
      return;
    }
    if (t.dataset.act === 'sail') startLevel(nextLevel); else showMap();
  });
  setScreen('shop', el);
}

// ---------------- Battle ----------------
function startLevel(i) {
  stopRuntime();
  const el = h('<section class="screen game"></section>');
  setScreen('game', el);
  runtime = PK.boot(stage, {
    assetRoot: ASSET_ROOT,
    levels: LEVELS, startLevel: i, mode: 'play', quality: save.settings.quality, sound: save.settings.sound,
    upgrades: { ...save.upgrades }, menuAction: 'Chart', seed: 1 + i, autoQuality: !save.settings.qualityLocked,
    actions: (r) => r.won
      ? [{ id: 'menu', label: 'Chart' }, { id: 'retry', label: 'Retry' }, ...(r.levelIndex < LEVELS.length - 1 ? [{ id: 'next', label: 'Continue', primary: true }] : [{ id: 'menu', label: 'Claim the crown', primary: true }])]
      : [{ id: 'menu', label: 'Chart' }, { id: 'shop', label: 'Shipwright' }, { id: 'retry', label: 'Retry', primary: true }],
    onEvent: (e) => { if (e.type === 'quality') onAutoQuality(e); if (e.type === 'result') recordResult(e); if (e.type === 'start') { window.__app.level = e.levelIndex; } },
    onAction: (id, r, api) => {
      if (id === 'menu') { showMap(); return true; }
      if (id === 'shop') { showShop(api.levelIndex); return true; }
      if (id === 'next') { showShop(Math.min(LEVELS.length - 1, (r?.levelIndex ?? api.levelIndex) + 1)); return true; }
      if (id === 'retry') { api.setUpgrades({ ...save.upgrades }); return false; }
      return false;
    },
  });
  window.__app.runtime = runtime;
}

// The renderer measured a low frame rate and switched to 'low': remember it (the Settings toggle shows it).
function onAutoQuality(e) { if (!save.settings.qualityLocked) { save.settings.quality = e.value; persist(); } }

function recordResult(r) {
  if (!r.won) { save.gold += Math.round(r.gold * 0.5); persist(); return; } // salvage: half the plunder on defeat
  const id = LEVELS[r.levelIndex].id;
  save.gold += r.gold;
  save.stars[id] = Math.max(save.stars[id] || 0, r.stars);
  save.best[id] = Math.max(save.best[id] || 0, r.score || 0);
  save.unlocked = Math.max(save.unlocked, Math.min(LEVELS.length, r.levelIndex + 2));
  persist();
}

// ---------------- Settings & modal ----------------
function openSettings() {
  const s = save.settings;
  openModal(`<div class="modal-card settings" data-testid="settings">
    <div class="kicker">Captain's log</div><h3>Settings</h3>
    <div class="set-row"><span>Graphics quality</span><div class="seg" data-key="quality"><button data-v="low" class="${s.quality === 'low' ? 'on' : ''}">Low</button><button data-v="high" class="${s.quality === 'high' ? 'on' : ''}">High</button></div></div>
    <div class="set-row"><span>Sound</span><div class="seg" data-key="sound"><button data-v="off" class="${!s.sound ? 'on' : ''}">Off</button><button data-v="on" class="${s.sound ? 'on' : ''}">On</button></div></div>
    <div class="set-row"><span>Progress</span><button class="btn ghost small" data-act="reset">Reset save</button></div>
    <div class="row"><button class="btn primary" data-act="close">Done</button></div>
  </div>`, (a, t) => {
    if (a === 'close') return closeModal();
    if (a === 'reset') { if (t.dataset.armed) { save = resetSave(); persist(); closeModal(); showTitle(); } else { t.dataset.armed = '1'; t.textContent = 'Tap again to confirm'; } return; }
    const seg = t.closest('.seg'); if (!seg) return;
    if (seg.dataset.key === 'quality') { s.quality = t.dataset.v; s.qualityLocked = true; runtime?.setQuality(s.quality); }
    if (seg.dataset.key === 'sound') { s.sound = t.dataset.v === 'on'; runtime?.setSound(s.sound); }
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === t)); persist(); blip(740);
  });
}
function openModal(html, onAct) {
  closeModal();
  modal = h(`<div class="modal">${html}</div>`);
  modal.addEventListener('click', (e) => { if (e.target === modal) return closeModal(); const t = e.target.closest('[data-act],[data-v]'); if (t) onAct(t.dataset.act, t); });
  document.body.appendChild(modal); requestAnimationFrame(() => modal?.classList.add('in'));
}
function closeModal() { modal?.remove(); modal = null; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal) closeModal(); });

let lastPortrait = null;
window.addEventListener('resize', () => { const p = window.innerHeight > window.innerWidth * 1.1; if (screen === 'map' && p !== lastPortrait) showMap(); lastPortrait = p; });
window.__app = { screen, save, runtime, levels: LEVELS };
startLiveUpdate(() => screen);
window.__appApi = { showCrew, showTitle, showMap, showShop, startLevel, openSettings, get runtime() { return runtime; }, get save() { return save; } };
showTitle();
// A share link (?join=123456) goes straight to the join flow with the code filled in.
{
  const code = new URLSearchParams(location.search).get('join');
  if (code && /^\d{6}$/.test(code.trim())) showCrew(code.trim());
}
