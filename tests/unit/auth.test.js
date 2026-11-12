// Passwortsperre (middleware.js) für Vercel
const test = require('node:test');
const assert = require('node:assert/strict');

let gate, tokenFor, COOKIE;
test.before(async () => {
  ({ gate, tokenFor, COOKIE } = await import('../../middleware.js'));
});

const PW = 'geheim';
const req = (path, init) => new Request('https://jeopardy.example' + path, init);

test('Ohne Cookie kommt die Passwortseite', async () => {
  const res = await gate(req('/host.html'), PW);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /type="password"/);
  assert.match(html, /name="next" value="\/host.html"/);
});

test('API ohne Cookie antwortet 401 als JSON', async () => {
  const res = await gate(req('/api/relay?op=ping'), PW);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'unauthorized' });
});

test('Styles und Schriften sind ohne Passwort erreichbar', async () => {
  assert.equal(await gate(req('/css/style.css'), PW), undefined);
  assert.equal(await gate(req('/fonts/x.woff2'), PW), undefined);
});

test('Richtiges Passwort setzt Cookie und leitet weiter', async () => {
  const body = new URLSearchParams({ password: PW, next: '/player.html?room=ABC' });
  const res = await gate(req('/__login', { method: 'POST', body }), PW);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/player.html?room=ABC');
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, new RegExp(`^${COOKIE}=${await tokenFor(PW)};`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
});

test('Falsches Passwort zeigt Fehler, kein Cookie', async () => {
  const body = new URLSearchParams({ password: 'falsch', next: '/' });
  const res = await gate(req('/__login', { method: 'POST', body }), PW);
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('set-cookie'), null);
  assert.match(await res.text(), /Falsches Passwort/);
});

test('Weiterleitung nur auf eigene Seiten', async () => {
  for (const next of ['https://evil.example', '//evil.example', '/\\evil.example']) {
    const body = new URLSearchParams({ password: PW, next });
    const res = await gate(req('/__login', { method: 'POST', body }), PW);
    assert.equal(res.headers.get('location'), '/', next);
  }
});

test('Gültiges Cookie lässt durch, falsches nicht', async () => {
  const good = { headers: { cookie: `a=b; ${COOKIE}=${await tokenFor(PW)}` } };
  assert.equal(await gate(req('/host.html', good), PW), undefined);
  assert.equal(await gate(req('/api/relay?op=ping', good), PW), undefined);
  const old = { headers: { cookie: `${COOKIE}=${await tokenFor('altes-passwort')}` } };
  assert.equal((await gate(req('/host.html', old), PW)).status, 200);
});

test('Ohne gesetztes Passwort bleibt alles zu', async () => {
  const res = await gate(req('/'), undefined);
  assert.equal(res.status, 500);
});

test('next-Parameter wird im HTML maskiert', async () => {
  const res = await gate(req('/x"><script>alert(1)</script>'), PW);
  const html = await res.text();
  assert.ok(!html.includes('<script>alert(1)'));
});
