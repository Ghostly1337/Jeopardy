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

test('Tipp-Arten: jede Art liefert den passenden Text, Ziffern bleiben verborgen', () => {
  const h = (a, hint, hintText) => J.hintFor({ a, hint, hintText });
  assert.equal(h('Mona Lisa'), 'M _ _ _   L _ _ _', 'Standard: Anfangsbuchstaben + Länge');
  assert.equal(h('Mona Lisa', 'length'), '_ _ _ _   _ _ _ _');
  assert.equal(h('Mona Lisa', 'first'), 'Beginnt mit „M“');
  assert.equal(h('Mona Lisa', 'firstlast'), 'M _ _ a   L _ _ a');
  assert.equal(h('Mona Lisa', 'words'), '2 Wörter');
  assert.equal(h('Kellerautomat', 'words'), 'Ein Wort');
  assert.equal(h('Mona Lisa', 'custom', 'Hängt im Louvre'), 'Hängt im Louvre');
  assert.equal(h('Mona Lisa', 'custom', '   '), 'M _ _ _   L _ _ _', 'leerer eigener Tipp → Standard');
  assert.equal(h('Mona Lisa', 'none'), null);
  assert.equal(h('R2-D2', 'firstlast'), 'R _ - D _', 'Ziffern nie verraten');
  assert.equal(h('Mona Lisa', 'quatsch'), 'M _ _ _   L _ _ _', 'unbekannte Art → Standard');
});

test('Kein Tipp möglich sperrt nur den Tipp-Joker', () => {
  const c = { ...cur(), noHint: true };
  assert.equal(J.jokerBlock('hint', { cur: c, players: players(), turn: 'a', pid: 'a' }), 'Bei dieser Frage gibt es keinen Tipp');
  assert.equal(J.jokerBlock('double', { cur: c, players: players(), turn: 'a', pid: 'a' }), null);
});

test('Tipp-Einstellungen überstehen Import/Normalisierung', () => {
  const s = J.defaultSet();
  Object.assign(s.rounds[0].categories[0].clues[0], { hint: 'custom', hintText: 'x'.repeat(300) });
  Object.assign(s.rounds[0].categories[0].clues[1], { hint: 'letters' });
  Object.assign(s.rounds[0].categories[0].clues[2], { hint: 'böse<script>' });
  const n = J.normalizeSet(JSON.parse(JSON.stringify(s)));
  const cl = n.rounds[0].categories[0].clues;
  assert.equal(cl[0].hint, 'custom');
  assert.equal(cl[0].hintText.length, 200);
  assert.ok(!('hint' in cl[1]), 'Standard wird nicht gespeichert');
  assert.ok(!('hint' in cl[2]), 'Unbekanntes fliegt raus');
});

test('Punkteverteilung: am Zug voll, andere nach Anteil, gerundet; Klauen und Doppelt unberührt', () => {
  const pts = (o) => ({ ...J.judgePoints(0, 2, o) }); // Runde 1, 300er
  assert.deepEqual(pts({ active: true, otherShare: 50 }), { gain: 300, penalty: 150 });
  assert.deepEqual(pts({ active: false, otherShare: 50 }), { gain: 150, penalty: 150 }, 'Abzug unverändert');
  assert.equal(pts({ active: false, otherShare: 75 }).gain, 225);
  assert.equal(pts({ active: false, otherShare: 25 }).gain, 75);
  assert.equal(pts({ active: false, otherShare: 0 }).gain, 0);
  assert.equal(J.judgePoints(0, 0, { active: false, otherShare: 25 }).gain, 25);
  assert.equal(J.judgePoints(1, 0, { active: false, otherShare: 75 }).gain, 150, 'Runde 2, 200er');
  assert.equal(pts({ stolen: true, active: false, otherShare: 0 }).gain, 150, 'Klauen bleibt halb');
  assert.deepEqual(pts({ double: true, active: false, otherShare: 50 }), { gain: 600, penalty: 300 }, 'Doppelt oder nichts unberührt');
  assert.equal(pts({ active: false, otherShare: 'quatsch' }).gain, 150, 'ungültig → Standard 50 %');
  assert.equal(pts({}).gain, 300, 'ohne Angaben wie bisher');
});

test('Punkteverteilung: Standard 50 %, wird gespeichert und an Spieler gemeldet', () => {
  assert.equal(J.defaultState().otherShare, 50);
  assert.equal(J.cleanShare('75'), 75);
  assert.equal(J.cleanShare(33), 50);
  const st = J.defaultState();
  st.otherShare = 25;
  assert.equal(J.publicState(J.defaultSet(), st).otherShare, 25);
});
