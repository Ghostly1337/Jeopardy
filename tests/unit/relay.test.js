// HTTP-Relay (lib/relay-core.mjs) mit Speicher-Backend
const test = require('node:test');
const assert = require('node:assert/strict');

let handleRelay, memoryStore, connIdFor, LIMITS, rateLimiter, MAX_ROOM_MSGS;
const HOST = 'hosttoken-aaaaaaaa';
// Spieler: geheimer Schlüssel → ID (Hash). Die Tests nutzen die IDs, client() ergänzt den Schlüssel.
const K1 = 'player1-key-aaaaaaaaaaaaaaaaaaaaaaaa';
const K2 = 'player2-key-bbbbbbbbbbbbbbbbbbbbbbbb';
let P1, P2;
const KEYS = {};
test.before(async () => {
  ({ handleRelay, connIdFor, LIMITS } = await import('../../lib/relay-core.mjs'));
  ({ memoryStore, MAX_ROOM_MSGS } = await import('../../lib/relay-stores.mjs'));
  ({ rateLimiter } = await import('../../lib/throttle.mjs'));
  P1 = await connIdFor(K1);
  P2 = await connIdFor(K2);
  KEYS[P1] = K1;
  KEYS[P2] = K2;
});

function client(store, auth = {}, pw, ip = '10.0.0.1') {
  return async (op, body, method = 'POST', headerPw = pw) => {
    const b = body && KEYS[body.as] && !('key' in body) ? { ...body, key: KEYS[body.as] } : body;
    const h = { 'x-real-ip': ip };
    if (headerPw != null) h['x-game-password'] = headerPw;
    return handleRelay({
      method, query: new URLSearchParams({ op }), rawBody: b ? JSON.stringify(b) : '',
      headers: new Headers(h),
    }, store, { rate: rateLimiter(), ...auth });
  };
}

test('ping meldet das Relay', async () => {
  const call = client(memoryStore());
  const res = await call('ping', null, 'GET');
  assert.deepEqual(res, { status: 200, json: { ok: true, relay: true, hostGate: false } });
});

test('Host belegt Raum, fremder Token wird abgewiesen, gleicher Token darf neu anmelden', async () => {
  const call = client(memoryStore());
  assert.equal((await call('host', { room: 'ABC123', token: HOST })).status, 200);
  assert.equal((await call('host', { room: 'ABC123', token: 'other-token-xxxxx' })).status, 409);
  assert.equal((await call('host', { room: 'abc123', token: HOST })).status, 200, 'Reload des Hosts');
});

test('Verwaister Raum kann nach einer Minute übernommen werden', async () => {
  let t = 0;
  const call = client(memoryStore({ now: () => t }));
  await call('host', { room: 'ABC123', token: HOST });
  t = 61_000;
  assert.equal((await call('host', { room: 'ABC123', token: 'other-token-xxxxx' })).status, 200);
});

test('Nachrichten laufen gezielt und als Rundsendung, Cursor überspringt nichts', async () => {
  const call = client(memoryStore());
  await call('host', { room: 'ROOM42', token: HOST });
  const start1 = (await call('poll', { room: 'ROOM42', as: P1, after: -1 })).json;
  const start2 = (await call('poll', { room: 'ROOM42', as: P2, after: -1 })).json;
  assert.equal(start1.host, true);

  await call('send', { room: 'ROOM42', as: P1, msgs: [{ body: { t: 'open' } }] });
  const h = (await call('poll', { room: 'ROOM42', as: 'host', token: HOST, after: 0 })).json;
  assert.deepEqual(h.msgs.map((m) => [m.peer, m.body.t]), [[P1, 'open']]);

  await call('send', {
    room: 'ROOM42', as: 'host', token: HOST,
    msgs: [{ to: P1, body: { t: 'data', d: 'nur P1' } }, { to: null, body: { t: 'data', d: 'alle' } }],
  });
  const r1 = (await call('poll', { room: 'ROOM42', as: P1, after: start1.seq })).json;
  const r2 = (await call('poll', { room: 'ROOM42', as: P2, after: start2.seq })).json;
  assert.deepEqual(r1.msgs.map((m) => m.body.d), ['nur P1', 'alle']);
  assert.deepEqual(r2.msgs.map((m) => m.body.d), ['alle']);
  assert.equal(r1.seq, r2.seq);

  // Spieler sehen keine Nachrichten an den Host
  assert.ok(!r1.msgs.some((m) => m.body.t === 'open'));
});

