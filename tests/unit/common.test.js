const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCommon } = require('./load-common');

const { J } = loadCommon();
// Objekte aus der Sandbox haben andere Prototypen → für deepEqual in normale Objekte umwandeln
const plain = (x) => JSON.parse(JSON.stringify(x));

test('Punktwerte: Runde 1 100–500, Runde 2 200–1000', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((r) => J.pointsFor(0, r)), [100, 200, 300, 400, 500]);
  assert.deepEqual([0, 1, 2, 3, 4].map((r) => J.pointsFor(1, r)), [200, 400, 600, 800, 1000]);
});

test('Falsch kostet und Klauen bringt jeweils die Hälfte', () => {
  assert.equal(J.penaltyFor(0, 4), 250);
  assert.equal(J.stealFor(1, 4), 500);
  assert.equal(J.penaltyFor(1, 0), 100);
});

test('normalizeSet füllt fehlende Felder auf und übernimmt vorhandene', () => {
  const s = J.normalizeSet({ title: 'Quiz', rounds: [{ categories: [{ name: 'Tiere', clues: [{ q: 'F', a: 'A' }] }] }] });
  assert.equal(s.title, 'Quiz');
  assert.equal(s.rounds.length, 2);
  assert.equal(s.rounds[0].categories.length, 6);
  assert.equal(s.rounds[0].categories[0].name, 'Tiere');
  assert.equal(s.rounds[0].categories[0].clues[0].q, 'F');
  assert.equal(s.rounds[0].categories[0].clues[4].q, 'Frage für 500');
  assert.equal(s.rounds[1].categories[5].clues[4].q, 'Frage für 1000');
});

test('normalizeSet verwirft kaputte Eingaben', () => {
  assert.equal(J.normalizeSet(null).rounds.length, 2);
  assert.equal(J.normalizeSet('quatsch').title, 'Jeopardy');
});

test('safeImg lässt nur Web-Links und Bilddaten durch', () => {
  assert.equal(J.safeImg('https://x.de/a.png'), 'https://x.de/a.png');
  assert.equal(J.safeImg('  http://x.de/a.png '), 'http://x.de/a.png');
  assert.ok(J.safeImg('data:image/jpeg;base64,AAAA'));
  assert.equal(J.safeImg('javascript:alert(1)'), '');
  assert.equal(J.safeImg('data:text/html;base64,AAAA'), '');
  assert.equal(J.safeImg(42), '');
});

test('importierte Bilder werden beim Normalisieren geprüft', () => {
  const s = J.normalizeSet({ rounds: [{ categories: [{ clues: [{ img: 'javascript:x' }, { img: 'https://ok.de/b.png' }] }] }] });
  assert.equal(s.rounds[0].categories[0].clues[0].img, '');
  assert.equal(s.rounds[0].categories[0].clues[1].img, 'https://ok.de/b.png');
});

function gameState(overrides = {}) {
  return Object.assign(J.defaultState(), {
    players: [{ id: 'a', name: 'Anna', score: 100 }, { id: 'b', name: 'Ben', score: -50 }],
  }, overrides);
}

test('publicState verrät keine Antworten, solange nicht aufgedeckt', () => {
  const set = J.defaultSet();
  set.rounds[0].categories[2].clues[1].a = 'GEHEIM';
  const st = gameState({ current: { round: 0, cat: 2, row: 1, revealed: false, judged: {} } });
  const pub = J.publicState(set, st);
  assert.equal(pub.current.a, null);
  assert.ok(!JSON.stringify(pub).includes('GEHEIM'), 'Antwort darf nirgends im öffentlichen Zustand stehen');
  st.current.revealed = true;
  assert.equal(J.publicState(set, st).current.a, 'GEHEIM');
});

test('publicState schickt keine anderen Antworten mit', () => {
  const set = J.defaultSet();
  set.rounds.forEach((r) => r.categories.forEach((c) => c.clues.forEach((cl, i) => { cl.a = 'ANTWORT' + i; })));
  const pub = J.publicState(set, gameState());
  assert.ok(!JSON.stringify(pub).includes('ANTWORT'));
});

test('publicState versteckt Kategorien, die im Intro noch nicht dran waren', () => {
  const set = J.defaultSet();
  const pub = J.publicState(set, gameState({ intro: { round: 0, step: 2 } }));
  assert.deepEqual(plain(pub.categories), ['Kategorie 1', 'Kategorie 2', '', '', '', '']);
  assert.equal(pub.intro.name, 'Kategorie 2');
  assert.equal(J.publicState(set, gameState({ intro: { round: 0, step: 0 } })).intro.name, null);
});

test('publicState schickt Timer als Restzeit', () => {
  const set = J.defaultSet();
  const st = gameState({ current: { round: 0, cat: 0, row: 0, judged: {}, timer: { endsAt: Date.now() + 5000, total: 15000 } } });
  const t = J.publicState(set, st).current.timer;
  assert.ok(t.remaining > 4000 && t.remaining <= 5000);
  assert.equal(t.total, 15000);
});

test('publicState: Teamfarben nur im Team-Modus', () => {
  const set = J.defaultSet();
  assert.equal(J.publicState(set, gameState()).players[0].color, null);
  const pub = J.publicState(set, gameState({ mode: 'team', teamSize: 4 }));
  assert.equal(pub.mode, 'team');
  assert.equal(pub.teamSize, 4);
  assert.match(pub.players[0].color, /^#/);
  assert.notEqual(pub.players[0].color, pub.players[1].color);
});

test('„Am Zug“ geht reihum', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(J.nextTurn(ids, 'a'), 'b');
  assert.equal(J.nextTurn(ids, 'c'), 'a');
  assert.equal(J.nextTurn(ids, null), 'a');
  assert.equal(J.nextTurn(ids, 'weg'), 'a');
  assert.equal(J.nextTurn([], 'a'), null);
});

