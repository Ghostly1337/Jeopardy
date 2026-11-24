// Login für die ganze Seite (POST /api/login): Passwort prüfen – mit Sperre pro IP –, signiertes
// Cookie setzen und zurück zur gewünschten Seite. Fehler leiten zurück zur Login-Seite (/__login).
import { signSession, SESSION_MAX_AGE } from './session.mjs';
import { clientKey, guardedCheck } from './throttle.mjs';
import { passwordOk } from './host-auth.mjs';

export const COOKIE = 'jeop_auth';
export const LOGIN_PATH = '/__login';
export const LOGIN_LIMITS = { failDelayMs: 300 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Nur Pfade dieser Seite (kein //fremd.de, kein \\, keine Steuerzeichen) – sonst Startseite.
export function safeNext(v) {
  return typeof v === 'string' && v.length <= 2000 && /^\/(?![/\\])[^\s\\]*$/.test(v) ? v : '/';
}

function redirect(location, extra = {}) {
  return { status: 303, headers: { location, 'cache-control': 'no-store', ...extra } };
}

/**
 * @param {{ method: string, headers: Headers, form: URLSearchParams|FormData|null }} req
 * @param {{ password?: string, throttle?: object }} opts
 */
export async function handleLogin(req, { password, throttle } = {}) {
  if (req.method !== 'POST') return redirect(LOGIN_PATH);
  if (!password) return { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: 'JEOPARDY_PASSWORD ist nicht gesetzt.' };
  const form = req.form;
  const given = form ? String(form.get('password') || '') : '';
  const next = safeNext(form ? String(form.get('next') || '/') : '/');
  const back = (e, extra = '') => `${LOGIN_PATH}?e=${e}${extra}&next=${encodeURIComponent(next)}`;
  const key = await clientKey('login', req.headers);
  const res = await guardedCheck(throttle, key, () => passwordOk(given, password));
  if (res.status === 429) return redirect(back('locked', `&s=${res.retryAfter}`));
  if (!res.ok) {
    if (LOGIN_LIMITS.failDelayMs) await sleep(LOGIN_LIMITS.failDelayMs);
    return redirect(back('wrong'));
  }
  const token = await signSession(password);
  return redirect(next, { 'set-cookie': `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_MAX_AGE}; HttpOnly; Secure; SameSite=Lax` });
}
