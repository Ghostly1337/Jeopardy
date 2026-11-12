// Storage backends for the relay: Postgres (Neon, production) and in-memory (tests, local dev).
// Both implement the same interface used by relay-core.mjs.

const HOST_ONLINE_MS = 20_000;     // host counts as online if it polled within this window
const HOST_TAKEOVER_MS = 60_000;   // another token may claim a room after the host is gone this long
const MSG_TTL_MS = 10 * 60_000;    // messages are only needed for live delivery
const ROOM_TTL_MS = 2 * 24 * 3600_000;
const CLEANUP_EVERY_MS = 60_000;

export function memoryStore({ now = () => Date.now() } = {}) {
  const rooms = new Map(); // room -> { token, seq, seen, msgs: [{ seq, dir, target, body, ts }] }

  function cleanup() {
    const t = now();
    for (const [name, r] of rooms) {
      if (t - r.seen > ROOM_TTL_MS) rooms.delete(name);
      else r.msgs = r.msgs.filter((m) => t - m.ts < MSG_TTL_MS);
    }
  }

  return {
    async claimHost(room, token) {
      const r = rooms.get(room);
      if (r && r.token !== token && now() - r.seen < HOST_TAKEOVER_MS) return false;
      if (r) Object.assign(r, { token, seen: now() });
      else rooms.set(room, { token, seq: 0, seen: now(), msgs: [] });
      return true;
    },
    async checkHost(room, token, touch = false) {
      const r = rooms.get(room);
      if (!r || r.token !== token) return false;
      if (touch) r.seen = now();
      return true;
    },
    async roomInfo(room) {
      const r = rooms.get(room);
      return r ? { seq: r.seq, hostOnline: now() - r.seen < HOST_ONLINE_MS } : null;
    },
    async latestSeq(room) {
      return rooms.get(room)?.seq ?? 0;
    },
    async append(room, rows) {
      const r = rooms.get(room);
      if (!r) return null;
      for (const row of rows) r.msgs.push({ ...row, seq: ++r.seq, ts: now() });
      return r.seq;
    },
    async read(room, { dir, peer, after, upTo, limit }) {
      const r = rooms.get(room);
      if (!r) return [];
      return r.msgs
        .filter((m) => m.seq > after && m.seq <= upTo && m.dir === dir
          && (peer == null || m.target == null || m.target === peer))
        .slice(0, limit);
    },
    maybeCleanup: cleanup,
    _rooms: rooms,
  };
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS jeop_rooms (
     room text PRIMARY KEY,
     token text NOT NULL,
     seq bigint NOT NULL DEFAULT 0,
     seen timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS jeop_msgs (
     room text NOT NULL,
     seq bigint NOT NULL,
     dir char(1) NOT NULL,
     target text,
     body text NOT NULL,
     ts timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (room, seq)
   )`,
  'CREATE INDEX IF NOT EXISTS jeop_msgs_ts ON jeop_msgs (ts)',
];

/**
 * Postgres store. `query(text, params)` must return an array of row objects
 * (e.g. neon(url).query from @neondatabase/serverless).
 */
export function pgStore(query) {
  let ready = null;
  let lastCleanup = 0;
  const init = () => (ready ??= (async () => {
    for (const s of SCHEMA) await query(s, []);
  })().catch((e) => { ready = null; throw e; }));
  const q = async (text, params) => { await init(); return query(text, params); };

  return {
    async claimHost(room, token) {
      const rows = await q(
        `INSERT INTO jeop_rooms (room, token) VALUES ($1, $2)
         ON CONFLICT (room) DO UPDATE SET token = EXCLUDED.token, seen = now()
         WHERE jeop_rooms.token = EXCLUDED.token
            OR jeop_rooms.seen < now() - make_interval(secs => $3)
         RETURNING room`, [room, token, HOST_TAKEOVER_MS / 1000]);
      return rows.length === 1;
    },
    async checkHost(room, token, touch = false) {
      const rows = touch
        ? await q('UPDATE jeop_rooms SET seen = now() WHERE room = $1 AND token = $2 RETURNING room', [room, token])
        : await q('SELECT room FROM jeop_rooms WHERE room = $1 AND token = $2', [room, token]);
      return rows.length === 1;
    },
    async roomInfo(room) {
      const rows = await q(
        `SELECT seq, seen > now() - make_interval(secs => $2) AS online FROM jeop_rooms WHERE room = $1`,
        [room, HOST_ONLINE_MS / 1000]);
      return rows.length ? { seq: Number(rows[0].seq), hostOnline: rows[0].online === true } : null;
    },
    async latestSeq(room) {
      const rows = await q('SELECT seq FROM jeop_rooms WHERE room = $1', [room]);
      return rows.length ? Number(rows[0].seq) : 0;
    },
    // One statement: the row lock on jeop_rooms serialises writers per room,
    // so sequence numbers become visible in order and readers never skip one.
    async append(room, rows) {
      const res = await q(
        `WITH r AS (
           UPDATE jeop_rooms SET seq = seq + $2 WHERE room = $1 RETURNING seq
         ), ins AS (
           INSERT INTO jeop_msgs (room, seq, dir, target, body)
           SELECT $1, r.seq - $2 + m.ord, m.el->>'dir', m.el->>'target', m.el->>'body'
           FROM r, jsonb_array_elements($3::jsonb) WITH ORDINALITY AS m(el, ord)
         )
         SELECT seq FROM r`, [room, rows.length, JSON.stringify(rows)]);
      return res.length ? Number(res[0].seq) : null;
    },
    async read(room, { dir, peer, after, upTo, limit }) {
      return q(
        `SELECT seq, target, body FROM jeop_msgs
         WHERE room = $1 AND seq > $2 AND seq <= $3 AND dir = $4
           AND ($5::text IS NULL OR target IS NULL OR target = $5)
         ORDER BY seq LIMIT $6`, [room, after, upTo, dir, peer, limit]);
    },
    maybeCleanup() {
      if (Date.now() - lastCleanup < CLEANUP_EVERY_MS) return;
      lastCleanup = Date.now();
      q('DELETE FROM jeop_msgs WHERE ts < now() - make_interval(secs => $1)', [MSG_TTL_MS / 1000])
        .then(() => q('DELETE FROM jeop_rooms WHERE seen < now() - make_interval(secs => $1)', [ROOM_TTL_MS / 1000]))
        .catch((e) => console.error('relay cleanup failed', e));
    },
  };
}