test('Long-Poll wartet auf neue Nachrichten', async () => {
  const call = client(memoryStore());
  await call('host', { room: 'WAIT01', token: HOST });
  const { seq } = (await call('poll', { room: 'WAIT01', as: P1, after: -1 })).json;
  const started = Date.now();
  const pending = call('poll', { room: 'WAIT01', as: P1, after: seq, wait: 3000 });
  setTimeout(() => call('send', { room: 'WAIT01', as: 'host', token: HOST, msgs: [{ to: null, body: 'hi' }] }), 300);
  const res = (await pending).json;
  assert.deepEqual(res.msgs.map((m) => m.body), ['hi']);
  const took = Date.now() - started;
  assert.ok(took >= 250 && took < 2000, `dauerte ${took} ms`);
});

test('Long-Poll endet ohne Nachrichten nach der Wartezeit', async () => {
  const call = client(memoryStore());
  await call('host', { room: 'WAIT02', token: HOST });
  const res = (await call('poll', { room: 'WAIT02', as: P1, after: 0, wait: 300 })).json;
  assert.deepEqual(res.msgs, []);
});

test('Nur der Host darf an Spieler senden und Host-Nachrichten lesen', async () => {
  const call = client(memoryStore());
  await call('host', { room: 'SAFE01', token: HOST });
  assert.equal((await call('send', { room: 'SAFE01', as: 'host', token: 'wrong-token-xxxxx', msgs: [{ body: 1 }] })).status, 403);
  assert.equal((await call('poll', { room: 'SAFE01', as: 'host', token: 'wrong-token-xxxxx', after: 0 })).status, 403);
});

test('Ungültige Eingaben werden abgewiesen', async () => {
  const call = client(memoryStore());
  assert.equal((await call('host', { room: 'x', token: HOST })).status, 400);
  assert.equal((await call('host', { room: 'ABC123', token: 'kurz' })).status, 400);
  assert.equal((await call('send', { room: 'NOROOM', as: P1, msgs: [{ body: 1 }] })).status, 404);
  assert.equal((await call('nope', {})).status, 404);
  assert.equal((await call('poll', null, 'GET')).status, 405);
  const bad = await handleRelay({ method: 'POST', query: new URLSearchParams({ op: 'poll' }), rawBody: '{kaputt' }, memoryStore());
  assert.equal(bad.status, 400);
  const many = Array.from({ length: 101 }, () => ({ body: 1 }));
  await call('host', { room: 'MANY01', token: HOST });
  assert.equal((await call('send', { room: 'MANY01', as: P1, msgs: many })).status, 413);
});

test('Spieler ohne Host im Raum sieht host=false', async () => {
  const call = client(memoryStore());
  const res = (await call('poll', { room: 'EMPTY1', as: P1, after: -1 })).json;
  assert.equal(res.host, false);
});

test('Große Clips: Antwort bleibt unter dem Größenlimit, der Rest kommt beim nächsten Poll', async () => {
  const { LIMITS } = await import('../../lib/relay-core.mjs');
  const call = client(memoryStore());
  await call('host', { room: 'CLIP01', token: HOST });
  const start = (await call('poll', { room: 'CLIP01', as: P1, after: -1 })).json;
  const big = 'A'.repeat(Math.ceil(LIMITS.maxReplyChars * 0.6));
  for (let i = 0; i < 3; i++) await call('send', { room: 'CLIP01', as: 'host', token: HOST, msgs: [{ to: P1, body: { i, d: big } }] });
  const seen = [];
  let after = start.seq;
  for (let k = 0; k < 5 && seen.length < 3; k++) {
    const r = (await call('poll', { room: 'CLIP01', as: P1, after })).json;
    assert.ok(JSON.stringify(r).length < LIMITS.maxReplyChars * 1.3, 'Antwort klein genug');
    r.msgs.forEach((m) => seen.push(m.body.i));
    after = r.seq;
  }
  assert.deepEqual(seen, [0, 1, 2], 'nichts geht verloren, Reihenfolge bleibt');
});

