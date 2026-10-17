import { route, isCode, randomToken, allocateRoom, corsHeaders, RateLimiter, STUN_ONLY } from './logic.js';
export { Room } from './room.js';

// Failed-lookup limiter. In-memory per isolate (best effort): a Durable Object limiter would be exact but
// costs one DO request per lookup against the Free plan's 100k/day. 6-digit codes + 10/min/isolate is enough friction.
const limiter = new RateLimiter({ limit: 10, windowMs: 60_000 });
let turnCache = null; // {at, body}
const TURN_CACHE_MS = 10 * 60_000;

const J = (o, status, extra = {}) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });

async function turn(env) {
  const now = Date.now();
  if (turnCache && now - turnCache.at < TURN_CACHE_MS) return turnCache.body;
  let body = STUN_ONLY;
  if (env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) {
    try {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
        method: 'POST', headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 86400 }),
      });
      if (r.ok) { const j = await r.json(); if (Array.isArray(j.iceServers)) body = { iceServers: j.iceServers }; }
    } catch {}
  }
  if (body !== STUN_ONLY) turnCache = { at: now, body }; // don't cache the fallback, retry next time
  return body;
}

async function version(env, request) {
  try { const r = await env.ASSETS.fetch(new Request(new URL('/version.json', request.url))); if (r.ok) return (await r.json()).version || 'unknown'; } catch {}
  return 'unknown';
}

async function api(request, env, r) {
  const url = new URL(request.url), ip = request.headers.get('CF-Connecting-IP') || 'unknown', stub = (code) => env.ROOMS.getByName(code);
  const cors = corsHeaders(request.headers.get('Origin'), request.url);
  if (r.name === 'health') return J({ ok: true, version: await version(env, request) }, 200, cors);
  if (r.name === 'turn') return J(await turn(env), 200, { ...cors, 'Cache-Control': 'private, max-age=300' });
  if (r.name === 'createRoom') {
    if (request.method !== 'POST') return J({ error: 'method_not_allowed' }, 405, { ...cors, Allow: 'POST, OPTIONS' });
    const hostToken = randomToken();
    const code = await allocateRoom(async (c) => (await stub(c).fetch('https://room/init', { method: 'POST', body: JSON.stringify({ hostToken }) })).status === 201);
    if (!code) return J({ error: 'no_code_available' }, 503, cors);
    return J({ code, hostToken }, 201, cors);
  }
  if (r.name === 'room') {
    if (request.method !== 'GET') return J({ error: 'method_not_allowed' }, 405, { ...cors, Allow: 'GET, OPTIONS' });
    if (limiter.blocked(ip)) return J({ error: 'rate_limited' }, 429, { ...cors, 'Retry-After': '60' });
    if (!isCode(r.code)) { limiter.fail(ip); return J({ error: 'not_found' }, 404, cors); }
    const res = await stub(r.code).fetch('https://room/info');
    if (res.status !== 200) { limiter.fail(ip); return J({ error: 'not_found' }, 404, cors); }
    return J(await res.json(), 200, cors);
  }
  if (r.name === 'ws') {
    if (request.headers.get('Upgrade') !== 'websocket') return J({ error: 'upgrade_required' }, 426, cors);
    if (limiter.blocked(ip)) return J({ error: 'rate_limited' }, 429, { ...cors, 'Retry-After': '60' });
    if (!isCode(r.code)) { limiter.fail(ip); return J({ error: 'not_found' }, 404, cors); }
    const res = await stub(r.code).fetch(`https://room/ws${url.search}`, { headers: request.headers });
    if (res.status === 404 || res.status === 403) limiter.fail(ip);
    return res;
  }
  return J({ error: 'not_found' }, 404, cors);
}

export default {
  async fetch(request, env) {
    const r = route(request.method, new URL(request.url).pathname);
    if (r.name === 'asset') return env.ASSETS.fetch(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('Origin'), request.url) });
    return api(request, env, r);
  },
};
