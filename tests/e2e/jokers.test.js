// Joker im Spiel: Doppelt oder nichts, Tipp (nur privat), Weitergeben, Team-Joker
const test = require('node:test');
const assert = require('node:assert/strict');
const { startEnv, openHost, joinPlayer } = require('./helpers');

let env;
test.before(async () => { env = await startEnv({ JEOP_BUZZ_DELAY_MS: 200 }); });
test.after(async () => { await env.stop(); });

// Joker einsetzen: zweimal tippen (Schutz gegen Versehen)
async function useJoker(page, kind) {
  await page.waitForSelector(`.joker[data-kind="${kind}"]:not([disabled])`);
  await page.click(`.joker[data-kind="${kind}"]`);
  await page.waitForSelector(`.joker[data-kind="${kind}"].armed`);
  await page.click(`.joker[data-kind="${kind}"]`);
}
const scores = (host) => host.$$eval('.pscore', (els) => els.map((e) => e.value).join(','));

test('Joker im Einzelmodus', async (t) => {
  const { host, code } = await openHost(env, { names: ['Anna', 'Ben', 'Cem'] });
  const anna = await joinPlayer(env, code, { pick: 'Anna' });
  const ben = await joinPlayer(env, code, { pick: 'Ben' });
  const cem = await joinPlayer(env, code, { pick: 'Cem' });
  const tv = await joinPlayer(env, code, { viewport: { width: 1280, height: 720 } });
  await tv.click('#tvView');
  await host.waitForFunction(() => document.querySelectorAll('#players .device').length === 3);

  await t.test('Ohne offene Frage keine Joker-Leiste', async () => {
    assert.ok(await anna.isHidden('#jokerBar'));
  });

  await t.test('Doppelt oder nichts: einmal tippen reicht nicht, zweimal setzt', async () => {
    await host.locator('.cell.val').nth(2).click(); // 100er
    await anna.waitForSelector('#jokerBar:not([hidden])');
    await anna.click('.joker[data-kind="double"]');
    await anna.waitForTimeout(300);
    assert.equal(await host.isHidden('#jokerStatus'), true, 'erster Tipp setzt noch nichts');
    await anna.click('.joker[data-kind="double"]');
    await host.waitForSelector('#jokerStatus:not([hidden])');
    assert.match(await host.textContent('#jokerStatus'), /🎲 Anna: Doppelt oder nichts/);
    await anna.waitForSelector('.joker-active');
    await tv.waitForFunction(() => document.querySelector('.buzz-show-name').textContent.includes('Doppelt oder nichts'));
    assert.match(await host.textContent('.jrow >> nth=0'), /✓ \+200/);
    await host.locator('.jrow').nth(0).locator('.green').click();
    await host.click('#close');
    await host.waitForFunction(() => document.querySelector('.pscore').value === '200');
  });

  await t.test('Verbrauchter Joker ist ausgegraut', async () => {
    await host.locator('.cell.val').nth(3).click();
    await anna.waitForSelector('.joker[data-kind="double"].used[disabled]');
    assert.ok(await anna.locator('.joker[data-kind="hint"]').isEnabled());
    await host.click('#cancel');
  });

  await t.test('Weitergeben: nur wer am Zug ist; Ziel muss antworten', async () => {
    // Nach „Fertig“ ist Ben am Zug
    await host.locator('.cell.val').nth(4).click();
    await anna.waitForSelector('.joker[data-kind="pass"][disabled]');
    await ben.waitForSelector('.joker[data-kind="pass"]:not([disabled])');
    await ben.click('.joker[data-kind="pass"]');
    await ben.click('.joker-targets button[data-target]:text-is("Cem")');
    await cem.waitForFunction(() => document.getElementById('buzzInfo').textContent === '👉 Ben gibt an dich weiter – du bist dran!');
    await anna.waitForFunction(() => document.getElementById('buzzInfo').textContent === '👉 Ben gibt weiter an Cem');
    await host.waitForSelector('.jrow.buzzed .name:text-is("👉 Cem")');
    await tv.waitForFunction(() => document.querySelector('.buzz-show-name').textContent === '👉 Ben → Cem');
  });

  await t.test('Tipp: nur Cem sieht Anfangsbuchstaben und Länge', async () => {
    await useJoker(cem, 'hint');
    await cem.waitForSelector('#hintBox:not([hidden])');
    assert.equal(await cem.textContent('.hint-text'), 'A _ _ _ _ _ _');
    await anna.waitForTimeout(400);
    for (const p of [anna, ben, tv]) {
      assert.ok(await p.isHidden('#hintBox'));
      assert.ok(!(await p.content()).includes('A _ _ _ _ _ _'), 'Tipp nur beim Nutzer');
    }
  });

  await t.test('Cem falsch → normaler halber Abzug, Buzzer öffnet für die anderen', async () => {
    await host.locator('.jrow.buzzed .red').click();
    await anna.waitForSelector('#buzzer.live');
    await host.waitForFunction(() => [...document.querySelectorAll('.pscore')].map((e) => e.value).join(',') === '200,0,-50');
    await host.click('#cancel');
  });

  await t.test('Rückgängig gibt den Joker zurück', async () => {
    await host.click('#undo'); // Abbrechen
    await host.click('#undo'); // Cem falsch
    await host.click('#undo'); // Tipp
    await cem.waitForSelector('.joker[data-kind="hint"]:not(.used)');
    assert.equal(await scores(host), '200,0,0');
  });

  assert.deepEqual(env.errors, []);
});

test('Joker zählen pro Team', async () => {
  const { host, code } = await openHost(env, { mode: 'team', teamSize: 2, names: ['Rot', 'Blau'] });
  const anna = await joinPlayer(env, code, { name: 'Anna', pick: 'Rot' });
  const ben = await joinPlayer(env, code, { name: 'Ben', pick: 'Rot' });
  await host.waitForFunction(() => document.getElementById('players').textContent.includes('Anna, Ben'));
  await host.locator('.cell.val').nth(0).click();
  await useJoker(anna, 'double');
  await host.waitForFunction(() => document.getElementById('jokerStatus').textContent.includes('🎲 Rot'));
  await ben.waitForSelector('.joker[data-kind="double"].used[disabled]');
  await ben.waitForSelector('.joker-active');
  assert.deepEqual(env.errors, []);
});

test('Joker gelten fürs ganze Spiel, nicht pro Runde', async () => {
  const { host, code } = await openHost(env, { names: ['Anna', 'Ben'] });
  const anna = await joinPlayer(env, code, { pick: 'Anna' });
  await host.locator('.cell.val').nth(4).click(); // Runde 1
  await useJoker(anna, 'double');
  await host.waitForSelector('#jokerStatus:not([hidden])');
  await host.click('#cancel');
  await host.click('#r1'); // Runde 2
  await host.click('#introSkip');
  await host.locator('.cell.val').nth(18).click(); // 800er
  await anna.waitForFunction(() => document.getElementById('meta').textContent.endsWith('800'));
  await anna.waitForSelector('.joker[data-kind="double"].used[disabled]');
  assert.ok(await anna.locator('.joker[data-kind="hint"]').isEnabled(), 'andere Joker bleiben');
  assert.deepEqual(env.errors, []);
});
