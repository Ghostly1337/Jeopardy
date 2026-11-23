// Passwortsperre (middleware.js) für Vercel
const test = require('node:test');
const assert = require('node:assert/strict');

let gate, tokenFor, COOKIE, pathAllowed, FAIL_DELAY_MS;
test.before(async () => {
  ({ gate, tokenFor, COOKIE, pathAllowed, FAIL_DELAY_MS } = await import('../../middleware.js'));
  FAIL_DELAY_MS.value = 0;
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

test('Nur Laufzeitdateien werden ausgeliefert, auch mit gültigem Cookie', async () => {
  for (const ok of ['/', '/index.html', '/host.html', '/player.html', '/editor.html', '/js/host.js', '/css/style.css',
    '/vendor/peerjs.min.js', '/fonts/x.woff2', '/api/relay', '/api/sets', '/__login']) {
    assert.ok(pathAllowed(ok), ok);
  }
  for (const bad of ['/CLAUDE.md', '/README.md', '/package.json', '/package-lock.json', '/vercel.json', '/middleware.js',
    '/tests/e2e/helpers.js', '/lib/sets-core.mjs', '/node_modules/peer/package.json', '/api/relay.mjs', '/.github/workflows/ci.yml',
    '/.env', '/js/', '/js/../CLAUDE.md', '/scripts/build-pages.sh']) {
    assert.ok(!pathAllowed(bad), bad);
  }
  const cookie = `${COOKIE}=${await tokenFor(PW)}`;
  const res = await gate(new Request('https://x.test/CLAUDE.md', { headers: { cookie } }), PW);
  assert.equal(res.status, 404);
});

test('Falsches Seitenpasswort wird gebremst', async () => {
  FAIL_DELAY_MS.value = 150;
  try {
    const body = new URLSearchParams({ password: 'falsch', next: '/' });
    const t0 = Date.now();
    const res = await gate(new Request('https://x.test/__login', { method: 'POST', body }), PW);
    assert.equal(res.status, 401);
    assert.ok(Date.now() - t0 >= 140);
  } finally { FAIL_DELAY_MS.value = 0; }
});

test('Login-Weiterleitung lässt keine fremden Ziele zu', async () => {
  for (const next of ['//evil.example/player.html?room=A', 'https://evil.example/', '/\\evil.example', 'javascript:alert(1)']) {
    const body = new URLSearchParams({ password: PW, next });
    const login = await gate(req('/__login', { method: 'POST', body }), PW);
    assert.equal(login.headers.get('location'), '/', next);
  }
});

test('QR-Beitrittslink: nach dem Login landet der Spieler wieder im Raum, ohne Passwort im Link', async () => {
  const link = '/player.html?room=ABC123';
  const res = await gate(req(link), PW);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /name="next" value="\/player\.html\?room=ABC123"/);
  const body = new URLSearchParams({ password: PW, next: link });
  const login = await gate(req('/__login', { method: 'POST', body }), PW);
  assert.equal(login.status, 303);
  assert.equal(login.headers.get('location'), link);
  assert.ok(!login.headers.get('location').includes(PW));
  assert.match(login.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
});

test('Login-Seite: HTML im Weiterleitungsziel bleibt Text', async () => {
  const res = await gate(req('/player.html?room="><script>alert(1)</script>'), PW);
  const html = await res.text();
  assert.ok(!html.includes('<script>alert'), 'kein eingeschleustes Skript');
});

test('Login-Seite: strenge CSP, kein Inline-Skript', async () => {
  const res = await gate(req('/host.html'), PW);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.ok(!/<script>/.test(await res.text()));
  // Das Theme-Skript der Login-Seite ist ohne Anmeldung erreichbar, der Rest von /js/ nicht
  assert.equal(await gate(req('/js/theme-init.js'), PW), undefined);
  assert.equal((await gate(req('/js/host.js'), PW)).status, 200, 'Login-Seite statt Datei');
});
