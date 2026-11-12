// Team-Modus: Teamgröße, Beitritt mit eigenem Namen, Buzzern fürs Team, Teampunkte, Siegerehrung
const test = require('node:test');
const assert = require('node:assert/strict');
const { startEnv, openHost, joinPlayer, scoresOf } = require('./helpers');

let env;
test.before(async () => { env = await startEnv({ JEOP_BUZZ_DELAY_MS: 200, JEOP_BUZZ_WINDOW_MS: 600 }); });
test.after(async () => { await env.stop(); });

test('Team-Modus von Beitritt bis Siegerehrung', async (t) => {
  const { host, code } = await openHost(env, { mode: 'team', teamSize: 2, names: ['Rot', 'Blau'] });

  await t.test('Host zeigt Teams mit Teamgröße', async () => {
    assert.ok(await host.isVisible('#teamSizeRow'));
    assert.equal(await host.inputValue('#teamSize'), '2');
    assert.match(await host.textContent('#players'), /Noch niemand beigetreten · 0\/2/);
  });

  let anna, ben, cem;
  await t.test('Ohne Namen kein Beitritt', async () => {
    anna = await joinPlayer(env, code, {});
    assert.equal(await anna.textContent('#pickerTitle'), 'Wähle dein Team');
    await anna.click('.pick:has-text("Rot")');
    assert.match(await anna.textContent('#pickerError'), /Namen/);
    assert.ok(await anna.isVisible('#picker'));
  });

  await t.test('Zwei Spieler treten Team Rot bei, dann ist es voll', async () => {
    await anna.fill('#pickerName', 'Anna');
    await anna.click('.pick:has-text("Rot")');
    ben = await joinPlayer(env, code, { name: 'Ben', pick: 'Rot' });
    await host.waitForFunction(() => document.getElementById('players').textContent.includes('Anna, Ben · 2/2'));
    cem = await joinPlayer(env, code, { name: 'Cem' });
    await cem.waitForSelector('.pick.taken:has-text("Rot")');
    assert.ok(await cem.locator('.pick:has-text("Rot")').isDisabled());
    await cem.click('.pick:has-text("Blau")');
    assert.equal(await cem.textContent('#me'), 'Du: Cem · Blau');
  });

  await t.test('Team Blau falsch → beide Rot-Spieler können buzzern', async () => {
    await host.locator('.cell.val').first().click();
    await host.locator('.jrow').nth(1).locator('.red').click(); // Blau falsch
    await anna.waitForSelector('#buzzer.live');
    await ben.waitForSelector('#buzzer.live');
    assert.ok(await cem.isHidden('#buzzer'));
    await ben.waitForTimeout(250);
    await ben.click('#buzzer');
    await host.waitForFunction(() => document.getElementById('buzzStatus').textContent.includes('Ben (Rot)'));
    assert.equal(await host.textContent('.jrow.buzzed .name'), '⚡ Rot (Ben)');
    await anna.waitForFunction(() => document.getElementById('buzzInfo').textContent === '⚡ Ben aus deinem Team ist dran');
    await ben.waitForFunction(() => document.getElementById('buzzInfo').textContent.startsWith('Du bist dran!'));
    await cem.waitForFunction(() => document.getElementById('buzzInfo').textContent.startsWith('⚡ Ben (Rot) ist dran'));
  });

  await t.test('Punkte zählen nur fürs Team', async () => {
    await host.locator('.jrow.buzzed .green').click();
    await host.click('#close');
    await anna.waitForFunction(() => document.querySelectorAll('#scores .score').length === 2);
    assert.equal(await scoresOf(anna), '50,-50');
    await anna.waitForFunction(() => document.getElementById('turnBanner').textContent.includes('Blau wählt'));
  });

  await t.test('Reaktionen zeigen Name und Team', async () => {
    await anna.setViewportSize({ width: 1280, height: 800 });
    await anna.click('.react-btn:text-is("👏")');
    await host.waitForSelector('.react-float .react-name:text-is("Anna (Rot)")');
  });

  await t.test('Siegerehrung mit Teams, Buzzer-König ist eine Person', async () => {
    await host.click('#finishBtn');
    await cem.waitForSelector('#finish.show .awards');
    assert.equal(await cem.textContent('.pod-winner'), '🏆 Rot');
    await cem.waitForTimeout(1800);
    const aw = await cem.$$eval('.award', (els) => els.map((e) => e.querySelector('.award-title').textContent + '=' + e.querySelector('.award-name').textContent));
    assert.ok(aw.includes('Buzzer-König=Ben (Rot)'), aw.join(' | '));
    assert.ok(aw.includes('Meisterdieb=Rot'), aw.join(' | '));
    assert.ok(aw.includes('Meiste Fehlversuche=Blau'), aw.join(' | '));
    await host.click('#finishBack');
  });

  await t.test('Teamgröße verkleinern wirft niemanden raus', async () => {
    await host.fill('#teamSize', '1');
    await host.locator('#teamSize').blur();
    await host.waitForFunction(() => document.getElementById('players').textContent.includes('Anna, Ben · 2/1'));
    assert.equal(await anna.textContent('#me'), 'Du: Anna · Rot');
  });

  await t.test('Wechsel zurück in den Einzelmodus leert die Liste', async () => {
    await host.click('#modeSingle');
    await anna.waitForSelector('#picker:not([hidden])');
    assert.equal(await anna.textContent('#pickerTitle'), 'Wer bist du?');
    assert.ok(await host.isHidden('#teamSizeRow'));
  });

  assert.deepEqual(env.errors, []);
});
