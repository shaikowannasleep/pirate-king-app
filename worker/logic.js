// Pure logic for the signaling Worker. No `cloudflare:workers` imports, so `node --test` can run it.

export const MAX_PEERS = 8;            // including the host
export const MAX_FRAME_BYTES = 64 * 1024;
export const HOST_GRACE_MS = 30_000;   // host may come back this long before clients are dropped
export const HOST_GONE_TTL_MS = 10 * 60_000;
export const ROOM_MAX_AGE_MS = 4 * 60 * 60_000;
export const HOST_ID = 'p0';

export const ALLOWED_ORIGINS = ['https://shaikowannasleep.github.io'];
export const STUN_ONLY = { iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }] };

// ---------- codes ----------
export function randomCode(getRandomValues = (a) => crypto.getRandomValues(a)) {
  const a = new Uint32Array(1);
  const limit = 4294967296 - (4294967296 % 1000000); // rejection sampling: no modulo bias
  do getRandomValues(a); while (a[0] >= limit);
  return String(a[0] % 1000000).padStart(6, '0');
}
export const isCode = (s) => typeof s === 'string' && /^\d{6}$/.test(s);
export function randomToken(getRandomValues = (a) => crypto.getRandomValues(a)) {
  const a = new Uint8Array(24); getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// tryInit(code) -> true when the room was free and is now created.
export async function allocateRoom(tryInit, { gen = randomCode, attempts = 12 } = {}) {
  for (let i = 0; i < attempts; i++) { const code = gen(); if (await tryInit(code)) return code; }
  return null;
}

// ---------- routing ----------
export function route(method, pathname) {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/api/health') return { name: 'health' };
  if (p === '/api/turn') return { name: 'turn' };
  if (p === '/api/rooms') return { name: 'createRoom' };
  let m = /^\/api\/rooms\/([^/]+)\/ws$/.exec(p);
  if (m) return { name: 'ws', code: m[1] };
  m = /^\/api\/rooms\/([^/]+)$/.exec(p);
  if (m) return { name: 'room', code: m[1] };
  if (p.startsWith('/api/') || p === '/api') return { name: 'notFound' };
  return { name: 'asset' };
}

// ---------- CORS ----------
export function allowedOrigin(origin, requestUrl) {
  if (!origin) return null;
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return origin;
  try { if (origin === new URL(requestUrl).origin) return origin; } catch {}
  return null;
}
export function corsHeaders(origin, requestUrl) {
  const o = allowedOrigin(origin, requestUrl);
  const h = { Vary: 'Origin' };
  if (o) { h['Access-Control-Allow-Origin'] = o; h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'; h['Access-Control-Allow-Headers'] = 'Content-Type'; h['Access-Control-Max-Age'] = '86400'; }
  return h;
}

// ---------- rate limiter (failed lookups per key per window) ----------
export class RateLimiter {
  constructor({ limit = 10, windowMs = 60_000, maxKeys = 5000 } = {}) { this.limit = limit; this.windowMs = windowMs; this.maxKeys = maxKeys; this.hits = new Map(); }
  _prune(key, now) {
    const arr = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (arr.length) this.hits.set(key, arr); else this.hits.delete(key);
    return arr;
  }
  blocked(key, now = Date.now()) { return this._prune(key, now).length >= this.limit; }
  fail(key, now = Date.now()) {
    const arr = this._prune(key, now); arr.push(now); this.hits.set(key, arr);
    if (this.hits.size > this.maxKeys) for (const k of this.hits.keys()) { this._prune(k, now); if (this.hits.size <= this.maxKeys / 2) break; }
  }
}

// ---------- frames ----------
const b64re = /^[A-Za-z0-9+/]*={0,2}$/;
// Returns {ok:true, msg} or {ok:false, reason}.
export function parseFrame(raw) {
  if (typeof raw !== 'string') return { ok: false, reason: 'binary_unsupported' };
  if (raw.length > MAX_FRAME_BYTES || new TextEncoder().encode(raw).length > MAX_FRAME_BYTES) return { ok: false, reason: 'too_large' };
  let msg; try { msg = JSON.parse(raw); } catch { return { ok: false, reason: 'bad_json' }; }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return { ok: false, reason: 'bad_frame' };
  if (msg.t === 'signal') {
    if (typeof msg.to !== 'string' || msg.to.length > 32 || msg.data === undefined) return { ok: false, reason: 'bad_signal' };
    return { ok: true, msg: { t: 'signal', to: msg.to, data: msg.data } };
  }
  if (msg.t === 'relay') {
    if (typeof msg.to !== 'string' || msg.to.length > 32) return { ok: false, reason: 'bad_relay' };
    if (msg.ch !== 'reliable' && msg.ch !== 'fast') return { ok: false, reason: 'bad_channel' };
    if (typeof msg.b64 !== 'string' || !b64re.test(msg.b64)) return { ok: false, reason: 'bad_payload' };
    return { ok: true, msg: { t: 'relay', to: msg.to, ch: msg.ch, b64: msg.b64 } };
  }
  return { ok: false, reason: 'unknown_type' };
}
export function cleanName(n) {
  const s = typeof n === 'string' ? n.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) : '';
  return s || 'Pirate';
}

// ---------- room state machine ----------
// meta: {hostToken, createdAt, hostGoneAt: number|null, nextId, closed}
// conn: {peerId, role, name, send(obj), close(code, reason)}   (the DO wraps real sockets into this)
export class RoomCore {
  constructor(meta = null) { this.meta = meta; }
  get exists() { return !!this.meta && !this.meta.closed; }
  init(hostToken, now) {
    if (this.meta) return false;
    this.meta = { hostToken, createdAt: now, hostGoneAt: now, nextId: 1, closed: false };
    return true;
  }
  isOpen(conns) { return this.exists && conns.some((c) => c.role === 'host'); }
  info(conns) { return { open: this.isOpen(conns), players: conns.length }; }

  // Returns {ok:true, conn-info} or {ok:false, status, reason}. Caller attaches `peerId/role/name` to the socket.
  // `status` is the HTTP status to use *before* upgrade; 0 means "upgrade, then send error frame".
  admit({ role, token, name }, conns) {
    if (!this.exists) return { ok: false, status: 404, reason: 'not_found' };
    if (role === 'host') {
      if (token !== this.meta.hostToken) return { ok: false, status: 403, reason: 'bad_token' };
      if (conns.some((c) => c.role === 'host')) return { ok: false, status: 0, reason: 'host_connected' };
      return { ok: true, peerId: HOST_ID, role: 'host', name: cleanName(name || 'Host') };
    }
    if (role !== 'client') return { ok: false, status: 400, reason: 'bad_role' };
    if (!this.isOpen(conns)) return { ok: false, status: 404, reason: 'closed' };
    if (conns.length >= MAX_PEERS) return { ok: false, status: 0, reason: 'full' };
    const peerId = 'p' + this.meta.nextId++;
    return { ok: true, peerId, role: 'client', name: cleanName(name) };
  }

  // Called after the socket for `me` was accepted and is part of `conns`.
  onJoin(me, conns, now) {
    const others = conns.filter((c) => c.peerId !== me.peerId);
    me.send({ t: 'welcome', peerId: me.peerId, hostId: HOST_ID });
    if (me.role === 'host') {
      this.meta.hostGoneAt = null;
      for (const c of others) { me.send({ t: 'peer', type: 'join', peerId: c.peerId, name: c.name }); c.send({ t: 'peer', type: 'join', peerId: HOST_ID, name: me.name }); }
    } else {
      const host = others.find((c) => c.role === 'host');
      me.send({ t: 'peer', type: 'join', peerId: HOST_ID, name: host ? host.name : 'Host' });
      for (const c of others) c.send({ t: 'peer', type: 'join', peerId: me.peerId, name: me.name });
    }
  }

  // `conns` must already exclude the departed `me`.
  onLeave(me, conns, now) {
    if (me.role === 'host') {
      this.meta.hostGoneAt = now;
      for (const c of conns) c.send({ t: 'closed', reason: 'host_left' });
    } else {
      for (const c of conns) c.send({ t: 'peer', type: 'leave', peerId: me.peerId, name: me.name });
    }
  }

  onMessage(me, raw, conns) {
    const p = parseFrame(raw);
    if (!p.ok) { me.send({ t: 'error', reason: p.reason }); return false; }
    const m = p.msg, byId = (id) => conns.find((c) => c.peerId === id);
    if (m.t === 'signal') {
      const target = byId(m.to);
      const legal = target && target.peerId !== me.peerId && (me.role === 'host' ? target.role === 'client' : target.role === 'host');
      if (!legal) { me.send({ t: 'error', reason: 'bad_target' }); return false; }
      target.send({ t: 'signal', from: me.peerId, data: m.data }); return true;
    }
    // relay
    let targets;
    if (me.role === 'client') {
      if (m.to !== '*' && m.to !== HOST_ID) { me.send({ t: 'error', reason: 'bad_target' }); return false; }
      targets = conns.filter((c) => c.role === 'host');
    } else if (m.to === '*') targets = conns.filter((c) => c.peerId !== me.peerId);
    else { const t = byId(m.to); targets = t && t.peerId !== me.peerId ? [t] : []; if (!t) { me.send({ t: 'error', reason: 'bad_target' }); return false; } }
    for (const t of targets) t.send({ t: 'relay', from: me.peerId, ch: m.ch, b64: m.b64 });
    return true;
  }

  // Timers. Returns {alarmAt|null, actions}. Caller performs actions: 'dropClients', 'expire'.
  schedule(now) {
    const m = this.meta;
    if (!m || m.closed) return { at: null, due: [] };
    const events = [{ at: m.createdAt + ROOM_MAX_AGE_MS, act: 'expire' }];
    if (m.hostGoneAt != null) {
      events.push({ at: m.hostGoneAt + HOST_GRACE_MS, act: 'dropClients' }, { at: m.hostGoneAt + HOST_GONE_TTL_MS, act: 'expire' });
    }
    const due = events.filter((e) => e.at <= now).map((e) => e.act);
    const future = events.filter((e) => e.at > now).map((e) => e.at);
    return { at: future.length ? Math.min(...future) : null, due: [...new Set(due)] };
  }
}