test('Wer am Zug ist und entfernt wird, gibt an den Nächsten weiter', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(J.turnAfterRemoval(ids, 'b', 'b'), 'c');
  assert.equal(J.turnAfterRemoval(ids, 'c', 'c'), 'a');
  assert.equal(J.turnAfterRemoval(ids, 'a', 'b'), 'a');
  assert.equal(J.turnAfterRemoval(['a'], 'a', 'a'), null);
});

test('Frühstart: unter 100 ms zählt nicht', () => {
  assert.equal(J.isEarly(0), true);
  assert.equal(J.isEarly(99), true);
  assert.equal(J.isEarly(100), false);
  assert.equal(J.isEarly(NaN), true);
  assert.equal(J.LOCK_MS, 1000);
});

test('Buzzer: schnellste gültige Reaktion gewinnt, Frühstarts werden ignoriert', () => {
  assert.deepEqual(plain(J.pickBuzzWinner([['a', 450], ['b', 300, 'Ben'], ['c', 20]])), { id: 'b', ms: 300, name: 'Ben' });
  assert.equal(J.pickBuzzWinner([['a', 10], ['b', 50]]), null);
  assert.equal(J.pickBuzzWinner([]), null);
});

test('Teamgröße wird auf 1–20 begrenzt', () => {
  assert.equal(J.clampTeamSize(3), 3);
  assert.equal(J.clampTeamSize('5'), 5);
  assert.equal(J.clampTeamSize(0), 1);
  assert.equal(J.clampTeamSize(99), 20);
  assert.equal(J.clampTeamSize('abc'), 3);
  assert.equal(J.teamIsFull(2, 3), false);
  assert.equal(J.teamIsFull(3, 3), true);
});

test('Namen werden gekürzt und bereinigt', () => {
  assert.equal(J.cleanName('  Anna   Lena '), 'Anna Lena');
  assert.equal(J.cleanName('x'.repeat(40)).length, 24);
  assert.equal(J.cleanName(null), '');
});

test('Rangliste: Gleichstand teilt sich den Platz', () => {
  const r = J.ranking([{ name: 'A', score: 100 }, { name: 'B', score: 300 }, { name: 'C', score: 100 }, { name: 'D', score: 0 }]);
  assert.deepEqual(plain(r.map((p) => `${p.name}${p.place}`)), ['B1', 'A2', 'C2', 'D4']);
});

test('Auszeichnungen im Einzelmodus', () => {
  const players = [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Ben' }];
  const stats = { a: { right: 3, wrong: 1, buzzWins: 2, steals: 1 }, b: { right: 3, wrong: 4, buzzWins: 0, steals: 0 } };
  const aw = Object.fromEntries(J.awards(players, stats).map((x) => [x.title, plain(x.names)]));
  assert.deepEqual(aw['Buzzer-König'], ['Anna']);
  assert.deepEqual(aw['Treffsicher'], ['Anna', 'Ben']);
  assert.deepEqual(aw['Meiste Fehlversuche'], ['Ben']);
  assert.deepEqual(aw['Meisterdieb'], ['Anna']);
});

test('Auszeichnungen ohne Daten fallen weg', () => {
  assert.equal(J.awards([{ id: 'a', name: 'Anna' }], {}).length, 0);
});

test('Team-Modus: Buzzer-König geht an eine Person, der Rest an Teams', () => {
  const teams = [{ id: 't1', name: 'Rot' }, { id: 't2', name: 'Blau' }];
  const stats = { t1: { right: 2, buzzWins: 3 }, t2: { right: 1, wrong: 2, buzzWins: 1 } };
  const persons = { 't1:Anna': { name: 'Anna', team: 'Rot', buzzWins: 2 }, 't1:Ben': { name: 'Ben', team: 'Rot', buzzWins: 1 } };
  const aw = Object.fromEntries(J.awards(teams, stats, persons).map((x) => [x.title, plain(x.names)]));
  assert.deepEqual(aw['Buzzer-König'], ['Anna (Rot)']);
  assert.deepEqual(aw['Treffsicher'], ['Rot']);
  assert.deepEqual(aw['Meiste Fehlversuche'], ['Blau']);
});

test('Zeitformat für Reaktionszeiten', () => {
  assert.equal(J.fmtMs(420), '0,42 s');
  assert.equal(J.fmtMs(1260), '1,26 s');
});

test('Spielstand wird mit Standardwerten geladen', () => {
  const { J: fresh } = loadCommon();
  const st = fresh.loadState();
  assert.equal(st.mode, 'single');
  assert.equal(st.teamSize, 3);
  assert.deepEqual(plain(st.players), []);
});

test('Gespeicherter Team-Modus bleibt nach dem Laden erhalten', () => {
  const { J: fresh, localStorage } = loadCommon();
  localStorage.setItem('jeopardy.state', JSON.stringify({ mode: 'team', teamSize: 50, players: [{ id: 'x', name: 'Rot', score: 0 }] }));
  const st = fresh.loadState();
  assert.equal(st.mode, 'team');
  assert.equal(st.teamSize, 20);
  assert.equal(st.players[0].name, 'Rot');
});

test('HTML wird escaped', () => {
  assert.equal(J.escapeHtml('<b>"x"&\''), '&lt;b&gt;&quot;x&quot;&amp;&#39;');
});
