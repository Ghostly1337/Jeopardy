// Lasttest: ein Host und viele Spieler gleichzeitig – WebSocket-Relay gegen HTTP-Relay (Long-Polling).
// Startet server.mjs lokal (ohne Datenbank), meldet sich an und misst, wie lange Nachrichten brauchen:
//   Host → alle Spieler (Spielstand, alle 500 ms)   und   Spieler → Host (Buzz, alle 2 s je Spieler).
// Aufruf:  node tests/load/relay-load.mjs [spieler=30] [sekunden=20]
// Hinweis: Lokal fehlt die Datenbank-/Netzwerk-Latenz von Vercel + Neon. Die HTTP-Werte hier sind
// also eine Untergrenze – live waren sie deutlich schlechter.
import { WebSocket } from 'ws';
import { startServer } from '../../server.mjs';
import { connIdFor, LIMITS } from '../../lib/relay-core.mjs';
import { WS_LIMITS } from '../../lib/ws-hub.mjs';

const PLAYERS = Number(process.argv[2]) || 30;
const SECONDS = Number(process.argv[3]) || 20;
const PW = 'last-test';
LIMITS.ipMsgsPerMin = 1e9; // alle Testspieler kommen von 127.0.0.1
LIMITS.newRoomsPerHour = 1e9;
WS_LIMITS.ipMsgsPerMin = 1e9;
WS_LIMITS.newRoomsPerHour = 1e9;

const srv = await startServer({ port: 0, host: '127.0.0.1', env: { JEOPARDY_PASSWORD: PW } });
const base = `http://127.0.0.1:${srv.port}`;
const login = await fetch(base + '/api/login', {
  method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ password: PW }),
});
const cookie = login.headers.get('set-cookie').split(';')[0];

const rand = (n) => Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function stats(list) {
  if (!list.length) return { n: 0 };
  const s = [...list].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, p50: q(0.5).toFixed(1), p95: q(0.95).toFixed(1), max: s[s.length - 1].toFixed(1) };
}

// ---------- WebSocket ----------
function wsClient(hello) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/api/ws`, { headers: { cookie, origin: base } });
    ws.on('open', () => ws.send(JSON.stringify(hello)));
    ws.once('message', (d) => { const m = JSON.parse(String(d)); m.t === 'ok' ? resolve(ws) : reject(new Error(JSON.stringify(m))); });
    ws.on('error', reject);
  });
}

async function runWs() {
  const room = 'WS' + rand(4).toUpperCase();
  const toPlayers = [];
  const toHost = [];
  const host = await wsClient({ op: 'host', room, token: 'tok-' + rand(16) });
  host.on('message', (d) => {
    const m = JSON.parse(String(d));
    if (m.t === 'msgs') m.msgs.forEach((x) => { if (x.body && x.body.t === 'buzz') toHost.push(performance.now() - x.body.at); });
  });
  const players = [];
  for (let i = 0; i < PLAYERS; i++) {
    const ws = await wsClient({ op: 'join', room, key: rand(32) });
    ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m.t === 'msgs') m.msgs.forEach((x) => { if (x.body && x.body.t === 'state') toPlayers.push(performance.now() - x.body.at); });
    });
    players.push(ws);
  }
  const end = performance.now() + SECONDS * 1000;
  const state = setInterval(() => host.send(JSON.stringify({ op: 'send', msgs: [{ to: null, body: { t: 'state', at: performance.now(), pad: 'x'.repeat(4000) } }] })), 500);
  const buzz = players.map((ws, i) => setTimeout(function tick() {
    if (performance.now() > end) return;
    ws.send(JSON.stringify({ op: 'send', msgs: [{ body: { t: 'buzz', at: performance.now() } }] }));
    setTimeout(tick, 2000);
  }, (i * 2000) / PLAYERS));
  await sleep(SECONDS * 1000 + 500);
  clearInterval(state);
  buzz.forEach(clearTimeout);
  players.forEach((ws) => ws.close());
  host.close();
  return { toPlayers: stats(toPlayers), toHost: stats(toHost) };
}

// ---------- HTTP-Relay (Long-Polling wie auf Vercel) ----------
async function api(op, body) {
  const res = await fetch(`${base}/api/relay?op=${op}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

async function runHttp() {
  const room = 'HT' + rand(4).toUpperCase();
  const token = 'tok-' + rand(16);
  const toPlayers = [];
  const toHost = [];
  let stop = false;
  let hostCursor = (await api('host', { room, token })).seq;
  (async () => {
    while (!stop) {
      const r = await api('poll', { room, as: 'host', token, after: hostCursor, wait: 8000 });
      hostCursor = r.seq;
      (r.msgs || []).forEach((m) => { if (m.body && m.body.t === 'buzz') toHost.push(performance.now() - m.body.at); });
    }
  })();
  const players = [];
  for (let i = 0; i < PLAYERS; i++) {
    const key = rand(32);
    const as = await connIdFor(key);
    const p = { key, as, cursor: (await api('poll', { room, as, key, after: -1, wait: 0 })).seq };
    players.push(p);
    (async () => {
      while (!stop) {
        const r = await api('poll', { room, as, key, after: p.cursor, wait: 8000 });
        p.cursor = r.seq;
        (r.msgs || []).forEach((m) => { if (m.body && m.body.t === 'state') toPlayers.push(performance.now() - m.body.at); });
      }
    })();
  }
  const end = performance.now() + SECONDS * 1000;
  const state = setInterval(() => api('send', { room, as: 'host', token, msgs: [{ to: null, body: { t: 'state', at: performance.now(), pad: 'x'.repeat(4000) } }] }), 500);
  const buzz = players.map((p, i) => setTimeout(function tick() {
    if (performance.now() > end) return;
    api('send', { room, as: p.as, key: p.key, msgs: [{ body: { t: 'buzz', at: performance.now() } }] });
    setTimeout(tick, 2000);
  }, (i * 2000) / PLAYERS));
  await sleep(SECONDS * 1000 + 500);
  stop = true;
  clearInterval(state);
  buzz.forEach(clearTimeout);
  return { toPlayers: stats(toPlayers), toHost: stats(toHost) };
}

console.log(`Lasttest: 1 Host + ${PLAYERS} Spieler, ${SECONDS} s je Variante (Zeiten in ms)\n`);
const ws = await runWs();
const http = await runHttp();
const row = (name, r) => `${name.padEnd(28)} Host→Spieler p50 ${r.toPlayers.p50} / p95 ${r.toPlayers.p95} / max ${r.toPlayers.max} (n=${r.toPlayers.n})   Buzz→Host p50 ${r.toHost.p50} / p95 ${r.toHost.p95} / max ${r.toHost.max} (n=${r.toHost.n})`;
console.log(row('WebSocket (eigener Server)', ws));
console.log(row('HTTP-Relay (Long-Polling)', http));
await srv.close();
process.exit(0);
