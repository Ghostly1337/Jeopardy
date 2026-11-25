// WebSocket-Relay (lib/ws-hub.mjs) ohne Netzwerk: Sockets sind kleine Attrappen.
const test = require('node:test');
const assert = require('node:assert/strict');

let createHub, WS_LIMITS, connIdFor, memoryThrottle;
test.before(async () => {
  ({ createHub, WS_LIMITS } = await import('../../lib/ws-hub.mjs'));
  ({ connIdFor } = await import('../../lib/relay-core.mjs'));
  ({ memoryThrottle } = await import('../../lib/throttle.mjs'));
  WS_LIMITS.failDelayMs = 0;
});

const HOST_TOKEN = 'hosttoken-aaaaaaaa';
const K1 = 'player1-key-aaaaaaaaaaaaaaaaaaaaaaaa';
const K2 = 'player2-key-bbbbbbbbbbbbbbbbbbbbbbbb';

function fakeSocket(ip = '10.0.0.1') {
  const s = {
    out: [], closed: null, ip,
    send(text) { this.out.push(JSON.parse(text)); },
    close(code, reason) { this.closed = { code, reason }; },
    last() { return this.out[this.out.length - 1]; },
    of(t) { return this.out.filter((m) => m.t === t); },
  };
  return s;
}
const headers = (ip) => new Headers({ 'x-real-ip': ip });

async function connect(hub, ip = '10.0.0.1') {
  const s = fakeSocket(ip);
  assert.equal(await hub.open(s, headers(ip)), true);
  return s;
}
const say = (hub, s, obj) => hub.message(s, JSON.stringify(obj));

async function hostIn(hub, room = 'ABCD', opts = {}) {
  const h = await connect(hub, opts.ip);
  await say(hub, h, { op: 'host', room, token: opts.token || HOST_TOKEN, ...(opts.pw ? { pw: opts.pw } : {}) });
  return h;
}
async function playerIn(hub, key, room = 'ABCD', ip) {
  const p = await connect(hub, ip);
  await say(hub, p, { op: 'join', room, key });
  return p;
}

test('Host belegt einen Raum; Spieler tritt bei und bekommt seine ID', async () => {
  const hub = createHub();
  const h = await hostIn(hub);
  assert.deepEqual(h.last(), { t: 'ok', op: 'host' });
  const p = await playerIn(hub, K1);
  assert.deepEqual(p.last(), { t: 'ok', op: 'join', id: await connIdFor(K1), host: true });
});

test('Ohne Host: Spieler erfährt host: false', async () => {
  const hub = createHub();
  const p = await playerIn(hub, K1, 'WXYZ');
  assert.equal(p.last().host, false);
});

test('Nachrichten: Spieler → Host mit echter Absender-ID, Host → einer oder alle', async () => {
  const hub = createHub();
  const h = await hostIn(hub);
  const p1 = await playerIn(hub, K1);
  const p2 = await playerIn(hub, K2);
  const id1 = await connIdFor(K1);
  const id2 = await connIdFor(K2);

  // Absender lässt sich nicht fälschen: "peer" im Body wird ignoriert, es zählt die eigene ID
  await say(hub, p1, { op: 'send', msgs: [{ body: { t: 'data', d: 'hi' }, peer: id2 }] });
  assert.deepEqual(h.last(), { t: 'msgs', msgs: [{ peer: id1, body: { t: 'data', d: 'hi' } }] });

  await say(hub, h, { op: 'send', msgs: [{ to: id2, body: { t: 'data', d: 'nur für 2' } }] });
  assert.deepEqual(p2.last(), { t: 'msgs', msgs: [{ body: { t: 'data', d: 'nur für 2' } }] });
  assert.equal(p1.of('msgs').length, 0, 'Spieler 1 bekommt die private Nachricht nicht');

  await say(hub, h, { op: 'send', msgs: [{ to: null, body: { t: 'data', d: 'alle' } }] });
  assert.equal(p1.last().msgs[0].body.d, 'alle');
  assert.equal(p2.last().msgs[0].body.d, 'alle');
});

