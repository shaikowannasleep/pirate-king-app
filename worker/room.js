import { DurableObject } from 'cloudflare:workers';
import { RoomCore, HOST_ID } from './logic.js';

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

// One Room per join code. Uses the WebSocket Hibernation API: per-socket state lives in attachments,
// room metadata in storage, so the object can be evicted from memory while idle.
export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = new RoomCore(null);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.ctx.blockConcurrencyWhile(async () => { this.core.meta = (await this.ctx.storage.get('meta')) || null; });
  }

  _save() { return this.ctx.storage.put('meta', this.core.meta); }
  _conn(ws) {
    const a = ws.deserializeAttachment();
    if (!a) return null;
    return { ws, peerId: a.peerId, role: a.role, name: a.name, send: (o) => { try { ws.send(JSON.stringify(o)); } catch {} }, close: (c, r) => { try { ws.close(c, r); } catch {} } };
  }
  _conns(except) { return this.ctx.getWebSockets().filter((w) => w !== except).map((w) => this._conn(w)).filter(Boolean); }
  async _arm(now = Date.now()) {
    const { at } = this.core.schedule(now);
    if (at == null) await this.ctx.storage.deleteAlarm(); else await this.ctx.storage.setAlarm(at);
  }

  async fetch(request) {
    const url = new URL(request.url), now = Date.now();
    if (url.pathname === '/init') {
      const { hostToken } = await request.json();
      if (!this.core.init(hostToken, now)) return json({ error: 'exists' }, 409);
      await this._save(); await this._arm(now);
      return json({ ok: true }, 201);
    }
    if (url.pathname === '/info') {
      if (!this.core.exists) return json({ error: 'not_found' }, 404);
      const info = this.core.info(this._conns());
      return info.open ? json(info) : json({ error: 'closed' }, 404);
    }
    if (url.pathname === '/ws') {
      const role = url.searchParams.get('role') || 'client';
      const conns = this._conns();
      const adm = this.core.admit({ role, token: url.searchParams.get('token'), name: url.searchParams.get('name') }, conns);
      if (!adm.ok && adm.status) return json({ error: adm.reason }, adm.status);
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      if (!adm.ok) { // upgrade, report the reason in a frame, close
        server.accept(); server.send(JSON.stringify({ t: 'error', reason: adm.reason })); server.close(1008, adm.reason);
        return new Response(null, { status: 101, webSocket: client });
      }
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ peerId: adm.peerId, role: adm.role, name: adm.name });
      const me = this._conn(server);
      this.core.onJoin(me, this._conns(), now);
      await this._save(); await this._arm(now);
      return new Response(null, { status: 101, webSocket: client });
    }
    return json({ error: 'not_found' }, 404);
  }

  webSocketMessage(ws, message) {
    const me = this._conn(ws);
    if (!me) return;
    this.core.onMessage(me, message, this._conns());
  }

  async _gone(ws) {
    const me = this._conn(ws);
    if (!me || !this.core.meta) return;
    try { ws.close(1000, 'bye'); } catch {}
    const now = Date.now();
    ws.serializeAttachment(null);
    this.core.onLeave(me, this._conns(ws), now);
    await this._save(); await this._arm(now);
  }
  async webSocketClose(ws) { await this._gone(ws); }
  async webSocketError(ws) { await this._gone(ws); }

  async alarm() {
    const now = Date.now();
    const { due } = this.core.schedule(now);
    if (due.includes('expire')) {
      for (const w of this.ctx.getWebSockets()) { try { w.send(JSON.stringify({ t: 'closed', reason: 'expired' })); w.close(1000, 'expired'); } catch {} }
      this.core.meta = null;
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return;
    }
    if (due.includes('dropClients')) {
      for (const w of this.ctx.getWebSockets()) { const c = this._conn(w); if (c && c.role === 'client') c.close(1000, 'host_left'); }
    }
    await this._arm(now);
  }
}
export { HOST_ID };
