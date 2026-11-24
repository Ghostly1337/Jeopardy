// Signiertes Login-Cookie: v1.<ausgestellt>.<läuft ab>.<HMAC> (Zeiten in Sekunden).
// Der HMAC-Schlüssel wird aus dem Seitenpasswort abgeleitet: Passwort ändern = alle neu anmelden.
// Das Cookie verrät nichts über das Passwort und läuft nach MAX_AGE ab.
// middleware.js enthält eine eigene Kopie von verifySession (Vercel kompiliert die Middleware zu
// CommonJS, Importe aus ES-Modulen würden dort abstürzen); ein Test prüft, dass beide übereinstimmen.

export const SESSION_MAX_AGE = 30 * 24 * 3600; // 30 Tage
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hmac(password, payload) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('jeopardy-session-key:' + password));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSession(password, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const payload = `v1.${iat}.${iat + SESSION_MAX_AGE}`;
  return `${payload}.${await hmac(password, payload)}`;
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
