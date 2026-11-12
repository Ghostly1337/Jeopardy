// Vercel Routing Middleware: simple shared-password gate in front of the whole site.
// Kept self-contained in this file because Vercel bundles middleware separately.
// The password comes from the JEOPARDY_PASSWORD environment variable; the cookie only
// holds a hash of it, so changing the password logs everyone out.

export const COOKIE = 'jeop_auth';
export const LOGIN_PATH = '/__login';
const MAX_AGE = 60 * 60 * 24 * 30;
// Styles and fonts are needed by the login page itself and contain nothing secret.
const PUBLIC_PREFIXES = ['/css/', '/fonts/', '/favicon'];

export async function tokenFor(password) {
  const data = new TextEncoder().encode('jeopardy-gate:' + password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

// Only same-site relative paths, so the login form can't be abused as an open redirect.
function safeNext(v) {
  return typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') ? v : '/';
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function loginPage(next, failed) {
  const html = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Jeopardy – Passwort</title>
  <script>try{document.documentElement.dataset.theme=localStorage.getItem("jeopardy.theme")||"graphit"}catch(e){}</script>
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <main class="home">
    <h1 class="logo">JEOPARDY<span>!</span></h1>
    <p class="tagline">Privates Spiel – bitte Passwort eingeben.</p>
    <div class="card">
      <h2>Passwort</h2>
      <form class="row" method="post" action="${LOGIN_PATH}">
        <input type="hidden" name="next" value="${escapeHtml(next)}">
        <input id="password" name="password" type="password" placeholder="Passwort" autocomplete="current-password" required autofocus>
        <button class="primary" type="submit">Weiter</button>
      </form>
      ${failed ? '<p class="hint" role="alert">Falsches Passwort.</p>' : ''}
    </div>
  </main>
</body>
</html>`;
  return new Response(html, {
    status: failed ? 401 : 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
}

/**
 * Returns a Response to short-circuit the request, or undefined to let it through.
 * @param {Request} request
 * @param {string | undefined} password
 */
export async function gate(request, password) {
  const url = new URL(request.url);
  if (PUBLIC_PREFIXES.some((p) => url.pathname.startsWith(p))) return undefined;
  if (!password) return new Response('JEOPARDY_PASSWORD ist nicht gesetzt.', { status: 500 });
  const expected = await tokenFor(password);

  if (url.pathname === LOGIN_PATH && request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    const given = form ? String(form.get('password') || '') : '';
    const next = safeNext(form ? String(form.get('next') || '/') : '/');
    if (!safeEqual(await tokenFor(given), expected)) return loginPage(next, true);
    return new Response(null, {
      status: 303,
      headers: {
        location: next,
        'set-cookie': `${COOKIE}=${expected}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
        'cache-control': 'no-store',
      },
    });
  }

  if (safeEqual(readCookie(request, COOKIE), expected)) return undefined;
  if (url.pathname.startsWith('/api/')) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  return loginPage(safeNext(url.pathname + url.search), false);
}

export default function middleware(request) {
  return gate(request, process.env.JEOPARDY_PASSWORD);
}
