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
  await host.waitForFunction(() => [...document.querySelectorAll('.pscore')].map((e) => e.value).join(',') === '100,0');
  assert.deepEqual(env.errors, []);
});
