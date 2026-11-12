// Fragensets auf dem Server (Vercel + Postgres), damit der Host zwischen Sets wechseln kann,
// ohne JSON-Dateien zu importieren.
//
// Schutz: Die Seite selbst ist hinter JEOPARDY_PASSWORD (das kennen auch die Spieler).
// Fragensets enthalten Antworten – deshalb braucht jede Anfrage zusätzlich das Host-Passwort
// (JEOPARDY_HOST_PASSWORD) im Header `x-host-password`.

export const LIMITS = {
  maxBodyBytes: 4_000_000, // Vercel erlaubt 4,5 MB pro Anfrage; Sets mit Bildern sind meist < 1 MB
  maxNameLength: 60,
  maxSets: 100,
};

const ID_RE = /^[a-z0-9]{8,32}$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function sha256(text) {
  const data = new TextEncoder().encode('jeopardy-host:' + text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Vergleich über Hashes gleicher Länge, Laufzeit unabhängig vom Inhalt
async function passwordOk(given, expected) {
  if (typeof given !== 'string' || !given) return false;
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cleanName(v) {
  const n = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if (!n) throw new HttpError(400, 'name missing');
  return n.slice(0, LIMITS.maxNameLength);
}

function setId(v) {
  if (typeof v !== 'string' || !ID_RE.test(v)) throw new HttpError(400, 'invalid id');
  return v;
}

function newId() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return [...a].map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

// Fragenset grob prüfen (die genaue Normalisierung macht der Browser mit J.normalizeSet)
function checkData(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.rounds)) throw new HttpError(400, 'invalid set');
  return d;
}

/**
 * @param {{ method: string, query: URLSearchParams, headers: { get(name: string): string|null }, rawBody: string }} req
 * @param {object|null} store Speicher (memorySetStore/pgSetStore unten) oder null, wenn keine Datenbank da ist
 * @param {string|undefined} hostPassword Wert von JEOPARDY_HOST_PASSWORD
 */
export async function handleSets(req, store, hostPassword) {
  try {
    const op = req.query.get('op');
    // Ohne Datenbank oder Host-Passwort: Browser nutzt die lokale Set-Liste
    if (!store || !hostPassword) throw new HttpError(503, 'sets not configured');
    if (!(await passwordOk(req.headers.get('x-host-password'), hostPassword))) {
      throw new HttpError(401, 'wrong host password');
    }

    if (op === 'check') return { status: 200, json: { ok: true } };
    if (op === 'list') return { status: 200, json: { sets: await store.list() } };
    if (op === 'get') {
      const set = await store.get(setId(req.query.get('id')));
      if (!set) throw new HttpError(404, 'set not found');
      return { status: 200, json: set };
    }

    if (req.method !== 'POST') throw new HttpError(405, 'use POST');
    if (req.rawBody.length > LIMITS.maxBodyBytes) throw new HttpError(413, 'set too large');
    let p;
    try { p = JSON.parse(req.rawBody || '{}'); } catch { throw new HttpError(400, 'invalid json'); }

    if (op === 'save') {
      const name = cleanName(p.name);
      const data = checkData(p.data);
      let id = p.id == null ? null : setId(p.id);
      if (!id) {
        if ((await store.count()) >= LIMITS.maxSets) throw new HttpError(409, 'too many sets');
        id = newId();
      }
      const updated = await store.save(id, name, JSON.stringify(data));
      return { status: 200, json: { ok: true, id, updated } };
    }
    if (op === 'rename') {
      const ok = await store.rename(setId(p.id), cleanName(p.name));
      if (!ok) throw new HttpError(404, 'set not found');
      return { status: 200, json: { ok: true } };
    }
    if (op === 'delete') {
      await store.remove(setId(p.id));
      return { status: 200, json: { ok: true } };
    }
    throw new HttpError(404, 'unknown op');
  } catch (err) {
    if (err instanceof HttpError) return { status: err.status, json: { error: err.message } };
    console.error('sets error', err);
    return { status: 500, json: { error: 'internal error' } };
  }
}

// ---------- Speicher ----------

export function memorySetStore() {
  const sets = new Map(); // id -> { name, body, updated }
  let clock = 0;
  return {
    async list() {
      return [...sets].map(([id, s]) => ({ id, name: s.name, updated: s.updated }))
        .sort((a, b) => a.name.localeCompare(b.name, 'de'));
    },
    async get(id) {
      const s = sets.get(id);
      return s ? { id, name: s.name, updated: s.updated, data: JSON.parse(s.body) } : null;
    },
    async count() { return sets.size; },
    async save(id, name, body) {
      const updated = new Date(Date.now() + clock++).toISOString();
      sets.set(id, { name, body, updated });
      return updated;
    },
    async rename(id, name) {
      const s = sets.get(id);
      if (!s) return false;
      s.name = name;
      return true;
    },
    async remove(id) { sets.delete(id); },
  };
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS jeop_sets (
  id text PRIMARY KEY,
  name text NOT NULL,
  body text NOT NULL,
  updated timestamptz NOT NULL DEFAULT now()
)`;

/** Postgres-Speicher. `query(text, params)` liefert Zeilen-Objekte (z. B. neon(url).query). */
export function pgSetStore(query) {
  let ready = null;
  const q = async (text, params) => {
    await (ready ??= query(SCHEMA, []).catch((e) => { ready = null; throw e; }));
    return query(text, params);
  };
  const iso = (v) => (v instanceof Date ? v.toISOString() : String(v));
  return {
    async list() {
      const rows = await q('SELECT id, name, updated FROM jeop_sets ORDER BY lower(name)', []);
      return rows.map((r) => ({ id: r.id, name: r.name, updated: iso(r.updated) }));
    },
    async get(id) {
      const rows = await q('SELECT id, name, body, updated FROM jeop_sets WHERE id = $1', [id]);
      return rows.length ? { id: rows[0].id, name: rows[0].name, updated: iso(rows[0].updated), data: JSON.parse(rows[0].body) } : null;
    },
    async count() {
      const rows = await q('SELECT count(*)::int AS n FROM jeop_sets', []);
      return rows[0].n;
    },
    async save(id, name, body) {
      const rows = await q(
        `INSERT INTO jeop_sets (id, name, body) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, body = EXCLUDED.body, updated = now()
         RETURNING updated`, [id, name, body]);
      return iso(rows[0].updated);
    },
    async rename(id, name) {
      const rows = await q('UPDATE jeop_sets SET name = $2 WHERE id = $1 RETURNING id', [id, name]);
      return rows.length === 1;
    },
    async remove(id) { await q('DELETE FROM jeop_sets WHERE id = $1', [id]); },
  };
}
