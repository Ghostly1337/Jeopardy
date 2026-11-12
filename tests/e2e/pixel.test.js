// Verpixelte Bilder: Spieler bekommen nur ein Mini-Bild, das per Knopf schärfer wird
const test = require('node:test');
const assert = require('node:assert/strict');
const { startEnv, joinPlayer, TEST_PNG } = require('./helpers');

let env;
test.before(async () => { env = await startEnv({ JEOP_BUZZ_DELAY_MS: 200 }); });
test.after(async () => { await env.stop(); });

// Breite des Bildes, das gerade gezeigt wird (bei verpixelten Bildern winzig)
const imgWidth = (page, sel) => page.$eval(sel, (i) => i.naturalWidth);

test('Verpixeltes Bild wird schrittweise schärfer', async (t) => {
  const ed = await env.page();
  await ed.goto(env.base + '/editor.html');
  await ed.evaluate(() => localStorage.clear());
  await ed.reload();

  await t.test('Editor: Häkchen „Verpixeln“ erscheint mit Bild', async () => {
    const clue = ed.locator('.ed-cat').nth(0).locator('.ed-clue').first();
    assert.equal(await clue.locator('.ed-pixel').count(), 0);
    await clue.locator('input[type=file]').setInputFiles({ name: 'bild.png', mimeType: 'image/png', buffer: TEST_PNG });
    await clue.locator('.ed-pixel input').check();
    await ed.waitForFunction(() => JSON.parse(localStorage.getItem('jeopardy.set')).rounds[0].categories[0].clues[0].pixel === true);
  });

  // Größeres Testbild (200×120) direkt ins Set, damit die Stufen unterscheidbar sind;
  // zweites Feld: verlinktes Bild, das sich nicht laden/verpixeln lässt (Playwright-Routen erlauben
  // CORS immer, deshalb hier ein abgebrochener Abruf – im Browser landet beides im selben Fehlerpfad)
  await ed.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 120;
    const g = c.getContext('2d');
    g.fillStyle = '#e11'; g.fillRect(0, 0, 100, 120);
    g.fillStyle = '#11e'; g.fillRect(100, 0, 100, 120);
    const s = JSON.parse(localStorage.getItem('jeopardy.set'));
    Object.assign(s.rounds[0].categories[0].clues[0], { img: c.toDataURL('image/png'), pixel: true, a: 'Flagge' });
    Object.assign(s.rounds[0].categories[1].clues[0], { img: 'https://noimg.example.com/fremd.png', pixel: true });
    localStorage.setItem('jeopardy.set', JSON.stringify(s));
  });

  await ed.context().route('https://noimg.example.com/**', (r) => r.abort());
  const host = await ed.context().newPage();
  await host.goto(env.base + '/host.html');
  await host.waitForFunction(() => document.getElementById('peerStatus').textContent === 'online');
  await host.fill('#newName', 'Anna');
  await host.click('#addForm button');
  const p = await joinPlayer(env, await host.textContent('#code'), { pick: 'Anna' });

  await t.test('Spieler bekommt nur das Mini-Bild', async () => {
    await host.locator('.cell.val').nth(0).click();
    await p.waitForFunction(() => document.getElementById('img').naturalWidth > 0);
    assert.equal(await imgWidth(p, '#img'), 6);
    assert.ok(await p.$eval('#img', (i) => i.classList.contains('pixel')));
    await p.waitForSelector('#overlay:not(.zoom-in)'); // Größe erst nach der Zoom-Animation messen
    assert.ok(await p.$eval('#img', (i) => i.getBoundingClientRect().width > 200), 'wird groß angezeigt');
    assert.equal(await host.textContent('#pixelBtn'), '🔍 Schärfer (1/4)');
    assert.equal(await imgWidth(host, '#clueImg'), 6);
  });

  await t.test('Schärfer: Stufe für Stufe, am Ende das echte Bild', async () => {
    for (const w of [10, 16, 28]) {
      await host.click('#pixelBtn');
      await p.waitForFunction((x) => document.getElementById('img').naturalWidth === x, w);
    }
    assert.equal(await host.textContent('#pixelBtn'), '🖼 Ganzes Bild zeigen');
    await host.click('#pixelBtn');
    await p.waitForFunction(() => document.getElementById('img').naturalWidth === 200);
    assert.ok(!(await p.$eval('#img', (i) => i.classList.contains('pixel'))));
    assert.ok(await host.isHidden('#pixelBtn'));
  });

  await t.test('Aufdecken zeigt sofort das echte Bild', async () => {
    await host.click('#cancel');
    await host.locator('.cell.val').nth(0).click();
    await p.waitForFunction(() => document.getElementById('img').naturalWidth === 6);
    await host.click('#reveal');
    await p.waitForFunction(() => document.getElementById('img').naturalWidth === 200);
    await host.click('#cancel');
  });

  await t.test('Buzzer-Rennen: bei Pixelbildern öffnet der Buzzer sofort, volle Punkte', async () => {
    await host.locator('.cell.val').nth(0).click();
    // auf den Stand dieser Frage warten (übers Relay kann kurz noch der alte ankommen)
    await p.waitForFunction(() => document.getElementById('buzzInfo').textContent === 'Erkannt? Wer zuerst buzzert, darf antworten');
    await p.waitForSelector('#buzzer.live');
    await p.waitForTimeout(250);
    await p.click('#buzzer');
    await host.waitForSelector('.jrow.buzzed');
    // Wer dran ist, sieht einen grünen Knopf; weiteres Drücken sperrt nicht als Frühstart
    await p.waitForSelector('#buzzer.mine');
    assert.equal(await p.textContent('#buzzer'), 'Dran!');
    await p.locator('#buzzer').dispatchEvent('pointerdown');
    await p.waitForTimeout(150);
    assert.ok(await p.isVisible('#buzzer.mine'), 'kein „Zu früh!“');
    await host.locator('.jrow.buzzed .green').click();
    await p.waitForFunction(() => document.querySelector('#overlayScores .score-value').textContent === '100');
    await host.click('#cancel');
  });

  await t.test('Normale Frage: Buzzer bleibt zu', async () => {
    await host.locator('.cell.val').nth(2).click();
    await p.waitForFunction(() => document.getElementById('q').textContent === 'Frage für 100');
    await p.waitForTimeout(600);
    assert.ok(await p.isVisible('#buzzer.wait'));
    assert.equal(await host.isHidden('#buzzStatus'), true);
    await host.click('#cancel');
  });

  await t.test('Bild lässt sich nicht verpixeln: Hinweis für den Host, Spieler sehen nichts', async () => {
    await host.locator('.cell.val').nth(1).click();
    await host.waitForSelector('#pixelHint:not([hidden])');
    assert.match(await host.textContent('#pixelHint'), /hochladen/);
    await p.waitForFunction(() => document.getElementById('q').textContent === 'Frage für 100');
    await p.waitForTimeout(300);
    assert.ok(await p.isHidden('#img'));
  });

  assert.deepEqual(env.errors, []);
});
