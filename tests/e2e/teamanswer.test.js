// Team-Modus bei Multiple Choice: alle im Team sehen die aktuelle Teamabgabe
const test = require('node:test');
const assert = require('node:assert/strict');
const { startEnv, openHost, joinPlayer } = require('./helpers');

let env;
test.before(async () => { env = await startEnv(); });
test.after(async () => { await env.stop(); });

const scores = (host) => host.$$eval('.pscore', (els) => els.map((e) => e.value).join(','));

test('Team-Modus: alle im Team sehen, was fürs Team abgegeben wurde', async () => {
  const { host, code } = await openHost(env, { mode: 'team', teamSize: 2, names: ['Rot', 'Blau'] });
  await host.evaluate(() => {
    const s = J.defaultSet();
    Object.assign(s.rounds[0].categories[0].clues[0], { kind: 'choice', a: 'Richtig | Falsch eins | Falsch zwei | Falsch drei' });
    localStorage.setItem('jeopardy.set', JSON.stringify(s));
  });
  await host.reload();
  await host.waitForFunction(() => document.getElementById('peerStatus').textContent === 'online');
  const anna = await joinPlayer(env, code, { name: 'Anna', pick: 'Rot' });
  const ben = await joinPlayer(env, code, { name: 'Ben', pick: 'Rot' });
  await host.waitForFunction(() => document.getElementById('players').textContent.includes('Anna, Ben'));
  await host.locator('.cell.val').nth(0).click();
  await anna.waitForSelector('.mc-opt');
  await anna.click('.mc-opt:has-text("Falsch eins")');
  // Ben sieht Annas Wahl
  await ben.waitForFunction(() => document.querySelector('.mc-opt.picked')?.textContent.includes('Falsch eins'));
  await ben.waitForFunction(() => document.querySelector('.special-status').textContent.includes('Anna hat für euch abgegeben'));
  // Ben ändert, Anna sieht die neue Teamwahl
  await ben.click('.mc-opt:has-text("Richtig")');
  await anna.waitForFunction(() => document.querySelector('.mc-opt.picked')?.textContent.includes('Richtig'));
  await anna.waitForFunction(() => document.querySelector('.special-status').textContent.includes('Ben hat für euch abgegeben'));
  await host.waitForFunction(() => document.getElementById('special').textContent.includes('✓ Richtig'));
  await host.click('#resolveBtn');
  // Rot richtig +100; Blau hat nichts abgegeben → zählt wie falsch (−50), Enthalten gibt es nicht
  await host.waitForFunction(() => [...document.querySelectorAll('.pscore')].map((e) => e.value).join(',') === '100,-50');
  assert.deepEqual(env.errors, []);
});

test('Team-Modus: Reihenfolge und Schätzfrage sind live auf allen Team-Geräten gleich', async (t) => {
  const { host, code } = await openHost(env, { mode: 'team', teamSize: 3, names: ['Rot', 'Blau'] });
  await host.evaluate(() => {
    const s = J.defaultSet();
    Object.assign(s.rounds[0].categories[0].clues[0], { kind: 'order', a: 'Eins | Zwei | Drei | Vier' });
    Object.assign(s.rounds[0].categories[1].clues[0], { kind: 'estimate', a: '1024' });
    localStorage.setItem('jeopardy.set', JSON.stringify(s));
  });
  await host.reload();
  await host.waitForFunction(() => document.getElementById('peerStatus').textContent === 'online');
  const anna = await joinPlayer(env, code, { name: 'Anna', pick: 'Rot' });
  const ben = await joinPlayer(env, code, { name: 'Ben', pick: 'Rot' });
  const cem = await joinPlayer(env, code, { name: 'Cem', pick: 'Blau' });
  await host.waitForFunction(() => document.getElementById('players').textContent.includes('Anna, Ben'));
  const order = (p) => p.$$eval('.order-list.editable li span', (els) => els.map((e) => e.textContent).join(','));

  await t.test('Verschieben bei Anna erscheint sofort bei Ben, nicht beim anderen Team', async () => {
    await host.locator('.cell.val').nth(0).click();
    await anna.waitForSelector('.order-list.editable li');
    await ben.waitForSelector('.order-list.editable li');
    const start = await order(anna);
    assert.equal(await order(ben), start, 'gleiche Startreihenfolge');
    const cemStart = await order(cem);
    await anna.locator('.order-list.editable li').nth(0).locator('button:text-is("▼")').click();
    const moved = await order(anna);
    assert.notEqual(moved, start);
    await ben.waitForFunction((m) => [...document.querySelectorAll('.order-list.editable li span')].map((e) => e.textContent).join(',') === m, moved);
    // Ben verschiebt weiter, Anna sieht es
    await ben.locator('.order-list.editable li').nth(3).locator('button:text-is("▲")').click();
    const moved2 = await order(ben);
    await anna.waitForFunction((m) => [...document.querySelectorAll('.order-list.editable li span')].map((e) => e.textContent).join(',') === m, moved2);
    await anna.waitForTimeout(300);
    assert.equal(await order(cem), cemStart, 'anderes Team bleibt unberührt');
  });

  await t.test('Wer neu verbindet, bekommt den Team-Stand', async () => {
    const want = await order(anna);
    await ben.reload();
    await ben.waitForFunction((m) => [...document.querySelectorAll('.order-list.editable li span')].map((e) => e.textContent).join(',') === m, want);
    await anna.click('#orderSend');
    await ben.waitForFunction(() => document.getElementById('orderSend').textContent.startsWith('Abgegeben'));
    await host.click('#cancel');
  });

  await t.test('Schätzfrage: getippte Zahl erscheint live im Team', async () => {
    await host.locator('.cell.val').nth(1).click();
    await anna.waitForSelector('#estInput');
    await ben.waitForSelector('#estInput');
    await anna.fill('#estInput', '1000');
    await ben.waitForFunction(() => document.getElementById('estInput').value === '1000');
    await ben.fill('#estInput', '1024');
    await anna.waitForFunction(() => document.getElementById('estInput').value === '1024');
    await anna.waitForTimeout(300);
    assert.equal(await cem.inputValue('#estInput'), '', 'anderes Team sieht nichts');
    await ben.click('.est-form button');
    await anna.waitForFunction(() => document.querySelector('.special-status').textContent.includes('Euer Tipp: 1.024'));
  });

  assert.deepEqual(env.errors, []);
});
