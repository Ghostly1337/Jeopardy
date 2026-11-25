// Vercel Routing Middleware: Passwort-Sperre vor der ganzen Seite.
// WICHTIG: keine Importe. Vercel kompiliert die Middleware zu CommonJS; ein Import aus einem
// ES-Modul (lib/*.mjs) lässt sie mit ERR_REQUIRE_ESM abstürzen (500 auf jeder Seite).
// Ein Test (tests/unit/auth.test.js) prüft das.
//
// Ablauf: Die Login-Seite schickt das Passwort an /api/login (Vercel Function). Dort wird es mit
// Sperre pro IP geprüft und ein signiertes Cookie gesetzt (lib/session.mjs). Die Middleware prüft
// hier nur noch dieses Cookie – mit einer eigenen Kopie von verifySession (Test: beide stimmen überein).

export const COOKIE = 'jeop_auth';
export const LOGIN_PATH = '/__login';
const LOGIN_API = '/api/login';
const SESSION_MAX_AGE = 30 * 24 * 3600;
// Styles, Schriften und das Theme-Skript braucht die Login-Seite selbst; sie enthalten nichts Geheimes.
const PUBLIC_PREFIXES = ['/css/', '/fonts/', '/icons/', '/favicon', '/js/theme-init.js'];
const LOGIN_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
// Nur Dateien, die der Browser zur Laufzeit braucht, werden überhaupt ausgeliefert. Alles andere
// im Repo (Tests, lib/, node_modules/, Konfiguration, Doku) antwortet mit 404, auch angemeldet.
const ALLOWED_FILES = new Set(['/', '/index.html', '/host.html', '/player.html', '/editor.html', '/favicon.ico', LOGIN_PATH]);
const ALLOWED_PREFIXES = ['/css/', '/js/', '/fonts/', '/vendor/', '/icons/'];
const ALLOWED_API = new Set(['/api/relay', '/api/sets', '/api/ws', LOGIN_API]);
export function pathAllowed(pathname) {
  if (pathname.includes('..') || pathname.includes('\\')) return false;
  return ALLOWED_FILES.has(pathname) || ALLOWED_API.has(pathname)
    || ALLOWED_PREFIXES.some((p) => pathname.startsWith(p) && pathname.length > p.length);
}

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Kopie von lib/session.mjs → verifySession (siehe Kopfkommentar)
async function hmac(password, payload) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('jeopardy-session-key:' + password));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
}
export async function verifySession(password, token, now = Date.now()) {
  if (!password || typeof token !== 'string' || token.length > 200) return false;
  const m = /^v1\.(\d{1,12})\.(\d{1,12})\.([0-9a-f]{64})$/.exec(token);
  if (!m) return false;
  const [, iat, exp, sig] = m;
  const t = Math.floor(now / 1000);
  if (!(Number(exp) > t && Number(iat) <= t + 60 && Number(exp) - Number(iat) <= SESSION_MAX_AGE)) return false;
  return safeEqual(await hmac(password, `v1.${iat}.${exp}`), sig);
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) {
      try { return decodeURIComponent(v.join('=')); } catch (e) { return null; }
    }
  }
  return null;
}

// Nur Pfade dieser Seite (kein //fremd.de, kein \\, keine Leer-/Steuerzeichen) – sonst Startseite.
// Gleiche Regel wie safeNext in lib/login-core.mjs (Test prüft beide).
export function safeNext(v) {
  return typeof v === 'string' && v.length <= 2000 && /^\/(?![/\\])[^\s\\]*$/.test(v) ? v : '/';
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Fehlertexte kommen nur aus dieser festen Liste (nie aus der URL übernommen)
function errorText(e, seconds) {
  if (e === 'wrong') return 'Falsches Passwort.';
  if (e === 'locked') {
    const s = Math.max(1, Math.min(3600, Number(seconds) || 60));
    return `Zu viele Versuche – bitte in ${s >= 120 ? Math.ceil(s / 60) + ' Minuten' : s + ' Sekunden'} erneut probieren.`;
  }
  return '';
}

function loginPage(next, error) {
  const html = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Jeopardy – Passwort</title>
  <script src="/js/theme-init.js"></script>
  <link rel="icon" href="/icons/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <main class="home">
    <h1 class="logo">JEOPARDY<span>!</span></h1>
    <p class="tagline">Privates Spiel – bitte Passwort eingeben.</p>
    <div class="card">
      <h2>Passwort</h2>
      <form class="row" method="post" action="${LOGIN_API}">
        <input type="hidden" name="next" value="${escapeHtml(next)}">
        <input id="password" name="password" type="password" placeholder="Passwort" autocomplete="current-password" required autofocus>
        <button class="primary" type="submit">Weiter</button>
      </form>
      ${error ? `<p class="hint" role="alert">${escapeHtml(error)}</p>` : ''}
    </div>
  </main>
</body>
</html>`;
  return new Response(html, {
    status: error ? 401 : 200,
    headers: {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex',
      'content-security-policy': LOGIN_CSP, 'x-frame-options': 'DENY',
    },
  });
}

/**
 * Antwort zum Abbrechen der Anfrage, oder undefined zum Durchlassen.
 * @param {Request} request
 * @param {string | undefined} password
 */
export async function gate(request, password) {
  const url = new URL(request.url);
  if (!pathAllowed(url.pathname)) {
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  }
  if (PUBLIC_PREFIXES.some((p) => url.pathname.startsWith(p))) return undefined;
  if (url.pathname === LOGIN_API) return undefined; // prüft selbst (mit Sperre pro IP)
  if (!password) return new Response('JEOPARDY_PASSWORD ist nicht gesetzt.', { status: 500 });

  if (await verifySession(password, readCookie(request, COOKIE))) {
    return url.pathname === LOGIN_PATH ? Response.redirect(new URL(safeNext(url.searchParams.get('next') || '/'), url), 303) : undefined;
  }
  if (url.pathname.startsWith('/api/')) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (url.pathname === LOGIN_PATH) {
    return loginPage(safeNext(url.searchParams.get('next') || '/'), errorText(url.searchParams.get('e'), url.searchParams.get('s')));
  }
  return loginPage(safeNext(url.pathname + url.search), '');
}

export default function middleware(request) {
  return gate(request, process.env.JEOPARDY_PASSWORD);
}
