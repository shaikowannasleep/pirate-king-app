import test from 'node:test';
import assert from 'node:assert/strict';
import { randomCode, allocateRoom, isCode, route, corsHeaders, allowedOrigin, RateLimiter, parseFrame, RoomCore, MAX_PEERS, HOST_ID, HOST_GRACE_MS, HOST_GONE_TTL_MS, ROOM_MAX_AGE_MS, MAX_FRAME_BYTES } from '../worker/logic.js';

// ---- fake room harness ----
function makeRoom() {
  const core = new RoomCore(); core.init('tok', 0);
  const conns = [];
  const join = (opts, now = 0) => {
    const adm = core.admit(opts, conns);
    if (!adm.ok) return { adm };
    const c = { peerId: adm.peerId, role: adm.role, name: adm.name, got: [], send(o) { this.got.push(o); }, close(code) { this.closed = code; } };
    conns.push(c);
    // like the DO, hand the core a fresh wrapper object sharing state (identity must not matter)
    const wrap = { ...c, send: (o) => c.send(o), close: (x) => c.close(x) };
    core.onJoin(wrap, conns, now); return { adm, c };
  };
  const leave = (c, now = 0) => { conns.splice(conns.indexOf(c), 1); core.onLeave(c, conns, now); };
  return { core, conns, join, leave };
}
const frame = (o) => JSON.stringify(o);

test('codes: 6 digits, padded, unbiased range', () => {
  for (let i = 0; i < 200; i++) assert.ok(isCode(randomCode()));
  assert.equal(randomCode((a) => { a[0] = 42; }), '000042');
  let n = 0; assert.equal(randomCode((a) => { a[0] = n++ ? 7 : 4294967295; }), '000007', 'values in the biased tail are rejected');
  assert.ok(!isCode('12345') && !isCode('1234567') && !isCode('abcdef') && !isCode(123456));
});
test('allocateRoom retries on collision and gives up', async () => {
  const seq = ['111111', '111111', '222222']; let i = 0; const used = new Set(['111111']);
  const code = await allocateRoom(async (c) => !used.has(c) && used.add(c), { gen: () => seq[i++] });
  assert.equal(code, '222222'); assert.equal(i, 3);
  assert.equal(await allocateRoom(async () => false, { gen: () => '1', attempts: 3 }), null);
});
test('routing', () => {
  assert.deepEqual(route('GET', '/api/health'), { name: 'health' });
  assert.deepEqual(route('GET', '/api/rooms'), { name: 'createRoom' });
  assert.deepEqual(route('GET', '/api/rooms/123456'), { name: 'room', code: '123456' });
  assert.deepEqual(route('GET', '/api/rooms/123456/ws'), { name: 'ws', code: '123456' });
  assert.deepEqual(route('GET', '/api/turn/'), { name: 'turn' });
  assert.equal(route('GET', '/api/nope').name, 'notFound');
  assert.equal(route('GET', '/').name, 'asset');
  assert.equal(route('GET', '/pirate-king.html').name, 'asset');
});
test('cors', () => {
  const u = 'https://pirate-king-app.x.workers.dev/api/health';
  assert.equal(allowedOrigin('https://shaikowannasleep.github.io', u), 'https://shaikowannasleep.github.io');
  assert.equal(allowedOrigin('http://localhost:5173', u), 'http://localhost:5173');
  assert.equal(allowedOrigin('http://localhost', u), 'http://localhost');
  assert.equal(allowedOrigin('https://pirate-king-app.x.workers.dev', u), 'https://pirate-king-app.x.workers.dev');
  assert.equal(allowedOrigin('https://evil.example', u), null);
  assert.equal(allowedOrigin('http://localhost.evil.com', u), null);
  assert.equal(corsHeaders('https://evil.example', u)['Access-Control-Allow-Origin'], undefined);
  assert.equal(corsHeaders(null, u)['Access-Control-Allow-Origin'], undefined);
});
test('rate limiter: 10 failures/minute then blocked, per key, window slides', () => {
  const rl = new RateLimiter({ limit: 10, windowMs: 60000 });
  for (let i = 0; i < 9; i++) rl.fail('a', 1000 + i);
  assert.ok(!rl.blocked('a', 2000)); rl.fail('a', 2000);
  assert.ok(rl.blocked('a', 3000)); assert.ok(!rl.blocked('b', 3000));
  assert.ok(!rl.blocked('a', 61100 + 1000)); // all but the last aged out
});
test('frame validation', () => {
  assert.ok(parseFrame(frame({ t: 'signal', to: 'p1', data: { sdp: 'x' } })).ok);
  assert.ok(parseFrame(frame({ t: 'relay', to: '*', ch: 'fast', b64: 'AAEC' })).ok);
  for (const bad of [new ArrayBuffer(2), 'nope', '[]', frame({ t: 'x' }), frame({ t: 'signal', data: 1 }), frame({ t: 'relay', to: '*', ch: 'weird', b64: 'AA' }), frame({ t: 'relay', to: '*', ch: 'fast', b64: '!!' })])
    assert.equal(parseFrame(bad).ok, false);
  assert.equal(parseFrame('x'.repeat(MAX_FRAME_BYTES + 1)).reason, 'too_large');
});

