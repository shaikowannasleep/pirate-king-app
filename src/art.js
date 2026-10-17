// Inline SVG art (no external files): emblem, island glyphs, compass rose, icons.
export const WHEEL = `<svg class="emblem" viewBox="0 0 120 120" aria-hidden="true">
<defs><linearGradient id="gGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1bf"/><stop offset=".45" stop-color="#f2c055"/><stop offset="1" stop-color="#9a6514"/></linearGradient></defs>
<g fill="none" stroke="url(#gGold)" stroke-linecap="round">
<circle cx="60" cy="60" r="34" stroke-width="7"/><circle cx="60" cy="60" r="10" stroke-width="6"/>
${Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4, c = Math.cos(a), s = Math.sin(a); return `<line x1="${(60 + c * 14).toFixed(1)}" y1="${(60 + s * 14).toFixed(1)}" x2="${(60 + c * 52).toFixed(1)}" y2="${(60 + s * 52).toFixed(1)}" stroke-width="5"/><circle cx="${(60 + c * 54).toFixed(1)}" cy="${(60 + s * 54).toFixed(1)}" r="4.5" fill="url(#gGold)" stroke="none"/>`; }).join('')}
</g></svg>`;

export const COMPASS = `<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="#5a3d1c" stroke-width=".8" opacity=".75"><circle cx="50" cy="50" r="44"/><circle cx="50" cy="50" r="38"/></g>
<g fill="#5a3d1c" opacity=".8"><path d="M50 4 56 50 50 96 44 50z"/><path d="M4 50 50 44 96 50 50 56z" opacity=".75"/><path d="M50 50 63 37 50 50 37 63z"/></g>
<g fill="#b1381f"><path d="M50 4 56 50 50 50z"/></g><g font-family="Georgia,serif" font-size="9" font-weight="700" fill="#4a2f12" text-anchor="middle"><text x="50" y="-1" dy="0">N</text></g></svg>`;

export function islandSvg(seed = 1, locked = false) {
  // deterministic blobby island outline
  let s = seed * 9301 + 49297; const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const pts = []; const n = 14;
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, r = 30 + rnd() * 9; pts.push([50 + Math.cos(a) * r * 1.18, 50 + Math.sin(a) * r * 0.82]); }
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ') + 'Z';
  const inner = pts.map((p, i) => `${i ? 'L' : 'M'}${(50 + (p[0] - 50) * 0.62).toFixed(1)} ${(50 + (p[1] - 50) * 0.62).toFixed(1)}`).join(' ') + 'Z';
  const sea = locked ? '#b8a77f' : '#9fc2b4';
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="${d}" fill="none" stroke="${sea}" stroke-width="7" opacity=".55" transform="translate(0 2)"/><path d="${d}" fill="${locked ? '#cdb98b' : '#e6cf92'}" stroke="#6b4a22" stroke-width="1.6"/><path d="${inner}" fill="${locked ? '#a99a74' : '#7d9a55'}" stroke="#4d5f2f" stroke-width="1" opacity=".95"/></svg>`;
}

export const LOCK = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" fill="#3b2a16"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="#3b2a16" stroke-width="2.4"/></svg>';
export const STAR = (on) => `<svg viewBox="0 0 24 24" class="st${on ? ' on' : ''}" aria-hidden="true"><path d="M12 1.8l3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 17.9l-6.4 3.5L7 14.3l-5.3-5 7.2-.9z"/></svg>`;
export const GEAR = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.4 7.4 0 0 0-1.7-1l-.4-2.7h-4l-.4 2.7a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.4L4.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.7h4l.4-2.7a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.4zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg>';
export const BACK = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
export const COIN = '<span class="coin" aria-hidden="true">$</span>';
export const UPGRADE_ICONS = {
  hull: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M6 26h36l-5 12H11z" fill="#8a5a2b" stroke="#2c1a0b" stroke-width="2"/><path d="M10 31h28" stroke="#2c1a0b" stroke-width="1.5"/><path d="M24 6v20" stroke="#2c1a0b" stroke-width="2.4"/><path d="M24 8l11 14H24z" fill="#efe3c6" stroke="#2c1a0b" stroke-width="1.6"/></svg>',
  cannons: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="8" y="18" width="28" height="11" rx="5" fill="#2f3338" stroke="#0e1012" stroke-width="2" transform="rotate(-14 22 24)"/><circle cx="17" cy="33" r="7" fill="#7a4e24" stroke="#2c1a0b" stroke-width="2"/><circle cx="41" cy="13" r="3" fill="#f5c45c"/><circle cx="44" cy="20" r="1.8" fill="#f5c45c" opacity=".7"/></svg>',
  sails: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M22 4v40" stroke="#2c1a0b" stroke-width="2.4"/><path d="M22 7c11 3 15 11 15 18-6-3-11-3-15-1z" fill="#efe3c6" stroke="#2c1a0b" stroke-width="1.6"/><path d="M22 27c8 2 11 6 12 11-5-2-8-2-12-1z" fill="#e3d4b0" stroke="#2c1a0b" stroke-width="1.6"/><path d="M8 18c3-2 6-2 9 0M6 26c3-2 6-2 9 0" stroke="#5aa0c8" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
};