test('Fremder Token kann einen aktiven Raum nicht übernehmen, derselbe Token schon (Neuladen)', async () => {
  const hub = createHub();
  const h1 = await hostIn(hub);
  const other = await hostIn(hub, 'ABCD', { token: 'fremdertoken-bbbbbbb' });
  assert.equal(other.last().status, 409);
  assert.ok(other.closed);
  const h2 = await hostIn(hub); // gleicher Token, z. B. zweiter Tab nach Reload
  assert.deepEqual(h2.last(), { t: 'ok', op: 'host' });
  assert.equal(h1.closed.code, 4009, 'alte Host-Verbindung wird ersetzt');
});

test('Nach langer Abwesenheit darf ein anderer Token den Raum übernehmen', async () => {
  let t = 1_000_000;
  const hub = createHub({ now: () => t });
  const h = await hostIn(hub);
  hub.closed(h);
  const early = await hostIn(hub, 'ABCD', { token: 'fremdertoken-bbbbbbb' });
  assert.equal(early.last().status, 409);
  t += WS_LIMITS.hostTakeoverMs + 1;
  const late = await hostIn(hub, 'ABCD', { token: 'fremdertoken-bbbbbbb' });
  assert.deepEqual(late.last(), { t: 'ok', op: 'host' });
});

test('Spieler erfahren, wenn der Host geht und wiederkommt', async () => {
  const hub = createHub();
  const h = await hostIn(hub);
  const p = await playerIn(hub, K1);
  hub.closed(h);
  assert.deepEqual(p.last(), { t: 'host', online: false });
  await hostIn(hub);
  assert.deepEqual(p.last(), { t: 'host', online: true });
  hub.keepalive();
  assert.deepEqual(p.last(), { t: 'ka', host: true });
});

test('Spielleiter-Passwort: ohne/falsch → 401, richtig oder Host-Passwort → ok, Sperre nach vielen Versuchen', async () => {
  const hub = createHub({ gamePassword: 'spielleiter', hostPassword: 'hostpw', throttle: memoryThrottle() });
  const none = await hostIn(hub, 'ROOM1');
  assert.equal(none.last().status, 401);
  assert.ok(none.closed);
  const ok = await hostIn(hub, 'ROOM1', { pw: 'spielleiter' });
  assert.deepEqual(ok.last(), { t: 'ok', op: 'host' });
  const viaHost = await hostIn(hub, 'ROOM2', { pw: 'hostpw', token: 'anderertoken-ccccccc' });
  assert.deepEqual(viaHost.last(), { t: 'ok', op: 'host' });
  let last;
  for (let i = 0; i < 8; i++) last = (await hostIn(hub, 'ROOM3', { pw: 'falsch', ip: '10.9.9.9' })).last();
  assert.equal(last.status, 429);
  assert.ok(last.retryAfter > 0);
});

test('Spieler: Schlüssel muss passen, Größen- und Raten-Limit', async () => {
  const hub = createHub();
  await hostIn(hub);
  const bad = await connect(hub);
  await say(hub, bad, { op: 'join', room: 'ABCD', key: 'zu-kurz' });
  assert.equal(bad.last().status, 403);

  const p = await playerIn(hub, K1);
  await hub.message(p, JSON.stringify({ op: 'send', msgs: [{ body: 'x'.repeat(WS_LIMITS.maxPlayerFrameBytes) }] }));
  assert.equal(p.last().status, 413);
  assert.equal(p.closed, null, 'zu große Nachricht wird verworfen, die Verbindung bleibt');

  const q = await playerIn(hub, K2);
  let limited = false;
  for (let i = 0; i < WS_LIMITS.playerMsgsPerMin / 50 + 2; i++) {
    await say(hub, q, { op: 'send', msgs: Array.from({ length: 50 }, () => ({ body: { t: 'hb' } })) });
    if (q.last() && q.last().status === 429) { limited = true; break; }
  }
  assert.ok(limited, 'Nachrichtenflut wird gebremst');
});

