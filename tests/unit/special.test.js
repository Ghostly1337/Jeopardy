// Schätzfrage, Reihenfolge und Zoom-Bild: Logik und Geheimhaltung
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCommon } = require('./load-common');

const { J } = loadCommon();
const plain = (x) => JSON.parse(JSON.stringify(x));

test('Zahlen erkennen: deutsch, englisch, mit Einheit', () => {
  const cases = { '330': 330, '330 m': 330, '1.234': 1234, '1.234,5': 1234.5, '1,234.5': 1234.5, '384 400 km': 384400,
    '2,5': 2.5, '-12': -12, '0,001': 0.001, '0.5': 0.5, '1,234': 1.234, 'abc': null, '': null };
  for (const [s, v] of Object.entries(cases)) assert.equal(J.parseNumber(s), v, s);
  assert.equal(J.parseNumber(42), 42);
});

test('Schätzfrage: Nächster gewinnt, Gleichstand teilt', () => {
  assert.deepEqual([...J.estimateWinners({ a: 300, b: 350, c: 400 }, 330)], ['b']);
  assert.deepEqual([...J.estimateWinners({ a: 320, b: 340 }, 330)].sort(), ['a', 'b']);
  assert.deepEqual([...J.estimateWinners({}, 330)], []);
  assert.deepEqual([...J.estimateWinners({ a: 1 }, null)], []);
});

test('Reihenfolge: gemischt, nie schon richtig, Abgaben prüfen', () => {
  for (let i = 0; i < 50; i++) {
    const p = J.shufflePerm(4);
    assert.ok(J.isPerm(p, 4));
    assert.ok(!J.orderCorrect(p), 'nie zufällig schon gelöst');
  }
  assert.deepEqual([...J.orderItems(' Game Boy | PlayStation |Wii| ')], ['Game Boy', 'PlayStation', 'Wii']);
  assert.ok(!J.isPerm([0, 0, 1, 2], 4));
  assert.ok(!J.isPerm([0, 1, 2], 4));
  assert.ok(J.orderCorrect([0, 1, 2, 3]));
});

function stateWith(clue, cur) {
  const set = J.defaultSet();
  Object.assign(set.rounds[0].categories[0].clues[0], clue);
  const st = Object.assign(J.defaultState(), {
    players: [{ id: 'a', name: 'Anna', score: 0 }, { id: 'b', name: 'Ben', score: 0 }],
    current: { round: 0, cat: 0, row: 0, revealed: false, judged: {}, ...cur },
  });
  return { set, st };
}

test('Schätzfrage: vor dem Auflösen weder Tipps noch Lösung öffentlich', () => {
  const { set, st } = stateWith({ kind: 'estimate', a: '98765' }, { kind: 'estimate', est: { guesses: { a: 11111, b: 22222 } } });
  let pub = J.publicState(set, st);
  assert.equal(pub.current.kind, 'estimate');
  assert.deepEqual(plain(pub.current.est.submitted).sort(), ['a', 'b']);
  const txt = JSON.stringify(pub);
  for (const secret of ['98765', '11111', '22222']) assert.ok(!txt.includes(secret), secret);
  st.current.revealed = true;
  st.current.est.answer = 98765;
  st.current.est.winners = ['b'];
  pub = J.publicState(set, st);
  assert.equal(pub.current.est.answer, 98765);
  assert.equal(pub.current.est.guesses.a, 11111);
});

test('Reihenfolge: nur gemischte Begriffe öffentlich, Lösung erst nach dem Auflösen', () => {
  const { set, st } = stateWith({ kind: 'order', a: 'A1 | B2 | C3 | D4' },
    { kind: 'order', ord: { perm: [2, 0, 3, 1], answers: { a: [0, 1, 2, 3], b: [1, 0, 2, 3] } } });
  let pub = J.publicState(set, st);
  assert.deepEqual(plain(pub.current.ord.items), ['C3', 'A1', 'D4', 'B2']);
  assert.equal(pub.current.ord.correct, null);
  assert.equal(pub.current.ord.results, null);
  assert.equal(pub.current.a, null);
  assert.ok(!JSON.stringify(pub).includes('A1 | B2'), 'Lösungstext geheim');
  st.current.revealed = true;
  pub = J.publicState(set, st);
  assert.deepEqual(plain(pub.current.ord.correct), ['A1', 'B2', 'C3', 'D4']);
  assert.deepEqual(plain(pub.current.ord.results), { a: true, b: false });
});

test('Zoom-Bild: Stufen wie beim Verpixeln, echtes Bild erst am Ende', () => {
  const { set, st } = stateWith({ img: 'https://example.com/ZOOM.png', zoom: true }, {});
  let pub = J.publicState(set, st);
  assert.equal(pub.current.img, null);
  assert.deepEqual(plain(pub.current.pixel), { step: 0, steps: J.ZOOM_STEPS.length, mode: 'zoom' });
  st.current.pixel = J.ZOOM_STEPS.length;
  pub = J.publicState(set, st);
  assert.equal(pub.current.img, 'https://example.com/ZOOM.png');
});

test('normalizeSet: Fragenart, Zoom und Fokuspunkt', () => {
  const raw = J.defaultSet();
  Object.assign(raw.rounds[0].categories[0].clues[0], { kind: 'estimate' });
  Object.assign(raw.rounds[0].categories[0].clues[1], { kind: 'quatsch' });
  Object.assign(raw.rounds[0].categories[0].clues[2], { img: 'https://example.com/x.png', zoom: true, zoomAt: { x: 1.5, y: 0.25 } });
  Object.assign(raw.rounds[0].categories[0].clues[3], { img: 'https://example.com/x.png', zoom: true, pixel: true });
  const c = J.normalizeSet(raw).rounds[0].categories[0].clues;
  assert.equal(c[0].kind, 'estimate');
  assert.equal(c[1].kind, undefined);
  assert.deepEqual(plain(c[2].zoomAt), { x: 1, y: 0.25 });
  assert.equal(c[3].pixel, true);
  assert.equal(c[3].zoom, undefined, 'Verpixeln hat Vorrang, nie beides');
});

test('Joker sind bei Schätzfrage und Reihenfolge gesperrt', () => {
  const r = J.jokerBlock('double', { cur: { kind: 'estimate', judged: {}, buzz: {} }, players: [{ id: 'a', usedJokers: [] }], turn: 'a', pid: 'a' });
  assert.equal(r, 'Nicht bei dieser Frageart');
});
