// Buzzer: Timer, Wartezustand, Frühstart-Sperre, Anti-Spam, fairer Buzzer, Klauen
const test = require('node:test');
const assert = require('node:assert/strict');
const { startEnv, openHost, joinPlayer, scoresOf } = require('./helpers');

let env;
test.before(async () => {
  env = await startEnv({ JEOP_TIMER_MS: 2500, JEOP_BUZZ_DELAY_MS: 400, JEOP_BUZZ_WINDOW_MS: 1200 });
});
test.after(async () => { await env.stop(); });

// Warten bis der Buzzer scharf ist, dann „menschlich“ drücken
async function buzzCalmly(page, delay = 250) {
  await page.waitForSelector('#buzzer.live');
  await page.waitForTimeout(delay);
  await page.click('#buzzer');
}

test('Buzzer-Ablauf mit drei Spielern', async (t) => {
  const { host, code } = await openHost(env, { names: ['Anna', 'Ben', 'Cem'] });
  const anna = await joinPlayer(env, code, { pick: 'Anna' });
  const ben = await joinPlayer(env, code, { pick: 'Ben' });
  const cem = await joinPlayer(env, code, { pick: 'Cem' });
  await host.waitForFunction(() => document.querySelectorAll('#players .device').length === 3);

  await host.locator('.cell.val').first().click();
  await anna.waitForSelector('#overlay.show');

  await t.test('Buzzer ist sofort sichtbar, aber grau', async () => {
    await anna.waitForSelector('#buzzer.wait');
    assert.equal(await anna.textContent('#buzzer'), 'Noch nicht');
  });

  await t.test('Buzzer-Text ist nicht markierbar', async () => {
    const sel = await anna.$eval('#buzzer', (b) => getComputedStyle(b).userSelect || getComputedStyle(b).webkitUserSelect);
    assert.equal(sel, 'none');
  });

  await t.test('Drücken auf den grauen Buzzer sperrt kurz', async () => {
    await anna.click('#buzzer');
    await anna.waitForSelector('#buzzer.locked');
    assert.equal(await anna.textContent('#buzzer'), 'Zu früh!');
    await anna.waitForSelector('#buzzer.wait', { timeout: 3000 });
  });

  await t.test('Timer läuft bei allen und meldet das Ende', async () => {
    await host.click('#timerBtn');
    await anna.waitForSelector('#timerBox:not([hidden])');
    await anna.waitForFunction(() => window.__sfx.includes('timeup'), null, { timeout: 6000 });
    assert.ok(await anna.isHidden('#timerBox'));
  });

  await t.test('Nach „falsch“ öffnet der Buzzer erst nach einer Pause', async () => {
    await host.locator('.jrow').nth(1).locator('.red').click(); // Ben falsch
    await host.waitForFunction(() => document.getElementById('buzzStatus').textContent.includes('gleich'));
    assert.ok(await anna.isVisible('#buzzer.wait'), 'direkt nach ✗ noch grau');
    await anna.waitForSelector('#buzzer.live', { timeout: 3000 });
    assert.ok(await ben.isHidden('#buzzer'), 'Ben lag falsch und darf nicht mehr');
    assert.equal(await anna.textContent('#buzzInfo'), 'Klauen bringt +50');
  });

  await t.test('Wer vorher hämmert, verliert gegen ruhiges Drücken', async () => {
    // Zurück vor die Öffnung: Ben falsch rückgängig und erneut falsch → neue Buzzer-Runde
    await host.click('#undo');
    await host.locator('.jrow').nth(1).locator('.red').click();
    // Cem hämmert schon während der Pause ununterbrochen auf den Buzzer
    await cem.evaluate(() => {
      window.__spam = setInterval(() => {
        document.getElementById('buzzer').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      }, 60);
    });
    await buzzCalmly(anna, 300);
    await host.waitForFunction(() => document.querySelector('.jrow.buzzed'), null, { timeout: 5000 });
    await cem.evaluate(() => clearInterval(window.__spam));
    assert.equal(await host.textContent('.jrow.buzzed .name'), '⚡ Anna');
    await cem.waitForFunction(() => document.getElementById('buzzInfo').textContent.includes('Anna'));
  });

  await t.test('Fairer Buzzer: schnellere Reaktion schlägt frühere Ankunft', async () => {
    await host.click('#undo'); // Buzz rückgängig → Buzzer wieder offen
    await host.click('#undo'); // Ben falsch rückgängig
    await host.locator('.jrow').nth(1).locator('.red').click();
    // Anna: Uhr manipulieren → ihre gemessene Reaktion ist 0,9 s langsamer
    await anna.evaluate(() => {
      const o = performance.now.bind(performance); let off = 0;
      performance.now = () => o() + off; window.__slow = () => { off = 900; };
    });
    await anna.waitForSelector('#buzzer.live');
    await cem.waitForSelector('#buzzer.live');
    await anna.evaluate(() => window.__slow());
    await anna.waitForTimeout(200);
    await anna.click('#buzzer'); // kommt zuerst an
    await cem.waitForTimeout(150);
    await cem.click('#buzzer'); // später, aber schneller reagiert
    await host.waitForFunction(() => document.querySelector('.jrow.buzzed'), null, { timeout: 5000 });
    assert.equal(await host.textContent('.jrow.buzzed .name'), '⚡ Cem');
    assert.match(await host.textContent('#buzzStatus'), /Cem hat gebuzzert.*danach: Anna/);
    await anna.waitForFunction(() => document.getElementById('buzzInfo').textContent.startsWith('⚡ Cem war schneller'));
  });

  await t.test('Cem klaut: halbe Punkte, Buzzer danach zu', async () => {
    await host.locator('.jrow.buzzed .green').click();
    await anna.waitForFunction(() => document.getElementById('a').textContent === 'Antwort');
    assert.equal(await scoresOf(anna, '#overlayScores'), '0,-50,50');
    assert.ok(await anna.isHidden('#buzzer'));
    const sfx = await anna.evaluate(() => window.__sfx);
    for (const s of ['open', 'tick', 'timeup', 'wrong', 'buzzopen', 'buzz', 'right']) assert.ok(sfx.includes(s), 'Sound fehlt: ' + s);
  });

  assert.deepEqual(env.errors, []);
});
