// Neue Spielformen: Schätzfrage, Reihenfolge, Zoom-Bild
const test = require('node:test');
const assert = require('node:assert/strict');
const { startEnv, joinPlayer, HOST_PASSWORD } = require('./helpers');

let env;
test.before(async () => { env = await startEnv({ JEOP_BUZZ_DELAY_MS: 200 }); });
test.after(async () => { await env.stop(); });

const CORRECT = ['Game Boy', 'PlayStation', 'Wii', 'Switch'];
const scores = (host) => host.$$eval('.pscore', (els) => els.map((e) => e.value).join(','));

// Liste mit ▲ in die gewünschte Reihenfolge bringen (Bubblesort über die Knöpfe)
async function sortTo(page, target) {
  // je Klick eine Vertauschung; bei 4 Begriffen höchstens 6 nötig
  for (let swaps = 0; swaps < 10; swaps++) {
    const items = await page.$$eval('.order-list.editable li span', (els) => els.map((e) => e.textContent));
    const i = items.findIndex((it, k) => k > 0 && target.indexOf(it) < target.indexOf(items[k - 1]));
    if (i < 0) return;
    await page.locator('.order-list.editable li').nth(i).locator('button:text-is("▲")').click();
  }
}

test('Schätzfrage, Reihenfolge und Zoom-Bild', async (t) => {
  const ed = await env.page();
  await ed.goto(env.base + '/editor.html');
  await ed.evaluate(() => localStorage.clear());
  await ed.reload();
  // Übers Relay (wie auf Vercel) erst das Host-Passwort für die Set-Bibliothek
  await ed.waitForFunction(() => !document.getElementById('setSelect').disabled || !document.getElementById('pwForm').hidden);
  if (await ed.isVisible('#pwForm')) {
    await ed.fill('#hostPw', HOST_PASSWORD);
    await ed.click('#pwForm button');
  }
  await ed.waitForFunction(() => !document.getElementById('setSelect').disabled);

  await t.test('Editor: Fragenart und Zoom einstellbar', async () => {
    const clue = ed.locator('.ed-cat').nth(0).locator('.ed-clue').first();
    await clue.locator('.ed-kind').selectOption('estimate');
    assert.equal(await clue.locator('input').nth(0).getAttribute('placeholder'), 'Richtige Zahl, z. B. 330');
    await ed.waitForFunction(() => JSON.parse(localStorage.getItem('jeopardy.set')).rounds[0].categories[0].clues[0].kind === 'estimate');
  });

  // Testdaten direkt ins Set
  await ed.evaluate((correct) => {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 120;
    const g = c.getContext('2d');
    g.fillStyle = '#e11'; g.fillRect(0, 0, 100, 120);
    g.fillStyle = '#11e'; g.fillRect(100, 0, 100, 120);
    const s = JSON.parse(localStorage.getItem('jeopardy.set'));
    Object.assign(s.rounds[0].categories[0].clues[0], { kind: 'estimate', q: 'Wie hoch ist der Eiffelturm (m)?', a: '330' });
    Object.assign(s.rounds[0].categories[1].clues[0], { kind: 'order', q: 'Nach Erscheinungsjahr', a: correct.join(' | ') });
    Object.assign(s.rounds[0].categories[2].clues[0], { img: c.toDataURL('image/png'), zoom: true, zoomAt: { x: 0.25, y: 0.5 }, a: 'Flagge' });
    localStorage.setItem('jeopardy.set', JSON.stringify(s));
  }, CORRECT);

  const host = await ed.context().newPage();
  await host.goto(env.base + '/host.html');
  await host.waitForFunction(() => document.getElementById('peerStatus').textContent === 'online');
  for (const n of ['Anna', 'Ben']) { await host.fill('#newName', n); await host.click('#addForm button'); }
  const code = await host.textContent('#code');
  const anna = await joinPlayer(env, code, { pick: 'Anna' });
  const ben = await joinPlayer(env, code, { pick: 'Ben' });
  const tv = await joinPlayer(env, code, { viewport: { width: 1280, height: 720 } });
  await tv.click('#tvView');
  await host.waitForFunction(() => document.querySelectorAll('#players .device').length === 2);

  await t.test('Schätzfrage: alle tippen, Werte bleiben geheim', async () => {
    await host.locator('.cell.val').nth(0).click();
    await anna.waitForSelector('#estInput');
    assert.ok(await anna.isHidden('#buzzer'), 'kein Buzzer');
    assert.ok(await anna.isHidden('#jokerBar'), 'keine Joker');
    assert.ok(await host.isHidden('#judge') && await host.isVisible('#resolveBtn'));
    await anna.fill('#estInput', '300');
    await anna.press('#estInput', 'Enter');
    await ben.fill('#estInput', '400');
    await ben.press('#estInput', 'Enter');
    await ben.fill('#estInput', '350'); // Tipp ändern geht bis zum Auflösen
    await ben.click('.est-form button');
    await tv.waitForFunction(() => document.querySelector('.special-status').textContent === '🔢 2/2 haben getippt');
    await host.waitForFunction(() => document.getElementById('special').textContent.includes('350'));
    assert.ok(!(await tv.content()).includes('350'), 'TV sieht keine Tipps');
    await anna.waitForFunction(() => document.querySelector('.special-status').textContent.includes('Dein Tipp: 300 ✓'));
  });

  await t.test('Schätzfrage auflösen: Nächster bekommt die Punkte', async () => {
    await host.click('#resolveBtn');
    await tv.waitForSelector('.est-result');
    assert.equal(await tv.textContent('.est-answer'), 'Richtig: 330');
    assert.match(await tv.textContent('.est-list li.won'), /Ben/);
    await host.waitForFunction(() => [...document.querySelectorAll('.pscore')].map((e) => e.value).join(',') === '0,100');
    await host.click('#close');
  });

  await t.test('Reihenfolge: gemischt anzeigen, sortieren, abgeben', async () => {
    await host.locator('.cell.val').nth(1).click();
    await anna.waitForSelector('.order-list.editable');
    const shown = await tv.$$eval('.order-list li span', (els) => els.map((e) => e.textContent));
    assert.equal(shown.length, 4);
    assert.notDeepEqual(shown, CORRECT, 'nicht schon richtig sortiert');
    await sortTo(anna, CORRECT);
    assert.deepEqual(await anna.$$eval('.order-list.editable li span', (els) => els.map((e) => e.textContent)), CORRECT);
    await anna.click('#orderSend');
    await ben.click('#orderSend'); // Ben gibt die gemischte Liste ab
    await tv.waitForFunction(() => document.querySelector('.special-status').textContent === '↕️ 2/2 haben abgegeben');
    await host.click('#resolveBtn');
    await tv.waitForSelector('.order-result');
    assert.deepEqual(await tv.$$eval('.order-list.solved li span', (els) => els.map((e) => e.textContent)), CORRECT);
    assert.match(await tv.textContent('.order-winners'), /Anna/);
    await host.waitForFunction(() => [...document.querySelectorAll('.pscore')].map((e) => e.value).join(',') === '100,100');
    await host.click('#close');
  });

  await t.test('Rückgängig nimmt die Auflösung zurück', async () => {
    await host.click('#undo'); // Fertig
    await host.click('#undo'); // Auflösen
    await host.waitForFunction(() => [...document.querySelectorAll('.pscore')].map((e) => e.value).join(',') === '0,100');
    await anna.waitForSelector('.order-list.editable');
    await host.click('#cancel');
  });

  await t.test('Zoom-Bild: nur Ausschnitt, zoomt raus, Buzzer-Rennen', async () => {
    await host.locator('.cell.val').nth(2).click();
    await anna.waitForSelector('#buzzer.live');
    await anna.waitForFunction(() => document.getElementById('img').naturalWidth === 480);
    assert.ok(await anna.$eval('#img', (i) => i.classList.contains('zoomed')));
    // Ausschnitt um x=0,25 → komplett rot
    const color = await anna.evaluate(() => {
      const i = document.getElementById('img'); const c = document.createElement('canvas');
      c.width = i.naturalWidth; c.height = i.naturalHeight; const g = c.getContext('2d'); g.drawImage(i, 0, 0);
      return [...g.getImageData(c.width - 2, c.height / 2, 1, 1).data].slice(0, 3);
    });
    assert.ok(color[0] > 200 && color[2] < 60, 'nur der rote Teil sichtbar: ' + color);
    assert.equal(await host.textContent('#pixelBtn'), '🔍 Rauszoomen (1/4)');
    for (let i = 0; i < 4; i++) await host.click('#pixelBtn');
    await anna.waitForFunction(() => document.getElementById('img').naturalWidth === 200);
    assert.ok(await host.isHidden('#pixelBtn'));
  });

  assert.deepEqual(env.errors, []);
});
