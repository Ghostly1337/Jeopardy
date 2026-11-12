// Beitreten: leerer Raum, eindeutige Namen, Gerät trennen, Zuschauer, TV-Ansicht
const test = require('node:test');
const assert = require('node:assert/strict');
const { startEnv, openHost, joinPlayer } = require('./helpers');

let env;
test.before(async () => { env = await startEnv(); });
test.after(async () => { await env.stop(); });

test('Leerer Raum: nur TV und Zuschauen, Namen erscheinen live', async () => {
  const { host, code } = await openHost(env);
  const p = await joinPlayer(env, code, {});
  assert.equal(await p.locator('.pick').count(), 0);
  assert.ok(await p.isVisible('#pickerEmpty'));
  assert.ok(await p.isVisible('#tvView'));
  assert.ok(await p.isVisible('#watchOnly'));
  await host.fill('#newName', 'Anna');
  await host.click('#addForm button');
  await p.waitForSelector('.pick:text-is("Anna")');
  assert.ok(await p.isHidden('#pickerEmpty'));
  await p.click('.pick:text-is("Anna")');
  assert.ok(await p.isHidden('#picker'));
  await host.context().close();
  await p.context().close();
});

test('Ein Name gehört genau einem Gerät', async (t) => {
  const { host, code } = await openHost(env, { names: ['Anna', 'Ben'] });
  const a = await joinPlayer(env, code, {});
  const b = await joinPlayer(env, code, {});

  let winner, loser;
  await t.test('Gleichzeitig denselben Namen wählen: nur einer bekommt ihn', async () => {
    // Beide Klicks ohne Wartezeit auslösen (Playwright würde auf den ausgegrauten Knopf warten)
    const clickAnna = (pg) => pg.evaluate(() => [...document.querySelectorAll('.pick')].find((b) => b.textContent === 'Anna').click());
    await Promise.all([clickAnna(a), clickAnna(b)]);
    await host.waitForFunction(() => document.querySelectorAll('#players .device').length === 1);
    await a.waitForTimeout(800);
    const aOk = await a.isHidden('#picker');
    assert.notEqual(aOk, await b.isHidden('#picker'));
    [winner, loser] = aOk ? [a, b] : [b, a];
    assert.match(await loser.textContent('#pickerError'), /anderen Gerät/);
    assert.ok(await loser.locator('.pick.taken:text-is("Anna")').isDisabled());
    await loser.click('.pick:text-is("Ben")');
    await host.waitForFunction(() => document.querySelectorAll('#players .device').length === 2);
  });

  await t.test('Dasselbe Gerät behält seinen Namen nach Reload', async () => {
    await winner.reload();
    await winner.waitForSelector('#board:not([hidden])');
    await winner.waitForTimeout(1200);
    assert.ok(await winner.isHidden('#picker'));
    assert.equal(await winner.textContent('#me'), 'Du: Anna');
  });

  await t.test('Host kann ein Gerät trennen, der Name wird frei', async () => {
    const c = await joinPlayer(env, code, {});
    await c.waitForFunction(() => document.querySelectorAll('.pick.taken').length === 2);
    await host.locator('#players .prow').nth(0).locator('.device').click();
    await winner.waitForSelector('#picker:not([hidden])');
    assert.match(await winner.textContent('#pickerError'), /getrennt/);
    await c.waitForFunction(() => document.querySelectorAll('.pick.taken').length === 1);
    await c.click('.pick:text-is("Anna")');
    assert.equal(await c.textContent('#me'), 'Du: Anna');
  });
  await host.context().close();
});

test('Zuschauer und TV-Ansicht', async (t) => {
  const { host, code } = await openHost(env, { names: ['Anna'] });
  const watcher = await joinPlayer(env, code, {});
  const tv = await joinPlayer(env, code, { viewport: { width: 1920, height: 1080 } });

  await t.test('Zuschauer hat Reaktionen, aber keinen Buzzer', async () => {
    await watcher.click('#watchOnly');
    assert.equal(await watcher.textContent('#me'), '👀 Zuschauer');
    assert.ok(await watcher.isVisible('#reactBar'));
  });

  await t.test('TV-Ansicht: großes Board, keine Bedienelemente', async () => {
    await tv.click('#tvView');
    assert.equal(await tv.textContent('#me'), '📺 TV');
    assert.ok(await tv.evaluate(() => document.body.classList.contains('tv')));
    assert.ok(await tv.isHidden('#reactBar'));
    assert.ok(await tv.isVisible('#fullBtn'));
    await host.locator('.cell.val').first().click();
    await tv.waitForSelector('#overlay.show');
    assert.ok(await tv.isHidden('#buzzer'));
    // Die TV-Ansicht zählt nicht als Spieler
    assert.equal(await host.locator('#players .device').count(), 0);
  });

  assert.deepEqual(env.errors, []);
});
