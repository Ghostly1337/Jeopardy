// Ausgelieferte Seiten: strenge CSP, keine Inline-Skripte, nur lokale Skripte/Styles,
// und alles, was eine Seite lädt, lässt die Vercel-Middleware auch durch.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PAGES = ['index.html', 'host.html', 'player.html', 'editor.html'];
let pathAllowed;
test.before(async () => { ({ pathAllowed } = await import('../../middleware.js')); });

test('Jedes eingebundene Skript und Stylesheet ist lokal, existiert und wird ausgeliefert', () => {
  for (const page of PAGES) {
    assert.ok(pathAllowed('/' + page), page);
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const refs = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(refs.length, page);
    for (const r of refs) {
      assert.doesNotMatch(r, /^(https?:)?\/\//, `${page}: externe Quelle ${r}`);
      assert.ok(fs.existsSync(path.join(ROOT, r)), `${page}: ${r} fehlt`);
      assert.ok(pathAllowed('/' + r), `${page}: ${r} würde von der Middleware gesperrt`);
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
  assert.ok(vendored.equals(fs.readFileSync(require.resolve('peerjs/dist/peerjs.min.js'))));
});
