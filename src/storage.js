// Progress persisted in localStorage. Every access is guarded: private windows, blocked storage
// and quota errors fall back to an in-memory save so the game still works.
const KEY = 'pirate-king-save-v1';
const DEFAULTS = () => ({ v: 1, gold: 0, unlocked: 1, stars: {}, best: {}, upgrades: { hull: 0, cannons: 0, sails: 0 }, settings: { quality: 'high', sound: true, name: '' }, seenIntro: false });

let memory = null;
function read() {
  try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch { /* storage unavailable */ }
  return memory;
}
function write(save) {
  memory = save;
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* keep in memory only */ }
}

export function loadSave() {
  const d = DEFAULTS(), s = read() || {};
  return { ...d, ...s, upgrades: { ...d.upgrades, ...(s.upgrades || {}) }, settings: { ...d.settings, ...(s.settings || {}) }, stars: { ...(s.stars || {}) }, best: { ...(s.best || {}) } };
}
export function saveSave(save) { write(save); return save; }
export function resetSave() { const d = DEFAULTS(); try { localStorage.removeItem(KEY); } catch {} memory = null; return d; }
