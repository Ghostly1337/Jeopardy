// Eigener Server (z. B. Netcup + Coolify) statt Vercel: liefert die Seite aus, prüft das
// Passwort wie die Vercel-Middleware, stellt /api/login, /api/sets und /api/relay bereit
// und dazu das schnelle WebSocket-Relay unter /api/ws (lib/ws-hub.mjs).
//
// Umgebungsvariablen:
//   JEOPARDY_PASSWORD        Seitenpasswort (Pflicht)
//   JEOPARDY_HOST_PASSWORD   Host-Passwort für die Fragensets
//   JEOPARDY_GAME_PASSWORD   Spielleiter-Passwort (optional)
//   DATABASE_URL             Postgres für Fragensets und Passwort-Sperre (ohne: Sets aus, Sperre im Speicher)
//   PORT                     Standard 3000
//   TRUST_PROXY=1            Nur hinter einem Proxy setzen, der X-Real-IP/X-Forwarded-For selbst setzt
//                            (Coolify/Traefik). Ohne: IP kommt aus der Verbindung, Kopfzeilen werden ignoriert.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { gate } from './middleware.js';
import { handleLogin } from './lib/login-core.mjs';
import { handleSets, pgSetStore, LIMITS as SET_LIMITS } from './lib/sets-core.mjs';
import { handleRelay } from './lib/relay-core.mjs';
import { memoryStore } from './lib/relay-stores.mjs';
import { memoryThrottle, pgThrottle } from './lib/throttle.mjs';
import { createHub, WS_LIMITS } from './lib/ws-hub.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// Strengere CSP zunächst nur im Test-Modus (Report-Only): Verstöße werden gemeldet, nicht blockiert.
// Ausnahmen: Fragen laden Bilder/Audio/Video von https-Links oder als data:/blob:; PeerJS für den
// WebRTC-Modus; Inline-Styles für Teamfarben/Animationen. Skripte nur von der eigenen Seite.
export const CSP_STRICT = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' https: data: blob:; media-src 'self' https: data: blob:; font-src 'self'; " +
  "connect-src 'self' https://0.peerjs.com wss://0.peerjs.com; object-src 'none'; base-uri 'none'; " +
  "form-action 'self'; frame-ancestors 'none'";
export const CSP_REPORT_PATH = '/api/csp-report';

export const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-robots-tag': 'noindex',
  'x-frame-options': 'DENY',
  'content-security-policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
  'content-security-policy-report-only': `${CSP_STRICT}; report-uri ${CSP_REPORT_PATH}`,
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'cross-origin-opener-policy': 'same-origin',
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
};

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

const MAX_BODY = SET_LIMITS.maxBodyBytes + 100_000;

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Kopfzeilen der Anfrage; ohne TRUST_PROXY zählt nur die echte Verbindungs-IP. */
function requestHeaders(req, trustProxy) {
  const h = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue;
    h.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  if (!trustProxy) {
    h.delete('x-forwarded-for');
    h.set('x-real-ip', req.socket.remoteAddress || 'unknown');
  }
  return h;
}

function writeResponse(res, response, body) {
  const headers = { ...SECURITY_HEADERS };
  response.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(response.status, headers);
  res.end(body);
}

async function sendResponse(res, response) {
  writeResponse(res, response, Buffer.from(await response.arrayBuffer()));
}

function json(res, status, obj, extra = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify(obj));
}

