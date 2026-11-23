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
    [r, g] = send(g, 1000 + i * 400);
    assert.ok(r.ok, `Emoji ${i + 1} geht durch`);
  }
  [r, g] = send(g, 1000 + J.REACT_MAX * 400);
  assert.equal(r.ok, false);
  assert.ok(r.justLocked);
  assert.equal(r.wait, J.REACT_LOCK_MS);
});

test('Während der Pause bleibt alles gesperrt, danach geht es wieder', () => {
  let g, r;
  for (let i = 0; i <= J.REACT_MAX; i++) [r, g] = send(g, i * 100);
  const lockedAt = J.REACT_MAX * 100;
  [r, g] = send(g, lockedAt + 5000);
  assert.equal(r.ok, false);
  assert.ok(!r.justLocked, 'Pause verlängert sich nicht');
  assert.equal(r.wait, J.REACT_LOCK_MS - 5000);
  [r, g] = send(g, lockedAt + J.REACT_LOCK_MS);
  assert.ok(r.ok, 'nach der Pause wieder frei');
});

test('Langsames Reagieren wird nie gesperrt', () => {
  let g, r;
  const gap = Math.ceil(J.REACT_WINDOW_MS / J.REACT_MAX) + 10;
  for (let i = 0; i < 50; i++) {
    [r, g] = send(g, i * gap);
    assert.ok(r.ok, `Emoji ${i + 1}`);
  }
});
