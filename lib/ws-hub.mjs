// WebSocket-Relay für den eigenen Server (server.mjs). Gleiche Aufgabe wie das HTTP-Relay
// (relay-core.mjs), aber über eine dauerhaft offene Verbindung: Nachrichten gehen sofort weiter,
// ohne Long-Polling und ohne Datenbank. Der Browser des Hosts bleibt die einzige Datenquelle;
// der Server leitet nur weiter:
//   Host    → Spieler  { op: 'send', msgs: [{ to: <id>|null, body }] }   (null = an alle)
//   Spieler → Host     { op: 'send', msgs: [{ body }] }                   (Absender = eigene ID)
// Server → Browser:
//   { t: 'ok', op, ... }                 Antwort auf host/join
//   { t: 'msgs', msgs: [{ peer?, body }] } weitergeleitete Nachrichten
//   { t: 'host', online }                Host da / weg (nur an Spieler)
//   { t: 'ka', host? }                   Lebenszeichen alle KEEPALIVE_MS
//   { t: 'error', status, error, retryAfter? }
//
// Gleiche Regeln wie im HTTP-Relay: Raum- und ID-Format, Spielleiter-Passwort mit Sperre pro IP,
// Verbindungs-ID nur mit passendem Schlüssel (ID = Hash des Schlüssels), Größen- und Raten-Limits.
// Die Logik kennt keine echte Netzwerk-Bibliothek: Ein „Socket“ braucht nur send(text), close(code, grund)
// und die Aufrufe hub.message(socket, text) / hub.closed(socket). Das macht sie ohne Netzwerk testbar.

import { anyPasswordOk } from './host-auth.mjs';
import { connIdFor } from './relay-core.mjs';
import { clientKey, guardedCheck, rateLimiter } from './throttle.mjs';

export const WS_LIMITS = {
  maxFrameBytes: 3_500_000,   // Host-Nachrichten mit Clips können groß sein
  maxPlayerFrameBytes: 32_000, // Spieler schicken nur Kleines (Antwort, Buzz, Herzschlag)
  maxHelloBytes: 4_000,        // erste Nachricht (host/join) ist winzig
  maxMsgsPerFrame: 100,
  helloTimeoutMs: 10_000,      // so lange darf eine neue Verbindung schweigen
  playerMsgsPerMin: 600,
  ipMsgsPerMin: 3000,
  newRoomsPerHour: 30,
  maxConnsPerIp: 60,           // Uni-WLAN: viele Spieler hinter einer IP
  maxConns: 3000,
  keepaliveMs: 10_000,
  hostTakeoverMs: 60_000,      // ein fremder Token darf den Raum erst nach dieser Pause übernehmen
  // Kurze Funklöcher überbrücken: Nachrichten für ein gerade getrenntes Gerät warten so lange
  // (wie beim HTTP-Relay, das Nachrichten speichert), danach gilt das Gerät als weg.
  bufferMs: 60_000,
  bufferMaxMsgs: 300,
  bufferMaxBytes: 4_000_000,
  roomTtlMs: 2 * 24 * 3600_000,
  failDelayMs: 800,
};

const ROOM_RE = /^[A-Z0-9]{4,12}$/;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const KEY_RE = /^[A-Za-z0-9_-]{24,64}$/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (sock, obj) => { try { sock.send(JSON.stringify(obj)); } catch (e) { /* Verbindung weg */ } };

/**
 * @param {{ gamePassword?: string, hostPassword?: string, throttle?: object, rate?: Function, now?: Function }} opts
 */
