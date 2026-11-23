// QR-Encoder (vendor/qrcode.js über js/qr.js): Round-Trip mit einem unabhängigen Decoder (jsQR)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const jsQR = require('jsqr');
const JQR = require('../../js/qr.js');
const { loadCommon } = require('./load-common');

const { J } = loadCommon();

function decode(text, scale = 6) {
  const m = JQR.matrix(text);
  const n = m.length + JQR.QUIET * 2;
  const w = n * scale;
  const data = new Uint8ClampedArray(w * w * 4).fill(255);
  m.forEach((row, r) => row.forEach((dark, c) => {
    if (!dark) return;
    for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
      const i = (((r + JQR.QUIET) * scale + y) * w + (c + JQR.QUIET) * scale + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  }));
  const res = jsQR(data, w, w);
  return res && res.data;
}

test('Kurzer Beitrittslink überlebt den Round-Trip', () => {
  const url = 'https://jeopardy.example/player.html?room=ABC123';
  assert.equal(decode(url), url);
});

test('Langer Link mit TURN-Zugang im #-Teil überlebt den Round-Trip', () => {
  const turn = { urls: ['turn:turn.example.org:3478?transport=udp', 'turns:turn.example.org:443?transport=tcp'], username: 'quiz', credential: 'geheim-geheim' };
  const url = J.joinUrl('https://ghostly1337.github.io/Jeopardy/host.html', 'XYZ789', turn);
  assert.match(url, /^https:\/\/ghostly1337\.github\.io\/Jeopardy\/player\.html\?room=XYZ789#t=[\w-]+$/);
  assert.equal(decode(url), url);
});

test('Version 1 hat 21×21 Module und feste Finder-Muster', () => {
  const m = JQR.matrix('HI');
  assert.equal(m.length, 21);
  assert.equal(m[0].slice(0, 7).join(), Array(7).fill(true).join());
  assert.deepEqual([...m[3].slice(0, 7)], [true, false, true, true, true, false, true]);
});

test('Nicht-ASCII wird abgelehnt statt falsch kodiert', () => {
  assert.throws(() => JQR.matrix('https://x/ü'), /ASCII/);
});

test('SVG enthält nur Zahlen und feste Attribute (kein Text aus der URL)', () => {
  const svg = JQR.svg('https://x.example/player.html?room=A"<script>');
  assert.ok(!svg.includes('script') && !svg.includes('x.example'));
  assert.match(svg, /^<svg [^>]*viewBox="0 0 \d+ \d+"/);
  assert.doesNotMatch(svg.replace(/<\/?(svg|rect|path)\b[^>]*>/g, ''), /\S/, 'nur svg/rect/path');
});

test('joinUrl: nur Raumcode, keine Passwörter oder Parameter der Host-Seite; Raumcode wird kodiert', () => {
  const u = J.joinUrl('https://a.example/x/host.html?pw=geheim#frag', 'AB 1', null);
  assert.equal(u, 'https://a.example/x/player.html?room=AB%201');
  assert.ok(!/pw|geheim|frag/.test(u));
});

test('vendor/qrcode.js entspricht dem npm-Paket', () => {
  const vendored = fs.readFileSync(path.join(__dirname, '..', '..', 'vendor', 'qrcode.js'));
  assert.ok(vendored.equals(fs.readFileSync(require.resolve('qrcode-generator/qrcode.js'))));
});
