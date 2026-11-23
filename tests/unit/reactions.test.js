// Emoji-Spam-Sperre: höchstens REACT_MAX pro Zeitfenster, danach Pause
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCommon } = require('./load-common');

const { J } = loadCommon();

function send(gate, now) {
  const r = J.reactGate(gate, now);
  return [r, r.gate];
}

test('Erlaubt REACT_MAX Emojis, das nächste sperrt', () => {
  let g, r;
  for (let i = 0; i < J.REACT_MAX; i++) {
    [r, g] = send(g, 1000 + i * (J.REACT_GAP_MS + 100));
    assert.ok(r.ok, `Emoji ${i + 1} geht durch`);
  }
  [r, g] = send(g, 1000 + J.REACT_MAX * (J.REACT_GAP_MS + 100));
  assert.equal(r.ok, false);
  assert.ok(r.justLocked);
  assert.equal(r.wait, J.REACT_LOCK_MS);
});

test('Während der Pause bleibt alles gesperrt, danach geht es wieder', () => {
  let g, r;
  [r, g] = send(g, 0);
  [r, g] = send(g, 100); // zu schnell hintereinander sperrt sofort
  assert.ok(r.justLocked);
  const lockedAt = 100;
  [r, g] = send(g, lockedAt + 5000);
  assert.equal(r.ok, false);
  assert.ok(!r.justLocked, 'Pause verlängert sich nicht');
  assert.equal(r.wait, J.REACT_LOCK_MS - 5000);
  [r, g] = send(g, lockedAt + J.REACT_LOCK_MS);
  assert.ok(r.ok, 'nach der Pause wieder frei');
});

test('Langsames Reagieren wird nie gesperrt', () => {
  let g, r;
  const gap = Math.max(J.REACT_GAP_MS, Math.ceil(J.REACT_WINDOW_MS / J.REACT_MAX)) + 10;
  for (let i = 0; i < 50; i++) {
    [r, g] = send(g, i * gap);
    assert.ok(r.ok, `Emoji ${i + 1}`);
  }
});

test('Dauerfeuer auf dem Handy wird beim Host nach dem 1. Emoji gesperrt', () => {
  let g, r;
  let passed = 0;
  for (let t = 0; t < 30000; t += 50) { [r, g] = send(g, t); if (r.ok) passed++; }
  assert.ok(passed <= 3, `in 30 s Dauerfeuer kamen nur ${passed} durch`);
});
