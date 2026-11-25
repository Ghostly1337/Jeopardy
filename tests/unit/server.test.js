// Eigener Server (server.mjs): Passwort-Sperre, erlaubte Dateien, Sicherheits-Header,
// Login mit Sperre pro IP, WebSocket nur mit Login-Cookie und von der eigenen Seite.
const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');

const PW = 'seiten-passwort';
let srv, base, cookie;

test.before(async () => {
  const { startServer } = await import('../../server.mjs');
  const { LOGIN_LIMITS } = await import('../../lib/login-core.mjs');
  const { WS_LIMITS } = await import('../../lib/ws-hub.mjs');
  LOGIN_LIMITS.failDelayMs = 0;
  WS_LIMITS.failDelayMs = 0;
  srv = await startServer({ port: 0, host: '127.0.0.1', env: { JEOPARDY_PASSWORD: PW, JEOPARDY_HOST_PASSWORD: 'host-pw' } });
  base = `http://127.0.0.1:${srv.port}`;
  const res = await fetch(base + '/api/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: PW, next: '/host.html' }),
  });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/host.html');
  cookie = res.headers.get('set-cookie').split(';')[0];
});
test.after(async () => { if (srv) await srv.close(); });

const get = (path, headers = {}) => fetch(base + path, { redirect: 'manual', headers });

test('Ohne Login: Passwortseite mit Sicherheits-Headern, API antwortet 401', async () => {
  const res = await get('/host.html');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /action="\/api\/login"/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await get('/api/relay?op=ping')).status, 401);
  assert.equal((await get('/api/sets')).status, 401);
});

test('Nur Laufzeit-Dateien werden ausgeliefert – auch angemeldet', async () => {
  for (const p of ['/server.mjs', '/lib/ws-hub.mjs', '/package.json', '/.env', '/tests/unit/server.test.js',
    '/node_modules/ws/package.json', '/api/relay.mjs', '/middleware.js', '/js/../server.mjs', '/%2e%2e/etc/passwd']) {
    const res = await get(p, { cookie });
    assert.equal(res.status, 404, p);
  }
});

test('Angemeldet: Seiten, Skripte und 304 bei unveränderter Datei', async () => {
  const page = await get('/host.html', { cookie });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.equal(page.headers.get('strict-transport-security'), 'max-age=63072000; includeSubDomains');
  const js = await get('/js/net.js', { cookie });
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  const again = await get('/js/net.js', { cookie, 'if-none-match': js.headers.get('etag') });
  assert.equal(again.status, 304);
  const ping = await (await get('/api/relay?op=ping', { cookie })).json();
  assert.equal(ping.ws, true, 'eigener Server meldet das WebSocket-Relay');
});

test('Ohne Datenbank: Fragensets antworten sauber (kein 500)', async () => {
  const res = await get('/api/sets', { cookie, 'x-host-password': 'host-pw' });
  assert.notEqual(res.status, 500);
});

test('Login-Sperre zählt die echte IP – gefälschte X-Forwarded-For-Kopfzeilen helfen nicht', async () => {
  let last;
  for (let i = 0; i < 8; i++) {
    last = await fetch(base + '/api/login', {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': `1.2.3.${i}`, 'x-real-ip': `5.6.7.${i}` },
      body: new URLSearchParams({ password: 'falsch' }),
    });
  }
  assert.equal(last.status, 303);
  assert.match(last.headers.get('location'), /e=locked/);
});

function wsOpen(headers) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/api/ws`, { headers });
    ws.on('open', () => resolve({ ws, status: 101 }));
    ws.on('unexpected-response', (req, res) => resolve({ status: res.statusCode }));
    ws.on('error', () => resolve({ status: 0 }));
  });
}

test('WebSocket nur mit Login-Cookie und von der eigenen Seite', async () => {
  const origin = `http://127.0.0.1:${srv.port}`;
  assert.equal((await wsOpen({ origin })).status, 401, 'ohne Cookie');
  assert.equal((await wsOpen({ origin: 'https://boese.example', cookie })).status, 403, 'fremde Seite');
  assert.equal((await wsOpen({ cookie })).status, 403, 'ohne Origin');
  const { ws, status } = await wsOpen({ origin, cookie });
  assert.equal(status, 101);
  const reply = new Promise((r) => ws.once('message', (d) => r(JSON.parse(String(d)))));
  ws.send(JSON.stringify({ op: 'host', room: 'TEST1', token: 'hosttoken-aaaaaaaa' }));
  assert.deepEqual(await reply, { t: 'ok', op: 'host' });
  ws.close();
});
