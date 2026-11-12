// HTTP-Relay (lib/relay-core.mjs) mit Speicher-Backend
const test = require('node:test');
const assert = require('node:assert/strict');

let handleRelay, memoryStore;
test.before(async () => {
  ({ handleRelay } = await import('../../lib/relay-core.mjs'));
  ({ memoryStore } = await import('../../lib/relay-stores.mjs'));
});

const HOST = 'hosttoken-aaaaaaaa';
const P1 = 'player1-aaaaaaaa';
const P2 = 'player2-bbbbbbbb';

function client(store) {
  return async (op, body, method = 'POST') => {
    const res = await handleRelay({
      method, query: new URLSearchParams({ op }), rawBody: body ? JSON.stringify(body) : '',
    }, store);
    return res;
  };
}

test('ping meldet das Relay', async () => {
  const call = client(memoryStore());
  const res = await call('ping', null, 'GET');
  assert.deepEqual(res, { status: 200, json: { ok: true, relay: true } });
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
