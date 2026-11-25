// Tipp-Joker: Art des Tipps pro Frage im Editor einstellbar (eigener Text, kein Tipp, …)
const test = require('node:test');
const assert = require('node:assert/strict');
const { startEnv, openHost, joinPlayer, SERVER, HOST_PASSWORD } = require('./helpers');

let env;
test.before(async () => { env = await startEnv(); });
test.after(async () => { await env.stop(); });

async function useJoker(page, kind) {
  await page.waitForSelector(`.joker[data-kind="${kind}"]:not([disabled])`);
  await page.click(`.joker[data-kind="${kind}"]`);
  await page.waitForSelector(`.joker[data-kind="${kind}"].armed`);
  await page.click(`.joker[data-kind="${kind}"]`);
}

test('Tipp-Art pro Frage', async (t) => {
  const { host, code } = await openHost(env, { names: ['Anna', 'Ben'] });
  const ed = await host.context().newPage();
  await ed.goto(env.base + '/editor.html');
  if (SERVER) {
    await ed.waitForSelector('#pwForm:not([hidden])');
    await ed.fill('#hostPw', HOST_PASSWORD);
    await ed.click('#pwForm button');
  }
  await ed.waitForFunction(() => !document.getElementById('setSelect').disabled);
  // Übers Relay erst weiter, wenn die Server-Bibliothek geladen ist (sonst überschreibt sie die Änderungen)
  if (SERVER) await ed.waitForFunction(() => document.getElementById('setSource').textContent.includes('Server'));
  await host.waitForSelector('.cell.cat:text-is("Kategorie 1")');
  const clue = (cat, row) => ed.locator('.ed-cat').nth(cat).locator('.ed-clue').nth(row);
  const anna = await joinPlayer(env, code, { pick: 'Anna' });
  const ben = await joinPlayer(env, code, { pick: 'Ben' });

  await t.test('Editor: Vorschau zeigt, was der Spieler sieht', async () => {
    const c = clue(0, 0);
    await c.locator('input').first().fill('Kellerautomat');
    assert.equal(await c.locator('.ed-hint-preview').textContent(), 'Spieler sieht: K _ _ _ _ _ _ _ _ _ _ _ _');
    await c.locator('.ed-hint select').selectOption('firstlast');
    assert.equal(await c.locator('.ed-hint-preview').textContent(), 'Spieler sieht: K _ _ _ _ _ _ _ _ _ _ _ t');
    assert.ok(await c.locator('.ed-hint-text').isHidden());
    await c.locator('.ed-hint select').selectOption('custom');
    await c.locator('.ed-hint-text').fill('Hat einen Stack');
    assert.equal(await c.locator('.ed-hint-preview').textContent(), 'Spieler sieht: Hat einen Stack');
    await clue(1, 0).locator('.ed-hint select').selectOption('none');
    assert.equal(await clue(1, 0).locator('.ed-hint-preview').textContent(), 'Tipp-Joker ist bei dieser Frage gesperrt');
    // Erst weiter, wenn gespeichert ist (übers Relay zusätzlich auf dem Server)
    if (SERVER) await ed.waitForFunction(() => document.getElementById('saved').textContent.includes('Server gespeichert'));
    // Zuletzt eine sichtbare Änderung: Zeigt das Host-Pult sie, hat es auch die Tipp-Einstellungen
    await ed.locator('.ed-cat input').first().fill('Tipp-Test');
    await host.waitForSelector('.cell.cat:text-is("Tipp-Test")');
  });

  await t.test('Eigener Tipp kommt nur beim Nutzer an', async () => {
    await host.locator('.cell.val').nth(0).click();
    await useJoker(anna, 'hint');
    await anna.waitForSelector('#hintBox:not([hidden])');
    assert.equal(await anna.textContent('.hint-text'), 'Hat einen Stack');
    await host.waitForFunction(() => document.getElementById('jokerStatus').textContent.includes('Tipp (Hat einen Stack)'));
    assert.ok(await ben.isHidden('#hintBox'));
    await host.click('#cancel');
  });

  await t.test('„Kein Tipp möglich“ sperrt den Joker', async () => {
    await host.locator('.cell.val').nth(1).click();
    for (const p of [ben]) { // Anna hat ihren Tipp schon verbraucht
      await p.waitForSelector('#jokerBar:not([hidden])');
      await p.waitForFunction(() => {
        const b = document.querySelector('.joker[data-kind="hint"]');
        return b && b.disabled && b.title === 'Bei dieser Frage gibt es keinen Tipp';
      });
    }
    await host.click('#cancel');
  });

  assert.deepEqual(env.errors, []);
});
