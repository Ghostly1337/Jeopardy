// Enthalten bei Multiple Choice / Reihenfolge: 0 Punkte – außer für den, der die Frage ausgesucht hat
const test = require('node:test');
const assert = require('node:assert/strict');
const { startEnv, openHost, joinPlayer } = require('./helpers');

let env;
test.before(async () => { env = await startEnv(); });
test.after(async () => { await env.stop(); });

const scores = (host) => host.$$eval('.pscore', (els) => els.map((e) => e.value).join(','));

test('Enthalten bei Multiple Choice', async () => {
  const { host, code } = await openHost(env, { names: ['Anna', 'Ben', 'Cem'] });
  await host.evaluate(() => {
    const s = J.defaultSet();
    Object.assign(s.rounds[0].categories[0].clues[0], { kind: 'choice', a: 'Richtig | Falsch eins | Falsch zwei | Falsch drei' });
    localStorage.setItem('jeopardy.set', JSON.stringify(s));
  });
  await host.reload();
  await host.waitForFunction(() => document.getElementById('peerStatus').textContent === 'online');
  const anna = await joinPlayer(env, code, { pick: 'Anna' }); // Anna ist am Zug
  const ben = await joinPlayer(env, code, { pick: 'Ben' });
  const cem = await joinPlayer(env, code, { pick: 'Cem' });
  await host.waitForFunction(() => document.querySelectorAll('#players .device').length === 3);
  await host.locator('.cell.val').nth(0).click();

  await ben.waitForSelector('#abstainBtn');
  await anna.waitForSelector('.mc-opt');
  assert.equal(await anna.locator('#abstainBtn').count(), 0, 'wer am Zug ist, kann sich nicht enthalten');
  await anna.waitForFunction(() => document.querySelector('.special-status').textContent.includes('Antworten ist Pflicht'));

  // Ben enthält sich, entscheidet sich um (wählt), enthält sich dann doch wieder
  await ben.click('#abstainBtn');
  await ben.click('.mc-opt:has-text("Falsch eins")');
  await ben.click('#abstainBtn');
  await ben.waitForFunction(() => document.querySelector('.special-status').textContent.includes('Du enthältst dich'));
  await cem.click('.mc-opt:has-text("Falsch zwei")');
  await host.waitForFunction(() => document.getElementById('special').textContent.includes('🤐 enthält sich'));
  assert.match(await host.textContent('#special'), /🎯 … muss antworten/);
  await cem.waitForFunction(() => document.querySelector('.special-status').textContent.startsWith('🅰️ 2/3 haben gewählt'));

  // Auflösen: Anna (am Zug, nichts abgegeben) −50, Ben enthalten 0, Cem falsch −50
  await host.click('#resolveBtn');
  await host.waitForFunction(() => [...document.querySelectorAll('.pscore')].map((e) => e.value).join(',') === '-50,0,-50');
  await ben.waitForSelector('.abstained:has-text("Ben")');
  assert.deepEqual(env.errors, []);
});
