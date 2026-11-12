// Gemeinsames Gerüst für die Browser-Tests:
// - statischer Webserver für das Repo
// - eigener PeerJS-Vermittlungsserver (kein Internet nötig)
// - Chromium über Playwright; das PeerJS-Skript vom CDN wird lokal ausgeliefert
// - mit E2E_TRANSPORT=relay stattdessen das HTTP-Relay (api/relay) mit Speicher-Backend,
//   so wie die Seite auf Vercel läuft
const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const PEERJS = fs.readFileSync(require.resolve('peerjs/dist/peerjs.min.js'), 'utf8');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
};

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// Lokaler TURN-Server (für Tests der Verbindungshilfe)
async function startTurn() {
  const port = await freePort();
  const proc = spawn(process.execPath, ['-e', `
    const Turn = require('node-turn');
    const s = new Turn({ listeningPort: ${port}, listeningIps: ['127.0.0.1'], relayIps: ['127.0.0.1'],
      authMech: 'long-term', credentials: { quiz: 'geheim' }, debugLevel: 'OFF' });
    s.start(); console.log('ready');`], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => { if (String(d).includes('ready')) resolve(); });
    proc.on('exit', (c) => reject(new Error('TURN-Server beendet: ' + c)));
  });
  return {
    urls: `turn:127.0.0.1:${port}?transport=udp`, username: 'quiz', credential: 'geheim',
    stop: () => { proc.removeAllListeners('exit'); proc.kill(); },
  };
}

const TRANSPORT = process.env.E2E_TRANSPORT === 'relay' ? 'relay' : 'peer';

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function startEnv(init = {}) {
  const webPort = await freePort();
  const peerPort = await freePort();
  let relay = null;
  if (TRANSPORT === 'relay') {
    const { handleRelay } = await import('../../lib/relay-core.mjs');
    const { memoryStore } = await import('../../lib/relay-stores.mjs');
    const store = memoryStore();
    relay = async (req, res) => {
      const u = new URL(req.url, 'http://x');
      const rawBody = req.method === 'POST' ? await readBody(req) : '';
      const { status, json } = await handleRelay({ method: req.method, query: u.searchParams, rawBody }, store);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    };
  }

  const web = http.createServer((req, res) => {
    if (relay && req.url.startsWith('/api/relay')) return relay(req, res);
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => web.listen(webPort, '127.0.0.1', r));

  // Vermittlungsserver als eigener Prozess: er hält interne Timer offen und würde den
  // Testprozess sonst am Beenden hindern.
  const peerProc = spawn(process.execPath, ['-e',
    `require('peer').PeerServer({ port: ${peerPort}, path: '/p', host: '127.0.0.1' }, () => console.log('ready'))`],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    peerProc.stdout.on('data', (d) => { if (String(d).includes('ready')) resolve(); });
    peerProc.on('exit', (c) => reject(new Error('PeerServer beendet: ' + c)));
  });

  const browser = await chromium.launch();
  const base = `http://127.0.0.1:${webPort}`;
  const errors = [];

  async function page({ viewport = { width: 1280, height: 800 }, extraInit = {} } = {}) {
    const ctx = await browser.newContext({ viewport });
    await ctx.route('https://unpkg.com/**', (r) => r.fulfill({ body: PEERJS, contentType: 'application/javascript' }));
    await ctx.route('https://img.example.com/**', (r) => r.fulfill({ body: TEST_PNG, contentType: 'image/png' }));
    await ctx.addInitScript(([port, vars]) => {
      Object.assign(window, vars);
      let P;
      Object.defineProperty(window, 'Peer', {
        configurable: true,
        get() { return P; },
        set(v) {
          // Alle Peers auf den lokalen Vermittlungsserver umbiegen, Optionen der App (z. B. ICE/TURN) behalten
          P = function (id, opts) {
            const local = { host: '127.0.0.1', port, path: '/p', secure: false };
            if (typeof id === 'string') return (window.__peer = new v(id, { ...(opts || {}), ...local }));
            return new v({ ...(id || {}), ...local });
          };
        },
      });
    }, [peerPort, { ...init, ...extraInit }]);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (d) => d.accept());
    return p;
  }

  async function stop() {
    await browser.close();
    web.closeAllConnections();
    await new Promise((r) => web.close(r));
    peerProc.removeAllListeners('exit');
    peerProc.kill();
  }

  return { base, page, stop, errors };
}

// 1×1-Pixel-PNG als Testbild
const TEST_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const PHONE = { width: 390, height: 844 };

// Host öffnen (frischer Zustand), optional Modus und Spieler/Teams anlegen
async function openHost(env, { names = [], mode = 'single', teamSize, viewport } = {}) {
  const host = await env.page({ viewport });
  await host.goto(env.base + '/host.html');
  await host.evaluate(() => localStorage.clear());
  await host.reload();
  await host.waitForFunction(() => document.getElementById('peerStatus').textContent === 'online');
  if (mode === 'team') await host.click('#modeTeam');
  if (teamSize) {
    await host.fill('#teamSize', String(teamSize));
    await host.press('#teamSize', 'Enter');
    await host.locator('#teamSize').blur();
  }
  for (const n of names) {
    await host.fill('#newName', n);
    await host.click('#addForm button');
  }
  const code = await host.textContent('#code');
  return { host, code };
}

// Spieler beitreten lassen: im Einzelmodus Namen wählen, im Team-Modus Team + eigener Name
async function joinPlayer(env, code, { pick, name, viewport = PHONE, sfx = true } = {}) {
  const p = await env.page({ viewport });
  await p.goto(env.base + '/player.html?room=' + code);
  await p.waitForSelector('#picker:not([hidden])');
  if (name) await p.fill('#pickerName', name);
  if (pick) await p.click(`.pick:has-text("${pick}")`);
  if (sfx) await p.evaluate(() => { window.__sfx = []; J.sfx = (n) => window.__sfx.push(n); });
  return p;
}

const scoresOf = (page, sel = '#scores') =>
  page.$$eval(`${sel} .score-value`, (els) => els.map((e) => e.textContent).join(','));

module.exports = { TRANSPORT, startEnv, startTurn, openHost, joinPlayer, scoresOf, PHONE, TEST_PNG };
