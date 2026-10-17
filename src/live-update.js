// Live update: when served over http(s) (GitHub Pages), poll version.json and pick up a new deploy.
// On the title/chart screens the page reloads by itself; mid-battle it shows a toast instead.
export function startLiveUpdate(getScreen, { interval = 20000 } = {}) {
  const current = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';
  if (!/^https?:$/.test(location.protocol) || !current) return;
  let shown = false;
  const check = async () => {
    try {
      const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const { version } = await res.json();
      if (!version || version === current) return;
      if (['title', 'map', 'shop'].includes(getScreen())) { location.reload(); return; }
      if (shown) return;
      shown = true;
      const t = document.createElement('button');
      t.className = 'live-toast'; t.textContent = 'New version ready. Tap to reload';
      t.onclick = () => location.reload();
      document.body.append(t);
    } catch {}
  };
  setInterval(check, interval);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
}