function serveStatic(req, res, pathname) {
  let p = pathname;
  if (p === '/' || p === '') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT + path.sep)) return json(res, 404, { error: 'not found' });
  let st;
  try { st = fs.statSync(file); } catch (e) { st = null; }
  if (!st || !st.isFile()) {
    res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    return res.end('Not found');
  }
  const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = {
    ...SECURITY_HEADERS,
    'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
    // Immer neu prüfen lassen (304 bei unverändert) – APP_VERSION lädt Handys sowieso neu
    'cache-control': 'no-cache',
    etag,
  };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  res.writeHead(200, { ...headers, 'content-length': st.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// CSP-Meldungen ins Server-Log (Coolify → Logs). Nur die nötigen Felder, Adressen ohne Query
// (könnte Daten enthalten), gekürzt; höchstens 60 Zeilen pro Minute, damit niemand das Log flutet.
const cspLog = { minute: 0, count: 0 };
const cspShort = (v) => {
  if (typeof v !== 'string') return '';
  const t = v.replace(/[\r\n\t]/g, ' ');
  try { const u = new URL(t); return (u.origin === 'null' ? u.protocol : u.origin + u.pathname).slice(0, 120); } catch (e) { return t.slice(0, 60); }
};
export function logCspReport(text, headers, now = Date.now(), log = console.warn) {
  const minute = Math.floor(now / 60_000);
  if (cspLog.minute !== minute) { cspLog.minute = minute; cspLog.count = 0; }
  if (++cspLog.count > 60) return false;
  let r;
  try { r = JSON.parse(text)['csp-report']; } catch (e) { r = null; }
  if (!r || typeof r !== 'object') return false;
  const ua = String((headers && headers.get && headers.get('user-agent')) || '');
  const device = /Mobile|Android|iPhone|iPad/.test(ua) ? 'Handy' : 'PC';
  log(`CSP-Verstoß (Test-Modus): ${cspShort(r['effective-directive'] || r['violated-directive'])} ` +
    `blockiert=${cspShort(r['blocked-uri'])} seite=${cspShort(r['document-uri'])} quelle=${cspShort(r['source-file'])}:${Number(r['line-number']) || 0} gerät=${device}`);
  return true;
}

/**
 * Startet den Server. Für Tests: port 0, eigene Umgebung, gibt { server, port, hub, close } zurück.
 */
export async function startServer({
  port = Number(process.env.PORT) || 3000,
  host = '0.0.0.0',
  env = process.env,
  query = null,
} = {}) {
  const password = env.JEOPARDY_PASSWORD;
  const hostPassword = env.JEOPARDY_HOST_PASSWORD;
  const gamePassword = env.JEOPARDY_GAME_PASSWORD;
  const trustProxy = env.TRUST_PROXY === '1';

  let db = query;
  let pool = null;
  if (!db && env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 5 });
    pool.on('error', (e) => console.error('db pool error', e.message));
    db = async (text, params) => (await pool.query(text, params)).rows;
  }
  const throttle = db ? pgThrottle(db) : memoryThrottle();
  const setStore = db ? pgSetStore(db) : null;
  const relayStore = memoryStore(); // HTTP-Relay nur als Notlösung; WebSocket ist der Normalfall
  const hub = createHub({ gamePassword, hostPassword, throttle });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const headers = requestHeaders(req, trustProxy);
      const isPost = req.method === 'POST';
      // Passwort-Sperre und erlaubte Pfade – derselbe Code wie auf Vercel (middleware.js)
      const blocked = await gate(new Request(new URL(req.url, 'http://localhost'), { method: req.method, headers }), password);
      if (blocked) return sendResponse(res, blocked);

      if (url.pathname === '/api/login') {
        const raw = isPost ? await readBody(req, 10_000) : Buffer.alloc(0);
        const form = isPost ? new URLSearchParams(raw.toString('utf8')) : null;
        const r = await handleLogin({ method: req.method, headers, form }, { password, throttle });
        res.writeHead(r.status, { ...SECURITY_HEADERS, ...r.headers });
        return res.end(r.body ?? '');
      }
      if (url.pathname === '/api/sets') {
        const raw = isPost ? (await readBody(req, MAX_BODY)).toString('utf8') : '';
        const r = await handleSets({ method: req.method, query: url.searchParams, headers, rawBody: raw }, setStore, hostPassword, throttle);
        return json(res, r.status, r.json, r.headers);
      }
      if (url.pathname === '/api/relay') {
        const raw = isPost ? (await readBody(req, 3_100_000)).toString('utf8') : '';
        const r = await handleRelay({ method: req.method, query: url.searchParams, headers, rawBody: raw }, relayStore,
          { gamePassword, hostPassword, throttle, ws: true });
        return json(res, r.status, r.json, r.headers);
      }
      if (url.pathname === CSP_REPORT_PATH) {
        if (!isPost) return json(res, 405, { error: 'method not allowed' });
        const raw = await readBody(req, 16_000);
        logCspReport(raw.toString('utf8'), headers);
        res.writeHead(204, { ...SECURITY_HEADERS, 'cache-control': 'no-store' });
        return res.end();
      }
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
      return serveStatic(req, res, url.pathname);
    } catch (e) {
      if (e && e.status === 413) return json(res, 413, { error: 'body too large' });
      console.error('request failed', e);
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
      else res.destroy();
    }
  });
  server.headersTimeout = 20_000;
  server.requestTimeout = 60_000;

  attachWs(server, hub, async (req) => {
    const headers = requestHeaders(req, trustProxy);
    // Nur Seiten dieses Servers dürfen die Verbindung öffnen (Schutz gegen fremde Webseiten)
    const origin = req.headers.origin;
    const hostHeader = req.headers['x-forwarded-host'] && trustProxy ? req.headers['x-forwarded-host'] : req.headers.host;
    try {
      if (!origin || new URL(origin).host !== hostHeader) return { status: 403 };
    } catch (e) { return { status: 403 }; }
    const blocked = await gate(new Request(new URL(req.url, 'http://localhost'), { headers }), password);
    if (blocked) return { status: blocked.status === 404 ? 404 : 401 };
    return { headers };
  });

  await new Promise((r) => server.listen(port, host, r));
  const close = async () => {
    await new Promise((r) => server.close(r));
    server.closeAllConnections?.();
    if (pool) await pool.end();
  };
  return { server, port: server.address().port, hub, close };
}