test('host auth and welcome', () => {
  const r = makeRoom();
  assert.equal(r.join({ role: 'host', token: 'bad' }).adm.status, 403);
  assert.equal(r.join({ role: 'client', name: 'x' }).adm.status, 404, 'no clients before host');
  const { c: host } = r.join({ role: 'host', token: 'tok', name: 'Cap' });
  assert.deepEqual(host.got, [{ t: 'welcome', peerId: HOST_ID, hostId: HOST_ID }], 'no self peer-join');
  assert.equal(r.join({ role: 'host', token: 'tok' }).adm.reason, 'host_connected');
  assert.deepEqual(r.core.info(r.conns), { open: true, players: 1 });
});
test('clients join, host is notified, leave is broadcast', () => {
  const r = makeRoom();
  const { c: host } = r.join({ role: 'host', token: 'tok' });
  const { c: a } = r.join({ role: 'client', name: 'Ann' });
  assert.equal(a.peerId, 'p1');
  assert.deepEqual(host.got.at(-1), { t: 'peer', type: 'join', peerId: 'p1', name: 'Ann' });
  assert.equal(a.got[0].t, 'welcome');
  const { c: b } = r.join({ role: 'client', name: 'Bob' });
  assert.equal(a.got.at(-1).peerId, 'p2');
  r.leave(a);
  assert.deepEqual(host.got.at(-1), { t: 'peer', type: 'leave', peerId: 'p1', name: 'Ann' });
  assert.equal(b.got.at(-1).type, 'leave');
});
test('full room at 8 peers incl. host', () => {
  const r = makeRoom(); r.join({ role: 'host', token: 'tok' });
  for (let i = 1; i < MAX_PEERS; i++) assert.ok(r.join({ role: 'client' }).adm.ok);
  const res = r.join({ role: 'client' }).adm;
  assert.deepEqual([res.ok, res.reason, res.status], [false, 'full', 0]);
});
test('signal forwarding is host<->client only', () => {
  const r = makeRoom();
  const { c: host } = r.join({ role: 'host', token: 'tok' });
  const { c: a } = r.join({ role: 'client' }); const { c: b } = r.join({ role: 'client' });
  assert.ok(r.core.onMessage(a, frame({ t: 'signal', to: 'p0', data: 'offer' }), r.conns));
  assert.deepEqual(host.got.at(-1), { t: 'signal', from: 'p1', data: 'offer' });
  assert.ok(r.core.onMessage(host, frame({ t: 'signal', to: 'p2', data: 'answer' }), r.conns));
  assert.deepEqual(b.got.at(-1), { t: 'signal', from: 'p0', data: 'answer' });
  const before = b.got.length;
  assert.ok(!r.core.onMessage(a, frame({ t: 'signal', to: 'p2', data: 'x' }), r.conns)); // client->client
  assert.deepEqual(a.got.at(-1), { t: 'error', reason: 'bad_target' }); assert.equal(b.got.length, before);
  assert.ok(!r.core.onMessage(host, frame({ t: 'signal', to: 'p9', data: 'x' }), r.conns));
});
test('relay: client->host only, host->peer or broadcast', () => {
  const r = makeRoom();
  const { c: host } = r.join({ role: 'host', token: 'tok' });
  const { c: a } = r.join({ role: 'client' }); const { c: b } = r.join({ role: 'client' });
  r.core.onMessage(a, frame({ t: 'relay', to: '*', ch: 'fast', b64: 'AQ==' }), r.conns);
  assert.deepEqual(host.got.at(-1), { t: 'relay', from: 'p1', ch: 'fast', b64: 'AQ==' });
  assert.ok(!r.core.onMessage(a, frame({ t: 'relay', to: 'p2', ch: 'fast', b64: 'AQ==' }), r.conns));
  r.core.onMessage(host, frame({ t: 'relay', to: '*', ch: 'reliable', b64: 'Ag==' }), r.conns);
  assert.equal(a.got.at(-1).b64, 'Ag=='); assert.equal(b.got.at(-1).b64, 'Ag==');
  const n = host.got.length; assert.equal(host.got.at(-1).t, 'relay');
  r.core.onMessage(host, frame({ t: 'relay', to: 'p2', ch: 'reliable', b64: 'Aw==' }), r.conns);
  assert.equal(b.got.at(-1).b64, 'Aw=='); assert.notEqual(a.got.at(-1).b64, 'Aw=='); assert.equal(host.got.length, n);
});
test('invalid frames get an error reply and are not forwarded', () => {
  const r = makeRoom(); const { c: host } = r.join({ role: 'host', token: 'tok' }); const { c: a } = r.join({ role: 'client' });
  const n = host.got.length;
  r.core.onMessage(a, 'garbage', r.conns); assert.deepEqual(a.got.at(-1), { t: 'error', reason: 'bad_json' });
  r.core.onMessage(a, 'x'.repeat(MAX_FRAME_BYTES + 5), r.conns); assert.equal(a.got.at(-1).reason, 'too_large');
  assert.equal(host.got.length, n);
});
test('host leaves: clients told, host can return within grace, clients dropped after', () => {
  const r = makeRoom();
  const { c: host } = r.join({ role: 'host', token: 'tok' }, 0);
  const { c: a } = r.join({ role: 'client', name: 'Ann' }, 0);
  r.leave(host, 1000);
  assert.deepEqual(a.got.at(-1), { t: 'closed', reason: 'host_left' });
  assert.equal(r.core.isOpen(r.conns), false);
  assert.equal(r.join({ role: 'client' }, 2000).adm.status, 404, 'new clients refused while host away');
  let s = r.core.schedule(2000); assert.equal(s.at, 1000 + HOST_GRACE_MS); assert.deepEqual(s.due, []);
  const { c: host2 } = r.join({ role: 'host', token: 'tok' }, 5000);
  assert.equal(r.core.meta.hostGoneAt, null);
  assert.deepEqual(host2.got.at(-1), { t: 'peer', type: 'join', peerId: 'p1', name: 'Ann' });
  assert.equal(a.got.at(-1).peerId, 'p0');
  r.leave(host2, 10000);
  s = r.core.schedule(10000 + HOST_GRACE_MS); assert.deepEqual(s.due, ['dropClients']); assert.equal(s.at, 10000 + HOST_GONE_TTL_MS);
  s = r.core.schedule(10000 + HOST_GONE_TTL_MS); assert.deepEqual(s.due.sort(), ['dropClients', 'expire']);
});
test('expiry: 4 h hard cap even with host connected; unused room expires after 10 min', () => {
  const r = makeRoom(); r.join({ role: 'host', token: 'tok' }, 0);
  let s = r.core.schedule(1000); assert.equal(s.at, ROOM_MAX_AGE_MS);
  assert.deepEqual(r.core.schedule(ROOM_MAX_AGE_MS).due, ['expire']);
  const fresh = new RoomCore(); fresh.init('t', 0);
  assert.equal(fresh.schedule(1).at, HOST_GRACE_MS);
  assert.deepEqual(fresh.schedule(HOST_GONE_TTL_MS).due.includes('expire'), true);
});
test('init is exclusive', () => { const c = new RoomCore(); assert.ok(c.init('a', 0)); assert.ok(!c.init('b', 0)); });
