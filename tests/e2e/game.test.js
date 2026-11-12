// Grundablauf: Editor, Host und Spieler, verdeckte Antworten, Punkte, Reihenfolge, Undo, Themes
const test = require('node:test');
const assert = require('node:assert/strict');
const { startEnv, openHost, joinPlayer, scoresOf } = require('./helpers');

let env;
test.before(async () => { env = await startEnv({ JEOP_BUZZ_DELAY_MS: 150, JEOP_INTRO_MS: 300 }); });
test.after(async () => { await env.stop(); });

test('Editor speichert Fragen, Runde 2 hat doppelte Punkte', async () => {
  const ed = await env.page();
  await ed.goto(env.base + '/editor.html');
  await ed.evaluate(() => localStorage.clear());
  await ed.reload();
  await ed.locator('.ed-cat input').first().fill('Geschichte');
  await ed.locator('.ed-clue textarea').first().fill('Dieses Jahr fiel die Mauer');
  await ed.locator('.ed-clue input').first().fill('Was ist 1989?');
  await ed.click('button[data-round="1"]');
  const pts = await ed.locator('.ed-clue .pts').allTextContents();
  assert.deepEqual(pts.slice(0, 5), ['200', '400', '600', '800', '1000']);
  const saved = await ed.evaluate(() => JSON.parse(localStorage.getItem('jeopardy.set')).rounds[0].categories[0]);
  assert.equal(saved.name, 'Geschichte');
  assert.equal(saved.clues[0].a, 'Was ist 1989?');
  await ed.context().close();
});

test('Kompletter Spielablauf zwischen Host und Spieler', async (t) => {
  // Fragen im selben Browser-Profil wie der Host anlegen
  const { host, code } = await openHost(env, { names: ['Anna', 'Ben'] });
  await host.evaluate(() => {
    const s = J.loadSet();
    s.rounds[0].categories[0].name = 'Geschichte';
    s.rounds[0].categories[0].clues[0] = { q: 'Dieses Jahr fiel die Mauer', a: 'GEHEIM-1989', img: '', note: 'NOTIZ: auch 89 gilt' };
    J.saveSet(s);
  });
  await host.reload();
  await host.waitForFunction(() => document.getElementById('peerStatus').textContent === 'online');

  const anna = await joinPlayer(env, code, { pick: 'Anna' });
  await anna.waitForFunction(() => document.querySelector('#board').textContent.includes('Geschichte'));

  await t.test('Wer zuerst angelegt wurde, ist am Zug', async () => {
    await anna.waitForFunction(() => document.getElementById('turnBanner').textContent.includes('Anna wählt'));
  });

  await t.test('Spieler sieht die Frage, aber nicht die Antwort', async () => {
    await host.locator('.cell.val').first().click();
    await anna.waitForSelector('#overlay.show');
    assert.equal(await anna.textContent('#q'), 'Dieses Jahr fiel die Mauer');
    assert.ok(!(await anna.content()).includes('GEHEIM-1989'));
    assert.equal(await host.textContent('#clueA'), 'GEHEIM-1989');
    assert.equal(await host.textContent('#clueNote'), 'NOTIZ: auch 89 gilt');
  });

  await t.test('Falsch kostet die Hälfte, geklaut bringt die Hälfte', async () => {
    await host.locator('.jrow').nth(1).locator('.red').click(); // Ben falsch
    await anna.waitForSelector('#overlayScores .delta.neg:text-is("−50")');
    await host.locator('.jrow').nth(0).locator('.green').click(); // Anna richtig (geklaut)
    await anna.waitForSelector('#overlayScores .delta.pos:text-is("+50")');
    const verdicts = await host.locator('#judge .verdict').allTextContents();
    assert.deepEqual(verdicts, ['✓ +50 (geklaut)', '✗ −50']);
    await anna.waitForFunction(() => document.getElementById('a').textContent === 'GEHEIM-1989');
    assert.ok(!(await anna.content()).includes('NOTIZ'), 'Host-Notiz bleibt auch nach dem Aufdecken verborgen');
    assert.equal(await host.locator('#judge button').count(), 0, 'Keine Doppelwertung möglich');
  });

  await t.test('Nach der Frage ist der Nächste in der Reihenfolge dran', async () => {
    await host.click('#close');
    await anna.waitForSelector('#overlay:not(.show)', { state: 'attached' });
    assert.equal(await scoresOf(anna), '50,-50');
    await anna.waitForFunction(() => document.getElementById('turnBanner').textContent.includes('Ben wählt'));
    // Abgebrochene Frage ändert die Reihenfolge nicht
    await host.locator('.cell.val').nth(1).click();
    await host.click('#cancel');
    await anna.waitForFunction(() => document.getElementById('turnBanner').textContent.includes('Ben wählt'));
    // Und nach Ben ist wieder Anna dran
    await host.locator('.cell.val').nth(1).click();
    await host.click('#close');
    await anna.waitForFunction(() => document.getElementById('turnBanner').textContent.includes('Anna wählt'));
  });

  await t.test('Manuelle Punkte und Rückgängig kommen beim Spieler an', async () => {
    await host.locator('.pscore').nth(1).fill('500');
    await host.locator('.pscore').nth(1).press('Enter');
    await anna.waitForFunction(() => document.querySelectorAll('#scores .score-value')[1].textContent === '500');
    await host.click('#undo');
    await anna.waitForFunction(() => document.querySelectorAll('#scores .score-value')[1].textContent === '-50');
  });

  await t.test('Runde 2 zeigt 200–1000', async () => {
    await host.click('#r1');
    await host.click('#introSkip');
    await anna.waitForFunction(() => document.querySelector('#board').textContent.includes('1000'));
    const vals = await anna.locator('#board .cell.val').allTextContents();
    assert.ok(vals.slice(0, 6).every((v) => v === '200') && vals.slice(-6).every((v) => v === '1000'));
  });

  await t.test('Farbschema wird an Spieler übertragen', async () => {
    await host.click('.theme-btn[data-id="hell"]');
    await anna.waitForFunction(() => document.documentElement.dataset.theme === 'hell');
  });

  await t.test('Spieler verbindet sich nach Host-Reload automatisch neu', async () => {
    await host.reload();
    await host.waitForFunction(() => document.getElementById('peerStatus').textContent === 'online', null, { timeout: 30000 });
    await host.waitForFunction(() => document.getElementById('viewers').textContent === '1 verbunden', null, { timeout: 30000 });
  });

  assert.deepEqual(env.errors, []);
});
