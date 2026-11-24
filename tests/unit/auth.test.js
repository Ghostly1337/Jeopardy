// Passwortsperre für Vercel: Middleware (Cookie prüfen, Login-Seite, erlaubte Pfade),
// Login-Funktion (/api/login, Sperre pro IP) und signiertes Cookie.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

let gate, COOKIE, pathAllowed, mwVerify, mwSafeNext;
let handleLogin, LOGIN_LIMITS, safeNext, signSession, verifySession, SESSION_MAX_AGE, memoryThrottle, THROTTLE;
test.before(async () => {
  ({ gate, COOKIE, pathAllowed, verifySession: mwVerify, safeNext: mwSafeNext } = await import('../../middleware.js'));
  ({ handleLogin, LOGIN_LIMITS, safeNext } = await import('../../lib/login-core.mjs'));
  ({ signSession, verifySession, SESSION_MAX_AGE } = await import('../../lib/session.mjs'));
  ({ memoryThrottle, THROTTLE } = await import('../../lib/throttle.mjs'));
  LOGIN_LIMITS.failDelayMs = 0;
});

const PW = 'geheim';
const req = (p, init) => new Request('https://jeopardy.example' + p, init);
const withCookie = async (p, pw = PW) => req(p, { headers: { cookie: `a=b; ${COOKIE}=${await signSession(pw)}` } });
const login = (password, next = '/', { ip = '1.2.3.4', throttle } = {}) => handleLogin({
  method: 'POST', headers: new Headers({ 'x-real-ip': ip }), form: new URLSearchParams({ password, next }),
}, { password: PW, throttle });

// ---------- Middleware ----------
test('Middleware hat keine Importe (Vercel kompiliert sie zu CommonJS → ERR_REQUIRE_ESM)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'middleware.js'), 'utf8');
  assert.doesNotMatch(src, /^\s*import\s/m);
  assert.doesNotMatch(src, /\brequire\s*\(/);
  assert.doesNotMatch(src, /\bimport\s*\(/);
});

test('Ohne Cookie kommt die Passwortseite; das Formular geht an /api/login', async () => {
  const res = await gate(req('/host.html'), PW);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /type="password"/);
  assert.match(html, /action="\/api\/login"/);
  assert.match(html, /name="next" value="\/host.html"/);
});

test('API ohne Cookie antwortet 401 als JSON; /api/login selbst ist erreichbar', async () => {
  const res = await gate(req('/api/relay?op=ping'), PW);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'unauthorized' });
  assert.equal(await gate(req('/api/login', { method: 'POST' }), PW), undefined);
});

test('Styles, Schriften und das Theme-Skript sind ohne Passwort erreichbar, der Rest nicht', async () => {
  assert.equal(await gate(req('/css/style.css'), PW), undefined);
  assert.equal(await gate(req('/fonts/x.woff2'), PW), undefined);
  assert.equal(await gate(req('/js/theme-init.js'), PW), undefined);
  assert.equal((await gate(req('/js/host.js'), PW)).status, 200, 'Login-Seite statt Datei');
});

test('Signiertes Cookie lässt durch; altes Passwort, gefälschte und abgelaufene Cookies nicht', async () => {
  assert.equal(await gate(await withCookie('/host.html'), PW), undefined);
  assert.equal(await gate(await withCookie('/api/relay?op=ping'), PW), undefined);
  assert.equal((await gate(await withCookie('/host.html', 'altes-passwort'), PW)).status, 200);
  const t = await signSession(PW);
  const forged = t.replace(/\.(\d+)\./, (m, exp) => `.${Number(exp) + 999999}.`);
  assert.equal((await gate(req('/host.html', { headers: { cookie: `${COOKIE}=${forged}` } }), PW)).status, 200, 'verlängertes Ablaufdatum');
  const old = await signSession(PW, Date.now() - (SESSION_MAX_AGE + 10) * 1000);
  assert.equal((await gate(req('/host.html', { headers: { cookie: `${COOKIE}=${old}` } }), PW)).status, 200, 'abgelaufen');
  // Das alte Format (Hash des Passworts) gilt nicht mehr
  const legacy = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('jeopardy-gate:' + PW)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  assert.equal((await gate(req('/host.html', { headers: { cookie: `${COOKIE}=${legacy}` } }), PW)).status, 200);
});

test('Middleware und Login-Funktion stimmen überein (Cookie und Weiterleitungsziele)', async () => {
  const t = await signSession(PW);
  assert.equal(await mwVerify(PW, t), true);
  assert.equal(await verifySession(PW, t), true);
  assert.equal(await mwVerify(PW, t + '0'), false);
  for (const v of ['/', '/player.html?room=A', '//evil', '/\\evil', 'https://evil', '/a b', 'javascript:1', '/ok#x', '']) {
    assert.equal(mwSafeNext(v), safeNext(v), v);
  }
});

test('Ohne gesetztes Passwort bleibt alles zu', async () => {
  assert.equal((await gate(req('/'), undefined)).status, 500);
});