test('Spielleiter-Passwort: Raum eröffnen/übernehmen nur mit Spielleiter- oder Host-Passwort', async () => {
  const { LIMITS } = await import('../../lib/relay-core.mjs');
  const delay = LIMITS.failDelayMs;
  LIMITS.failDelayMs = 0;
  try {
    const auth = { gamePassword: 'spielleiter-pw', hostPassword: 'host-pw' };
    const store = memoryStore();
    const call = client(store, auth);
    assert.equal((await call('ping', null, 'GET')).json.hostGate, true);
    for (const pw of [null, '', 'falsch', 'SPIELLEITER-PW']) {
      const r = await call('host', { room: 'GATE01', token: HOST }, 'POST', pw);
      assert.deepEqual(r, { status: 401, json: { error: 'game password required' } }, String(pw));
    }
    assert.equal((await call('host', { room: 'GATE01', token: HOST }, 'POST', 'spielleiter-pw')).status, 200);
    assert.equal((await call('host', { room: 'GATE02', token: HOST }, 'POST', 'host-pw')).status, 200, 'Host-Passwort geht auch');
    // Spieler brauchen kein Passwort: pollen und senden geht weiter
    assert.equal((await call('poll', { room: 'GATE01', as: P1, after: -1 }, 'POST', null)).status, 200);
    assert.equal((await call('send', { room: 'GATE01', as: P1, msgs: [{ body: { t: 'open' } }] }, 'POST', null)).status, 200);
    // Ohne Passwort kann auch ein verwaister Raum nicht übernommen werden
    let t = 0;
    const timed = memoryStore({ now: () => t });
    const c2 = client(timed, auth, 'spielleiter-pw');
    await c2('host', { room: 'GATE03', token: HOST });
    t = 61_000;
    assert.equal((await c2('host', { room: 'GATE03', token: 'other-token-xxxxx' }, 'POST', null)).status, 401);
  } finally { LIMITS.failDelayMs = delay; }
});

test('Spielleiter-Passwort: ohne Einstellung bleibt Hosten offen; falsche Versuche werden gebremst', async () => {
  const { LIMITS } = await import('../../lib/relay-core.mjs');
  assert.equal((await client(memoryStore(), {})('host', { room: 'OPEN01', token: HOST })).status, 200);
  const delay = LIMITS.failDelayMs;
  LIMITS.failDelayMs = 150;
  try {
    const t0 = Date.now();
    const r = await client(memoryStore(), { gamePassword: 'x-pw' }, 'falsch')('host', { room: 'SLOW01', token: HOST });
    assert.equal(r.status, 401);
    assert.ok(Date.now() - t0 >= 140);
  } finally { LIMITS.failDelayMs = delay; }
});

test('Verbindungs-ID gehört dem Gerät: ohne passenden Schlüssel kein Senden und kein Mitlesen', async () => {
  const store = memoryStore();
  const call = client(store);
  await call('host', { room: 'OWN001', token: HOST });
  const start = (await call('poll', { room: 'OWN001', as: P1, after: -1 })).json;
  await call('send', { room: 'OWN001', as: 'host', token: HOST, msgs: [{ to: P1, body: { tipp: 'geheim' } }] });
  for (const key of [undefined, K2, 'x'.repeat(40), '']) {
    const fake = { room: 'OWN001', as: P1, key, after: start.seq };
    assert.equal((await call('poll', fake)).status, key === undefined ? 403 : 403, 'Mitlesen mit fremder ID');
    assert.equal((await call('send', { room: 'OWN001', as: P1, key, msgs: [{ body: { t: 'data', d: 'gefälscht' } }] })).status, 403);
  }
  const mine = (await call('poll', { room: 'OWN001', as: P1, after: start.seq })).json;
  assert.deepEqual(mine.msgs.map((m) => m.body.tipp), ['geheim']);
});