export function createHub(opts = {}) {
  const now = opts.now || (() => Date.now());
  const rate = opts.rate || rateLimiter({ now });
  const rooms = new Map();   // room -> { token, host, hostSeen, players: Map(id -> socket) }
  const conns = new Map();   // socket -> { headers, ipKey, role, room, id, helloTimer }
  const perIp = new Map();   // ipKey -> Anzahl offener Verbindungen

  function fail(sock, status, error, retryAfter, close = false) {
    send(sock, { t: 'error', status, error, ...(retryAfter ? { retryAfter } : {}) });
    if (close) { try { sock.close(4000 + Math.min(status, 999), error); } catch (e) {} }
  }

  async function open(sock, headers) {
    const ipKey = await clientKey('ws', headers);
    const n = perIp.get(ipKey) || 0;
    if (conns.size >= WS_LIMITS.maxConns || n >= WS_LIMITS.maxConnsPerIp) {
      fail(sock, 429, 'too many connections', 30, true);
      return false;
    }
    perIp.set(ipKey, n + 1);
    const c = { headers, ipKey, role: null, room: null, id: null };
    c.helloTimer = setTimeout(() => { if (!c.role) fail(sock, 408, 'hello timeout', 0, true); }, WS_LIMITS.helloTimeoutMs);
    c.helloTimer.unref?.();
    conns.set(sock, c);
    return true;
  }

  function closed(sock) {
    const c = conns.get(sock);
    if (!c) return;
    conns.delete(sock);
    clearTimeout(c.helloTimer);
    const n = (perIp.get(c.ipKey) || 1) - 1;
    if (n > 0) perIp.set(c.ipKey, n); else perIp.delete(c.ipKey);
    const r = c.room && rooms.get(c.room);
    if (!r) return;
    if (c.role === 'host' && r.host === sock) {
      r.host = null;
      r.hostSeen = now();
      r.players.forEach((p) => send(p, { t: 'host', online: false }));
    } else if (c.role === 'player' && r.players.get(c.id) === sock) {
      r.players.delete(c.id);
      if (r.known.has(c.id)) r.known.set(c.id, now()); // ab jetzt läuft die Wartezeit
    }
  }

  async function onHost(sock, c, p) {
    const room = typeof p.room === 'string' ? p.room.trim().toUpperCase() : '';
    if (!ROOM_RE.test(room)) return fail(sock, 400, 'invalid room', 0, true);
    if (typeof p.token !== 'string' || !ID_RE.test(p.token)) return fail(sock, 400, 'invalid token', 0, true);
    if (opts.gamePassword) {
      const auth = await guardedCheck(opts.throttle, await clientKey('game', c.headers),
        () => anyPasswordOk(typeof p.pw === 'string' ? p.pw : '', opts.gamePassword, opts.hostPassword));
      if (auth.status === 429) return fail(sock, 429, 'too many attempts', auth.retryAfter, true);
      if (!auth.ok) {
        if (WS_LIMITS.failDelayMs) await sleep(WS_LIMITS.failDelayMs);
        return fail(sock, 401, 'game password required', 0, true);
      }
    }
    if (!conns.has(sock)) return; // in der Wartezeit getrennt
    let r = rooms.get(room);
    if (!r) {
      if (!rate(await clientKey('room', c.headers), WS_LIMITS.newRoomsPerHour, 3600_000)) {
        return fail(sock, 429, 'slow down', 60, true);
      }
      r = { token: p.token, host: null, hostSeen: now(), players: new Map(), known: new Map(), buf: new Map(), hostBuf: newBuf() };
      rooms.set(room, r);
    } else if (r.token !== p.token) {
      const busy = r.host || now() - r.hostSeen < WS_LIMITS.hostTakeoverMs;
      if (busy) return fail(sock, 409, 'room taken', 0, true);
      r.token = p.token;
    }
    if (r.host && r.host !== sock) {
      const old = r.host;
      r.host = null;
      conns.get(old) && (conns.get(old).role = 'replaced');
      try { old.close(4009, 'replaced'); } catch (e) {}
    }
    r.host = sock;
    r.hostSeen = now();
    Object.assign(c, { role: 'host', room });
    clearTimeout(c.helloTimer);
    send(sock, { t: 'ok', op: 'host' });
    flush(sock, r.hostBuf); // Spieler-Nachrichten aus einem kurzen Funkloch des Hosts
    r.players.forEach((s) => send(s, { t: 'host', online: true }));
    cleanup();
  }

  async function onJoin(sock, c, p) {
    const room = typeof p.room === 'string' ? p.room.trim().toUpperCase() : '';
    if (!ROOM_RE.test(room)) return fail(sock, 400, 'invalid room', 0, true);
    if (typeof p.key !== 'string' || !KEY_RE.test(p.key)) return fail(sock, 403, 'invalid key', 0, true);
    const id = await connIdFor(p.key);
    if (!conns.has(sock)) return;
    const r = rooms.get(room);
    Object.assign(c, { role: 'player', room, id });
    clearTimeout(c.helloTimer);
    if (!r) return send(sock, { t: 'ok', op: 'join', id, host: false });
    const old = r.players.get(id);
    if (old && old !== sock) {
      conns.get(old) && (conns.get(old).role = 'replaced');
      try { old.close(4009, 'replaced'); } catch (e) {}
    }
    r.players.set(id, sock);
    r.known.set(id, now());
    send(sock, { t: 'ok', op: 'join', id, host: !!r.host });
    const waiting = r.buf.get(id);
    r.buf.delete(id);
    if (waiting) flush(sock, waiting);
  }

  function onSend(sock, c, p, bytes) {
    const list = Array.isArray(p.msgs) ? p.msgs : [];
    if (!list.length) return;
    if (list.length > WS_LIMITS.maxMsgsPerFrame) return fail(sock, 413, 'too many messages');
    const r = rooms.get(c.room);
    if (c.role === 'host') {
      if (!r || r.host !== sock) return fail(sock, 403, 'not the host', 0, true);
      r.hostSeen = now();
      const byTarget = new Map(); // socket -> [{ body }]
      const add = (s, body) => { if (!byTarget.has(s)) byTarget.set(s, []); byTarget.get(s).push({ body }); };
      // Gerade getrennte Geräte (Funkloch): Nachricht aufheben statt verlieren
      const deliver = (id, body) => {
        const s = r.players.get(id);
        if (s) return add(s, body);
        if (!r.known.has(id)) return;
        if (!r.buf.has(id)) r.buf.set(id, newBuf());
        keep(r.buf.get(id), { body });
      };
      for (const m of list) {
        if (!m || typeof m !== 'object') continue;
        const body = m.body ?? null;
        if (m.to == null) r.known.forEach((_, id) => deliver(id, body));
        else if (typeof m.to === 'string' && ID_RE.test(m.to)) deliver(m.to, body);
      }
      byTarget.forEach((msgs, s) => send(s, { t: 'msgs', msgs }));
      return;
    }
    // Spieler: nur kleine Nachrichten, mit Raten-Limits; Absender ist immer die eigene ID
    // Zu groß: verwerfen wie beim HTTP-Relay (413), die Verbindung bleibt bestehen
    if (bytes > WS_LIMITS.maxPlayerFrameBytes) return fail(sock, 413, 'frame too large');
    if (!rate(`conn:${c.room}:${c.id}`, WS_LIMITS.playerMsgsPerMin, 60_000, list.length)
      || !rate(`ip:${c.ipKey}`, WS_LIMITS.ipMsgsPerMin, 60_000, list.length)) {
      return fail(sock, 429, 'slow down', 10);
    }
    if (!r) return;
    const msgs = list.filter((m) => m && typeof m === 'object').map((m) => ({ peer: c.id, body: m.body ?? null }));
    // Abmeldung: Gerät gilt sofort als weg, keine Nachrichten mehr aufheben
    if (msgs.some((m) => m.body && m.body.t === 'close')) { r.known.delete(c.id); r.buf.delete(c.id); }
    if (!msgs.length) return;
    if (r.host) send(r.host, { t: 'msgs', msgs });
    else msgs.forEach((m) => keep(r.hostBuf, m)); // Host gerade weg (Funkloch): aufheben
  }

  async function message(sock, text) {
    const c = conns.get(sock);
    if (!c || c.role === 'replaced') return;
    const bytes = typeof text === 'string' ? Buffer.byteLength(text) : text.length;
    if (bytes > WS_LIMITS.maxFrameBytes || (!c.role && bytes > WS_LIMITS.maxHelloBytes)) {
      return fail(sock, 413, 'frame too large', 0, true);
    }
    let p;
    try { p = JSON.parse(String(text)); } catch (e) { return fail(sock, 400, 'invalid json', 0, true); }
    if (!p || typeof p !== 'object') return fail(sock, 400, 'invalid json', 0, true);
    try {
      if (!c.role) {
        if (p.op === 'host') return await onHost(sock, c, p);
        if (p.op === 'join') return await onJoin(sock, c, p);
        return fail(sock, 400, 'say hello first', 0, true);
      }
      if (p.op === 'send') return onSend(sock, c, p, bytes);
      fail(sock, 400, 'unknown op');
    } catch (e) {
      console.error('ws relay error', e);
      fail(sock, 500, 'internal error', 0, true);
    }
  }

  // Lebenszeichen: hält Proxys wach und lässt Browser tote Verbindungen erkennen
  function keepalive() {
    conns.forEach((c, sock) => {
      if (!c.role) return;
      const r = c.room && rooms.get(c.room);
      send(sock, c.role === 'player' ? { t: 'ka', host: !!(r && r.host) } : { t: 'ka' });
    });
  }

  function cleanup() {
    const t = now();
    for (const [name, r] of rooms) {
      if (!r.host && !r.players.size && t - r.hostSeen > WS_LIMITS.roomTtlMs) { rooms.delete(name); continue; }
      // Getrennte Geräte, die nicht wiederkommen, vergessen (samt aufgehobener Nachrichten)
      r.known.forEach((seen, id) => {
        if (!r.players.has(id) && t - seen > WS_LIMITS.bufferMs) { r.known.delete(id); r.buf.delete(id); }
      });
      if (r.hostBuf.items.length && t - r.hostBuf.since > WS_LIMITS.bufferMs) r.hostBuf = newBuf();
    }
  }

  // Zwischenspeicher für ein getrenntes Gerät: begrenzt nach Anzahl und Größe, die ältesten fallen weg
  function newBuf() { return { items: [], bytes: 0, since: now() }; }
  function keep(b, item) {
    if (!b.items.length) b.since = now();
    const size = JSON.stringify(item).length;
    b.items.push({ item, size });
    b.bytes += size;
    while (b.items.length > WS_LIMITS.bufferMaxMsgs || b.bytes > WS_LIMITS.bufferMaxBytes) b.bytes -= b.items.shift().size;
  }
  function flush(sock, b) {
    if (!b || !b.items.length) return;
    const fresh = now() - b.since <= WS_LIMITS.bufferMs;
    const items = b.items.splice(0);
    b.bytes = 0;
    if (fresh) send(sock, { t: 'msgs', msgs: items.map((x) => x.item) });
  }

  return { open, message, closed, keepalive, cleanup, _rooms: rooms, _conns: conns };
}