test('HTML im Weiterleitungsziel bleibt Text; Fehlermeldungen nur aus fester Liste', async () => {
  const html = await (await gate(req('/x"><script>alert(1)</script>'), PW)).text();
  assert.ok(!html.includes('<script>alert(1)'));
  const page = await (await gate(req('/__login?e=<b>hack</b>&next=/'), PW)).text();
  assert.ok(!page.includes('<b>hack'));
  assert.match(await (await gate(req('/__login?e=wrong&next=/'), PW)).text(), /Falsches Passwort/);
  assert.match(await (await gate(req('/__login?e=locked&s=120&next=/'), PW)).text(), /in 2 Minuten erneut/);
});

test('Nur Laufzeitdateien werden ausgeliefert, auch mit gültigem Cookie', async () => {
  for (const ok of ['/', '/index.html', '/host.html', '/player.html', '/editor.html', '/js/host.js', '/css/style.css',
    '/vendor/peerjs.min.js', '/fonts/x.woff2', '/api/relay', '/api/sets', '/api/login', '/__login']) {
    assert.ok(pathAllowed(ok), ok);
  }
  for (const bad of ['/CLAUDE.md', '/README.md', '/package.json', '/package-lock.json', '/vercel.json', '/middleware.js',
    '/tests/e2e/helpers.js', '/lib/sets-core.mjs', '/node_modules/peer/package.json', '/api/relay.mjs', '/api/login.mjs',
    '/.github/workflows/ci.yml', '/.env', '/js/', '/js/../CLAUDE.md', '/scripts/x.sh']) {
    assert.ok(!pathAllowed(bad), bad);
  }
  assert.equal((await gate(await withCookie('/CLAUDE.md'), PW)).status, 404);
});

test('Login-Seite: strenge CSP, kein Inline-Skript', async () => {
  const res = await gate(req('/host.html'), PW);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.ok(!/<script>/.test(await res.text()));
});

// ---------- Login-Funktion ----------
test('Richtiges Passwort: signiertes Cookie und zurück zur Seite (QR-Link behält den Raum)', async () => {
  const res = await login(PW, '/player.html?room=ABC123');
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, '/player.html?room=ABC123');
  const cookie = res.headers['set-cookie'];
  assert.match(cookie, new RegExp(`^${COOKIE}=v1\\.\\d+\\.\\d+\\.[0-9a-f]{64};`));
  assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
  assert.ok(!cookie.includes(PW) && !res.headers.location.includes(PW));
  assert.equal(await verifySession(PW, cookie.split(';')[0].split('=')[1]), true);
});

test('Falsches Passwort: zurück zur Login-Seite mit Hinweis, kein Cookie', async () => {
  const res = await login('falsch', '/host.html');
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, '/__login?e=wrong&next=%2Fhost.html');
  assert.equal(res.headers['set-cookie'], undefined);
});

test('Weiterleitung nur auf eigene Seiten', async () => {
  for (const next of ['https://evil.example', '//evil.example/player.html?room=A', '/\\evil.example', 'javascript:alert(1)']) {
    assert.equal((await login(PW, next)).headers.location, '/', next);
  }
});

test('Sperre pro IP: nach 5 Fehlversuchen gesperrt (auch mit richtigem Passwort), andere IPs nicht', async () => {
  const throttle = memoryThrottle();
  for (let i = 0; i < THROTTLE.limit; i++) {
    assert.match((await login('falsch', '/', { throttle })).headers.location, /e=wrong/);
  }
  const locked = await login(PW, '/', { throttle });
  assert.match(locked.headers.location, /e=locked&s=60/);
  assert.equal(locked.headers['set-cookie'], undefined, 'auch das richtige Passwort hilft während der Sperre nicht');
  assert.equal((await login(PW, '/', { throttle, ip: '5.6.7.8' })).status, 303);
  assert.ok((await login(PW, '/', { throttle, ip: '5.6.7.8' })).headers['set-cookie']);
});

test('Sperre wächst mit jeder neuen Sperre, Erfolg setzt zurück; gespeichert wird nur ein Hash der IP', async () => {
  let t = 0;
  const throttle = memoryThrottle({ now: () => t });
  const fail = () => login('falsch', '/', { throttle, ip: '9.9.9.9' });
  for (let i = 0; i <= THROTTLE.limit; i++) await fail();
  t += 61_000;
  for (let i = 0; i <= THROTTLE.limit; i++) await fail();
  assert.match((await login(PW, '/', { throttle, ip: '9.9.9.9' })).headers.location, /s=120/);
  t += 121_000;
  assert.ok((await login(PW, '/', { throttle, ip: '9.9.9.9' })).headers['set-cookie']);
  assert.equal(throttle._rows.size, 0, 'Erfolg löscht den Zähler');
  await fail();
  const keys = [...throttle._rows.keys()].join();
  assert.ok(!keys.includes('9.9.9.9'), 'keine IP im Klartext');
});