test('Limits: Spieler-Anfragen klein, Nachrichten pro Verbindung begrenzt, neue Räume pro IP begrenzt', async () => {
  const store = memoryStore();
  const call = client(store);
  await call('host', { room: 'LIM001', token: HOST });
  // zu große Spieler-Anfrage
  const big = { room: 'LIM001', as: P1, msgs: [{ body: { d: 'x'.repeat(LIMITS.maxPlayerBodyBytes) } }] };
  assert.equal((await call('send', big)).status, 413);
  // Der Host darf große Nachrichten (Clips) schicken
  assert.equal((await call('send', { room: 'LIM001', as: 'host', token: HOST, msgs: [{ body: { d: 'x'.repeat(100_000) } }] })).status, 200);
  // Flut pro Verbindung
  const rate = rateLimiter();
  const flood = client(store, { rate });
  let last;
  for (let i = 0; i < LIMITS.playerMsgsPerMin / 50 + 1; i++) {
    last = await flood('send', { room: 'LIM001', as: P1, msgs: Array.from({ length: 50 }, () => ({ body: { t: 'hb' } })) });
  }
  assert.equal(last.status, 429);
  assert.equal(last.headers['retry-after'], '10');
  assert.equal((await flood('send', { room: 'LIM001', as: P2, msgs: [{ body: { t: 'hb' } }] })).status, 200, 'andere Verbindung nicht betroffen');
  // neue Räume pro IP
  const rooms = client(memoryStore(), { rate: rateLimiter() }, null, '10.9.9.9');
  let r;
  for (let i = 0; i <= LIMITS.newRoomsPerHour; i++) r = await rooms('host', { room: 'R' + String(i).padStart(5, '0'), token: HOST });
  assert.equal(r.status, 429);
  assert.equal((await rooms('host', { room: 'R00000', token: HOST })).status, 200, 'Neuladen eines bestehenden Raums bleibt erlaubt');
});

test('Pro Raum werden höchstens MAX_ROOM_MSGS Nachrichten aufbewahrt', async () => {
  const store = memoryStore();
  const call = client(store, { rate: () => true });
  await call('host', { room: 'CAP001', token: HOST });
  for (let i = 0; i < 25; i++) {
    await call('send', { room: 'CAP001', as: 'host', token: HOST, msgs: Array.from({ length: 50 }, (_, k) => ({ body: { n: i * 50 + k } })) });
  }
  assert.equal(store._rooms.get('CAP001').msgs.length, MAX_ROOM_MSGS);
});

test('Spielleiter-Passwort: nach 5 Fehlversuchen gesperrt (429), auch richtiges Passwort', async () => {
  const { memoryThrottle } = await import('../../lib/throttle.mjs');
  const delay = LIMITS.failDelayMs;
  LIMITS.failDelayMs = 0;
  try {
    const throttle = memoryThrottle();
    const auth = { gamePassword: 'spielleiter-pw', throttle };
    const store = memoryStore();
    for (let i = 0; i < 5; i++) assert.equal((await client(store, auth, 'falsch')('host', { room: 'LOCK01', token: HOST })).status, 401);
    const r = await client(store, auth, 'spielleiter-pw')('host', { room: 'LOCK01', token: HOST });
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers['retry-after']) >= 60);
    assert.equal((await client(store, auth, 'spielleiter-pw', '10.7.7.7')('host', { room: 'LOCK01', token: HOST })).status, 200, 'andere IP');
  } finally { LIMITS.failDelayMs = delay; }
});
