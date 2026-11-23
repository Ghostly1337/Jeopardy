// Veröffentlichung: GitHub Pages bekommt nur Laufzeitdateien, alle Seiten haben eine strenge CSP,
// und jedes Skript, das eine Seite lädt, wird auch veröffentlicht.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const PAGES = ['index.html', 'host.html', 'player.html', 'editor.html'];

let out;
test.before(() => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-'));
  execFileSync(path.join(ROOT, 'scripts', 'build-pages.sh'), [out], { cwd: ROOT });
});
test.after(() => fs.rmSync(out, { recursive: true, force: true }));

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

test('Pages enthält nur Laufzeitdateien', () => {
  const files = walk(out).map((f) => path.relative(out, f).split(path.sep).join('/'));
  for (const f of files) {
    assert.match(f, /^(index|host|player|editor)\.html$|^(css|js|fonts|vendor)\//, `nicht erlaubt: ${f}`);
  }
  for (const bad of ['CLAUDE.md', 'README.md', 'package.json', 'middleware.js', 'vercel.json']) {
    assert.ok(!files.includes(bad), bad);
  }
  assert.ok(!files.some((f) => /^(tests|lib|api|node_modules|scripts|\.github)\//.test(f)));
});

test('Jedes eingebundene Skript und Stylesheet ist lokal und wird veröffentlicht', () => {
  for (const page of PAGES) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const refs = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(refs.length, page);
    for (const r of refs) {
      assert.doesNotMatch(r, /^(https?:)?\/\//, `${page}: externe Quelle ${r}`);
      assert.ok(fs.existsSync(path.join(out, r)), `${page}: ${r} fehlt im Pages-Ordner`);
    }
  }
});

test('Alle Seiten: strenge Content-Security-Policy, keine Inline-Skripte', () => {
  for (const page of PAGES) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
    assert.ok(m, `${page}: CSP fehlt`);
    const csp = Object.fromEntries(m[1].split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
    assert.deepEqual(csp['script-src'], ["'self'"], `${page}: nur eigene Skripte`);
    assert.deepEqual(csp['object-src'], ["'none'"]);
    assert.deepEqual(csp['base-uri'], ["'none'"]);
    assert.ok(!html.match(/<script(?![^>]*\ssrc=)[^>]*>/), `${page}: Inline-Skript`);
    assert.ok(!/\son[a-z]+="/i.test(html), `${page}: Inline-Event-Handler`);
  }
});

test('PeerJS liegt lokal und entspricht dem npm-Paket', () => {
  const vendored = fs.readFileSync(path.join(ROOT, 'vendor', 'peerjs.min.js'));
  const npm = fs.readFileSync(require.resolve('peerjs/dist/peerjs.min.js'));
  assert.ok(vendored.equals(npm), 'vendor/peerjs.min.js weicht vom npm-Paket ab');
});
