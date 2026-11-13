// Joker: Regeln, Tipp-Muster, Punkte
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCommon } = require('./load-common');

const { J } = loadCommon();
const players = () => [{ id: 'a', name: 'Anna', usedJokers: [] }, { id: 'b', name: 'Ben', usedJokers: [] }];
const cur = (extra = {}) => ({ judged: {}, buzz: { open: false, winner: null }, revealed: false, jokers: {}, ...extra });
const block = (kind, o) => J.jokerBlock(kind, { cur: cur(), players: players(), turn: 'a', pid: 'a', ...o });

test('Tipp-Muster: Anfangsbuchstaben, Länge, keine Ziffern', () => {
  assert.equal(J.hintPattern('Mona Lisa'), 'M _ _ _   L _ _ _');
  assert.equal(J.hintPattern('F.R.I.D.A.Y.'), 'F . _ . _ . _ . _ . _ .');
  assert.equal(J.hintPattern('6'), '_');
  assert.equal(J.hintPattern('  Coca-Cola '), 'C _ _ _ - _ _ _ _');
  assert.equal(J.hintPattern('ägypten'), 'Ä _ _ _ _ _ _');
  assert.equal(J.hintPattern(''), '');
});

test('Doppelt oder nichts: doppelter Gewinn, voller Abzug – auch beim Klauen', () => {
  assert.deepEqual({ ...J.judgePoints(0, 2, { stolen: false, double: false }) }, { gain: 300, penalty: 150 });
  assert.deepEqual({ ...J.judgePoints(0, 2, { stolen: false, double: true }) }, { gain: 600, penalty: 300 });
  assert.deepEqual({ ...J.judgePoints(1, 4, { stolen: true, double: true }) }, { gain: 1000, penalty: 1000 });
});

test('Joker nur einmal pro Spiel und nur für Spieler', () => {
  assert.equal(block('double'), null);
  const ps = players(); ps[0].usedJokers = ['double'];
  assert.equal(block('double', { players: ps }), 'Schon benutzt');
  assert.equal(block('double', { pid: 'zuschauer' }), 'Nur für Spieler');
  assert.equal(block('joker42'), 'Unbekannter Joker');
  assert.equal(block('hint', { cur: null }), 'Erst wenn eine Frage offen ist');
});

test('Joker nur, wenn man dran ist', () => {
  assert.equal(block('double'), null, 'Anna ist am Zug');
  assert.equal(block('double', { pid: 'b' }), 'Nur wenn du dran bist', 'Ben ist nicht dran');
  assert.equal(block('double', { cur: cur({ judged: { a: 'wrong' } }) }), 'Du hast schon geantwortet');
  assert.equal(block('hint', { cur: cur({ revealed: true }) }), 'Frage ist schon gelöst');
  assert.equal(block('double', { cur: cur({ judged: { b: 'right' } }) }), 'Frage ist schon gelöst');
  // Klau-Runde: Buzzer offen → niemand dran
  assert.equal(block('double', { pid: 'b', cur: cur({ judged: { a: 'wrong' }, buzz: { open: true } }) }), 'Nur wenn du dran bist');
  // Wer gebuzzert hat, ist dran
  assert.equal(block('hint', { pid: 'b', cur: cur({ judged: { a: 'wrong' }, buzz: { winner: 'b' } }) }), null);
  // Wer die Frage weitergereicht bekommt, ist dran – wer weitergegeben hat, nicht mehr
  const passed = cur({ jokers: { pass: { from: 'a', to: 'b' } } });
  assert.equal(block('hint', { pid: 'b', cur: passed }), null);
  assert.equal(block('hint', { pid: 'a', cur: passed }), 'Nur ein Joker pro Frage');
});

test('Höchstens ein Joker pro Person und Frage', () => {
  assert.equal(block('hint', { cur: cur({ jokers: { double: ['a'] } }) }), 'Nur ein Joker pro Frage');
  assert.equal(block('double', { cur: cur({ jokers: { hint: ['a'] } }) }), 'Nur ein Joker pro Frage');
  assert.equal(block('pass', { target: 'b', cur: cur({ jokers: { double: ['a'] } }) }), 'Nur ein Joker pro Frage');
});

test('whoIsUp: wer gerade antworten muss', () => {
  assert.equal(J.whoIsUp(cur(), 'a'), 'a');
  assert.equal(J.whoIsUp(cur({ buzz: { open: true } }), 'a'), null);
  assert.equal(J.whoIsUp(cur({ buzz: { arming: true } }), 'a'), null, 'Pixel-Rennen: erst nach dem Buzz');
  assert.equal(J.whoIsUp(cur({ judged: { a: 'wrong' }, buzz: { winner: 'b' } }), 'a'), 'b');
  assert.equal(J.whoIsUp(cur({ judged: { a: 'wrong' } }), 'a'), null);
  assert.equal(J.whoIsUp(cur({ jokers: { pass: { from: 'a', to: 'b' } } }), 'a'), 'b');
  assert.equal(J.whoIsUp(cur({ judged: { a: 'right' } }), 'a'), null);
});

test('Weitergeben: nur wer am Zug ist, nur vor der ersten Antwort, gültiges Ziel', () => {
  assert.equal(block('pass'), null, 'Zielauswahl darf geöffnet werden');
  assert.equal(block('pass', { target: 'b' }), null);
  assert.equal(block('pass', { target: 'a' }), 'Ungültiges Ziel');
  assert.equal(block('pass', { target: 'x' }), 'Ungültiges Ziel');
  assert.equal(block('pass', { pid: 'b', target: 'a' }), 'Nur wenn du dran bist');
  assert.equal(block('pass', { target: 'b', cur: cur({ buzz: { open: true } }) }), 'Nur wenn du dran bist');
  // Wer weitergereicht bekommt, darf nicht selbst weitergeben
  assert.equal(block('pass', { pid: 'b', target: 'a', cur: cur({ jokers: { pass: { from: 'a', to: 'b' } } }) }), 'Nur wer am Zug ist, vor der ersten Antwort');
});

test('Öffentlicher Zustand verrät den Tipp nicht, zeigt aber verbrauchte Joker', () => {
  const set = J.defaultSet();
  set.rounds[0].categories[0].clues[0].a = 'Geheimwort';
  const st = Object.assign(J.defaultState(), {
    players: [{ id: 'a', name: 'Anna', score: 0, usedJokers: ['hint'] }],
    current: { round: 0, cat: 0, row: 0, revealed: false, judged: {}, jokers: { hint: ['a'] } },
  });
  const pub = J.publicState(set, st);
  const txt = JSON.stringify(pub);
  assert.ok(!txt.includes('Geheimwort') && !txt.includes('G _ _'), 'kein Tipp, keine Antwort');
  assert.deepEqual([...pub.current.jokers.hint], ['a']);
  assert.deepEqual([...pub.players[0].usedJokers], ['hint']);
  assert.equal(pub.current.revealed, false);
});