/**
 * Hängt das WebSocket-Relay an einen HTTP-Server (auch von den Browser-Tests genutzt).
 * authorize(req) → { headers } zum Annehmen oder { status } zum Ablehnen.
 */
export function attachWs(server, hub, authorize) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_LIMITS.maxFrameBytes, perMessageDeflate: false });
  const alive = new WeakMap();
  server.on('upgrade', async (req, socket, head) => {
    const reject = (status) => {
      socket.write(`HTTP/1.1 ${status} ${http.STATUS_CODES[status] || ''}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    try {
      if (new URL(req.url, 'http://localhost').pathname !== '/api/ws') return reject(404);
      const auth = await authorize(req);
      if (auth.status) return reject(auth.status);
      wss.handleUpgrade(req, socket, head, async (ws) => {
        alive.set(ws, true);
        ws.on('pong', () => alive.set(ws, true));
        // Nachrichten, die schon vor dem Anmelden der Verbindung im Hub eintreffen, nicht verlieren
        let ready = false;
        const early = [];
        ws.on('message', (data, isBinary) => {
          if (isBinary) return ws.close(4400, 'text only');
          const text = data.toString('utf8');
          if (ready) hub.message(ws, text);
          else if (early.length < 5) early.push(text);
        });
        let gone = false;
        ws.on('close', () => { gone = true; hub.closed(ws); });
        ws.on('error', () => {});
        if (!(await hub.open(ws, auth.headers))) return;
        if (gone) return hub.closed(ws);
        ready = true;
        early.splice(0).forEach((t) => hub.message(ws, t));
      });
    } catch (e) {
      console.error('upgrade failed', e);
      reject(500);
    }
  });
  // Tote Verbindungen erkennen (Ping/Pong) und Lebenszeichen an die Browser schicken
  const timer = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!alive.get(ws)) return ws.terminate();
      alive.set(ws, false);
      try { ws.ping(); } catch (e) {}
    });
    hub.keepalive();
    hub.cleanup();
  }, WS_LIMITS.keepaliveMs);
  timer.unref?.();
  server.on('close', () => { clearInterval(timer); wss.clients.forEach((ws) => ws.terminate()); });
  return wss;
}

// Direkt gestartet (node server.mjs): Server hochfahren
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.JEOPARDY_PASSWORD) {
    console.error('JEOPARDY_PASSWORD fehlt – Server startet nicht ohne Seitenpasswort.');
    process.exit(1);
  }
  const { port } = await startServer();
  console.log(`Jeopardy läuft auf Port ${port}`);
  const stop = () => process.exit(0);
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
