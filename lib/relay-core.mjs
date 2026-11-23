import { anyPasswordOk } from './host-auth.mjs';
// HTTP relay replacing the WebRTC connection when the game runs on Vercel.
// The host's browser stays the single source of truth; this relay only forwards messages:
//   host → players  (dir 'p', target = connection id or null for "everyone")
//   player → host   (dir 'h', target = sending connection id)
// Every room has a strictly increasing sequence number, so clients read with a cursor
// ("give me everything after seq N") and long-poll for new messages.

export const LIMITS = {
  maxBodyBytes: 3_000_000, // whole request (Vercel limit is 4.5 MB)
  maxMsgsPerSend: 100,
  maxWaitMs: 9000,
  pollStepMs: 120,
  readLimit: 200,
  maxReplyChars: 3_500_000, // Antwort unter Vercels 4,5-MB-Grenze halten (Clips sind groß)
  failDelayMs: 800, // bremst das Durchprobieren des Spielleiter-Passworts
};

const ROOM_RE = /^[A-Z0-9]{4,12}$/;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function room(v) {
  const r = typeof v === 'string' ? v.trim().toUpperCase() : '';
  if (!ROOM_RE.test(r)) throw new HttpError(400, 'invalid room');
  return r;
}

function id(v, what) {
  if (typeof v !== 'string' || !ID_RE.test(v)) throw new HttpError(400, 'invalid ' + what);
  return v;
}

function int(v, fallback) {
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : fallback;
}

function rowsOut(rows) {
  return rows.map((r) => ({ seq: Number(r.seq), peer: r.target, body: JSON.parse(r.body) }));
}

// Host claims (or re-claims after a reload) its room with a secret token.
// With JEOPARDY_GAME_PASSWORD set, claiming needs the game password (or the host password)
// in the x-game-password header – otherwise every player with the site password could host
// or take over a room whose host went quiet.
async function opHost(store, p, ctx = {}) {
  const r = room(p.room);
  const token = id(p.token, 'token');
  if (ctx.gamePassword) {
    const given = ctx.headers && ctx.headers.get ? ctx.headers.get('x-game-password') : null;
    if (!(await anyPasswordOk(given, ctx.gamePassword, ctx.hostPassword))) {
      if (LIMITS.failDelayMs) await sleep(LIMITS.failDelayMs);
      throw new HttpError(401, 'game password required');
    }
  }
  const ok = await store.claimHost(r, token);
  if (!ok) throw new HttpError(409, 'room taken');
  store.maybeCleanup?.();
  return { ok: true, seq: await store.latestSeq(r) };
}

async function opSend(store, p) {
  const r = room(p.room);
  const list = Array.isArray(p.msgs) ? p.msgs : [];
  if (!list.length) return { ok: true };
  if (list.length > LIMITS.maxMsgsPerSend) throw new HttpError(413, 'too many messages');
  let rows;
  if (p.as === 'host') {
    if (!(await store.checkHost(r, id(p.token, 'token')))) throw new HttpError(403, 'not the host');
    rows = list.map((m) => ({
      dir: 'p',
      target: m.to == null ? null : id(m.to, 'target'),
      body: JSON.stringify(m.body ?? null),
    }));
  } else {
    const from = id(p.as, 'connection id');
    rows = list.map((m) => ({ dir: 'h', target: from, body: JSON.stringify(m.body ?? null) }));
  }
  const seq = await store.append(r, rows);
  if (seq == null) throw new HttpError(404, 'room not found');
  return { ok: true, seq };
}

async function opPoll(store, p) {
  const r = room(p.room);
  const isHost = p.as === 'host';
  const token = isHost ? id(p.token, 'token') : null;
  const peer = isHost ? null : id(p.as, 'connection id');
  const after = int(p.after, -1);
  const wait = Math.max(0, Math.min(LIMITS.maxWaitMs, int(p.wait, 0)));
  const deadline = Date.now() + wait;

  for (;;) {
    if (isHost && !(await store.checkHost(r, token, true))) throw new HttpError(403, 'not the host');
    const info = await store.roomInfo(r);
    if (!info) return { seq: 0, msgs: [], host: false };
    if (after < 0) return { seq: info.seq, msgs: [], host: info.hostOnline };
    if (info.seq > after) {
      const rows = await store.read(r, {
        dir: isHost ? 'h' : 'p', peer, after, upTo: info.seq, limit: LIMITS.readLimit,
      });
      // Cap the reply size: stop after the row that crosses maxReplyChars (at least one row);
      // the rest follows with the next poll.
      let chars = 0;
      let keep = rows.length;
      for (let i = 0; i < rows.length; i++) {
        chars += String(rows[i].body).length;
        if (chars > LIMITS.maxReplyChars && i > 0) { keep = i; break; }
      }
      const capped = keep < rows.length;
      const msgs = rowsOut(rows.slice(0, keep));
      // With a full or capped page the cursor stops at the last row returned; the rest follows next poll.
      const seq = rows.length >= LIMITS.readLimit || capped ? msgs[msgs.length - 1].seq : info.seq;
      if (msgs.length || Date.now() >= deadline) return { seq, msgs, host: info.hostOnline };
      // Only messages for other players arrived: move the cursor and keep waiting.
      return opPoll(store, { ...p, after: seq, wait: deadline - Date.now() });
    }
    if (Date.now() >= deadline) return { seq: info.seq, msgs: [], host: info.hostOnline };
    await sleep(LIMITS.pollStepMs);
  }
}

const OPS = { host: opHost, send: opSend, poll: opPoll };

/**
 * Framework-independent entry point.
 * @param {{ method: string, query: URLSearchParams, rawBody: string }} req
 * @param {object} store relay store (see relay-stores.mjs)
 * @returns {Promise<{ status: number, json: object }>}
 */
export async function handleRelay(req, store, auth = {}) {
  try {
    const op = req.query.get('op');
    // hostGate: Host-Pult soll gleich nach dem Spielleiter-Passwort fragen
    if (op === 'ping') return { status: 200, json: { ok: true, relay: true, hostGate: !!auth.gamePassword } };
    const fn = OPS[op];
    if (!fn) throw new HttpError(404, 'unknown op');
    if (req.method !== 'POST') throw new HttpError(405, 'use POST');
    if (req.rawBody.length > LIMITS.maxBodyBytes) throw new HttpError(413, 'body too large');
    let params;
    try {
      params = JSON.parse(req.rawBody || '{}');
    } catch {
      throw new HttpError(400, 'invalid json');
    }
    if (!params || typeof params !== 'object') throw new HttpError(400, 'invalid json');
    return { status: 200, json: await fn(store, params, { headers: req.headers, gamePassword: auth.gamePassword, hostPassword: auth.hostPassword }) };
  } catch (err) {
    if (err instanceof HttpError) return { status: err.status, json: { error: err.message } };
    console.error('relay error', err);
    return { status: 500, json: { error: 'internal error' } };
  }
}
