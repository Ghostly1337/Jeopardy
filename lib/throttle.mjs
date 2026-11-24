// Sperre gegen das Durchprobieren von Passwörtern (Seite, Host, Spielleiter) und einfache Raten-Limits.
//
// attempt(key) wird VOR der Passwortprüfung gezählt (auch parallele Versuche zählen),
// reset(key) nach einem richtigen Passwort. Nach LIMIT Versuchen in WINDOW_MS ist der Schlüssel
// gesperrt (429 + Retry-After); jede weitere Sperre verdoppelt die Wartezeit (60 s, 120 s … max. 15 min).
// Schlüssel = Bereich + gekürzter SHA-256 der IP – es werden keine IP-Adressen gespeichert.
//
// pgThrottle speichert in der Datenbank (gilt über alle Server-Instanzen), memoryThrottle im Speicher
// (Tests, lokal). rate() ist ein reines Speicher-Limit pro Instanz für Nachrichtenfluten – bewusst
// ohne Datenbank, damit nicht jede Spieler-Nachricht zusätzliche Last erzeugt.

export const THROTTLE = {
  limit: 5,
  windowMs: 60_000,
  lockBaseMs: 60_000,
  lockMaxMs: 15 * 60_000,
  forgetMs: 60 * 60_000,
};

export const lockMs = (level) => Math.min(THROTTLE.lockMaxMs, THROTTLE.lockBaseMs * 2 ** Math.max(0, level - 1));

const hex = (buf, n) => [...new Uint8Array(buf)].slice(0, n).map((b) => b.toString(16).padStart(2, '0')).join('');

/** Pseudonymer Schlüssel aus Bereich + IP (Vercel setzt x-real-ip / x-forwarded-for). */
export async function clientKey(scope, headers) {
  const h = (n) => (headers && headers.get ? headers.get(n) : null) || '';
  const ip = (h('x-real-ip') || h('x-forwarded-for').split(',')[0] || 'unknown').trim().slice(0, 100);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('jeopardy-throttle:' + ip));
  return scope + ':' + hex(hash, 16);
}

// Gemeinsame Logik für einen Zustand { count, start, lockedUntil, level, last }
function step(r, t) {
  if (r && t - r.last > THROTTLE.forgetMs) r = null;
  if (!r) r = { count: 0, start: t, lockedUntil: 0, level: 0, last: t };
  if (r.lockedUntil > t) return { r, res: { allowed: false, retryAfter: Math.ceil((r.lockedUntil - t) / 1000) } };
  if (t - r.start > THROTTLE.windowMs) { r.count = 0; r.start = t; }
  r.count++;
  r.last = t;
  if (r.count > THROTTLE.limit) {
    r.level++;
    r.count = 0;
    r.lockedUntil = t + lockMs(r.level);
    return { r, res: { allowed: false, retryAfter: Math.ceil(lockMs(r.level) / 1000) } };
  }
  return { r, res: { allowed: true } };
}

export function memoryThrottle({ now = () => Date.now() } = {}) {
  const rows = new Map();
  return {
    async attempt(key) {
      const { r, res } = step(rows.get(key), now());
      rows.set(key, r);
      if (rows.size > 10_000) for (const [k, v] of rows) if (now() - v.last > THROTTLE.forgetMs) rows.delete(k);
      return res;
    },
    async reset(key) { rows.delete(key); },
    _rows: rows,
  };
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS jeop_throttle (
  key text PRIMARY KEY,
  state text NOT NULL,
  updated timestamptz NOT NULL DEFAULT now()
)`;

/**
 * Datenbank-Variante: ein Versuch = Zeile lesen und schreiben. Gleichzeitige Versuche können
 * sich überholen und ein, zwei Versuche mehr durchlassen – an der Sperre nach wenigen Versuchen
 * ändert das nichts.
 */
export function pgThrottle(query, { now = () => Date.now() } = {}) {
  let ready = null;
  let lastCleanup = 0;
  const init = () => (ready ??= query(SCHEMA, []).catch((e) => { ready = null; throw e; }));
  return {
    async attempt(key) {
      await init();
      const rows = await query('SELECT state FROM jeop_throttle WHERE key = $1', [key]);
      let prev = null;
      try { prev = rows.length ? JSON.parse(rows[0].state) : null; } catch (e) { prev = null; }
      const { r, res } = step(prev, now());
      await query(
        `INSERT INTO jeop_throttle (key, state, updated) VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET state = EXCLUDED.state, updated = now()`, [key, JSON.stringify(r)]);
      if (now() - lastCleanup > 10 * 60_000) {
        lastCleanup = now();
        query('DELETE FROM jeop_throttle WHERE updated < now() - make_interval(secs => $1)', [THROTTLE.forgetMs / 1000])
          .catch((e) => console.error('throttle cleanup failed', e));
      }
      return res;
    },
    async reset(key) {
      await init();
      await query('DELETE FROM jeop_throttle WHERE key = $1', [key]);
    },
  };
}

/** Raten-Limit im Speicher (fester Zeitraum): true = erlaubt. */
export function rateLimiter({ now = () => Date.now() } = {}) {
  const hits = new Map();
  return function rate(key, limit, windowMs, weight = 1) {
    const t = now();
    let r = hits.get(key);
    if (!r || t - r.start >= windowMs) { r = { count: 0, start: t }; hits.set(key, r); }
    r.count += weight;
    if (hits.size > 20_000) for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
    return r.count <= limit;
  };
}

/** Passwortprüfung mit Sperre: { ok } oder { ok: false, status: 401|429, retryAfter? } */
export async function guardedCheck(throttle, key, check) {
  if (!throttle) return (await check()) ? { ok: true } : { ok: false, status: 401 };
  const a = await throttle.attempt(key);
  if (!a.allowed) return { ok: false, status: 429, retryAfter: a.retryAfter };
  if (await check()) { await throttle.reset(key); return { ok: true }; }
  return { ok: false, status: 401 };
}