test('Erste Nachricht muss host/join sein, klein und gültiges JSON', async () => {
  const hub = createHub();
  const a = await connect(hub);
  await hub.message(a, 'kein json');
  assert.equal(a.last().status, 400);
  const b = await connect(hub);
  await say(hub, b, { op: 'send', msgs: [{ body: 1 }] });
  assert.equal(b.last().status, 400);
  const c = await connect(hub);
  await hub.message(c, JSON.stringify({ op: 'join', room: 'ABCD', key: K1, pad: 'x'.repeat(WS_LIMITS.maxHelloBytes) }));
  assert.equal(c.last().status, 413);
  const d = await connect(hub);
  await say(hub, d, { op: 'host', room: 'ab', token: HOST_TOKEN });
  assert.equal(d.last().status, 400);
});

test('Spieler kann nicht als Host senden', async () => {
  const hub = createHub();
  await hostIn(hub);
  const p = await playerIn(hub, K1);
  const p2 = await playerIn(hub, K2);
  await say(hub, p, { op: 'send', msgs: [{ to: null, body: { t: 'data', d: 'fake' } }] });
  assert.equal(p2.of('msgs').length, 0, 'Spieler-Nachrichten gehen nur an den Host');
});

test('Zu viele Verbindungen von einer IP werden abgewiesen und wieder frei, wenn welche gehen', async () => {
  const hub = createHub();
  const socks = [];
  for (let i = 0; i < WS_LIMITS.maxConnsPerIp; i++) socks.push(await connect(hub, '10.7.7.7'));
  const extra = fakeSocket('10.7.7.7');
  assert.equal(await hub.open(extra, headers('10.7.7.7')), false);
  assert.equal(extra.last().status, 429);
  hub.closed(socks[0]);
  assert.equal(await hub.open(fakeSocket('10.7.7.7'), headers('10.7.7.7')), true);
});

test('Funkloch: Nachrichten für ein kurz getrenntes Gerät warten und kommen nach dem Wiederverbinden an', async () => {
  let t = 1_000_000;
  const hub = createHub({ now: () => t });
  const h = await hostIn(hub);
  const p = await playerIn(hub, K1);
  const id1 = await connIdFor(K1);
  hub.closed(p); // Verbindung weg
  await say(hub, h, { op: 'send', msgs: [{ to: null, body: { t: 'data', d: 'frage auf' } }, { to: id1, body: { t: 'data', d: 'privat' } }] });
  const back = await playerIn(hub, K1);
  assert.deepEqual(back.out[0], { t: 'ok', op: 'join', id: id1, host: true });
  assert.deepEqual(back.out[1], { t: 'msgs', msgs: [{ body: { t: 'data', d: 'frage auf' } }, { body: { t: 'data', d: 'privat' } }] });

  // Host im Funkloch: Buzz wartet ebenfalls
  hub.closed(h);
  await say(hub, back, { op: 'send', msgs: [{ body: { t: 'data', d: 'buzz' } }] });
  const h2 = await hostIn(hub);
  assert.deepEqual(h2.out[1], { t: 'msgs', msgs: [{ peer: id1, body: { t: 'data', d: 'buzz' } }] });

  // Zu lange weg: Gerät wird vergessen, nichts wird mehr aufgehoben
  hub.closed(back);
  t += WS_LIMITS.bufferMs + 1;
  hub.cleanup();
  await say(hub, h2, { op: 'send', msgs: [{ to: null, body: { t: 'data', d: 'spät' } }] });
  const late = await playerIn(hub, K1);
  assert.equal(late.of('msgs').length, 0);
});

test('Abgemeldetes Gerät (close) bekommt nichts mehr aufgehoben', async () => {
  const hub = createHub();
  const h = await hostIn(hub);
  const p = await playerIn(hub, K1);
  await say(hub, p, { op: 'send', msgs: [{ body: { t: 'close' } }] });
  hub.closed(p);
  await say(hub, h, { op: 'send', msgs: [{ to: null, body: { t: 'data', d: 'x' } }] });
  assert.equal(hub._rooms.get('ABCD').buf.size, 0);
});
