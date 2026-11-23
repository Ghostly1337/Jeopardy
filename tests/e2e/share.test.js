// Punkteverteilung: Wer am Zug ist, bekommt volle Punkte, alle anderen Richtigen nur einen Anteil
// (Einstellung im Host-Pult, Standard 50 %). Nach Spielbeginn gesperrt.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startEnv, openHost, joinPlayer } = require('./helpers');

let env;
test.before(async () => { env = await startEnv(); });
test.after(async () => { await env.stop(); });

const scores = (host) => host.$$eval('.pscore', (els) => els.map((e) => e.value).join(','));

async function setup(mode = 'single') {
  const { host, code } = await openHost(env, mode === 'team' ? { mode, teamSize: 2, names: ['Rot', 'Blau'] } : { names: ['Anna', 'Ben'] });
  await host.evaluate(() => {
    const s = J.defaultSet();
    Object.assign(s.rounds[0].categories[0].clues[0], { kind: 'choice', a: 'Richtig | Falsch' });
    Object.assign(s.rounds[0].categories[1].clues[0], { kind: 'estimate', a: '100' });
    localStorage.setItem('jeopardy.set', JSON.stringify(s));
  });
  await host.reload();
  await host.waitForFunction(() => document.getElementById('peerStatus').textContent === 'online');
  return { host, code };
}

test('Standard 50 %: Am Zug voll, alle anderen halb (Multiple Choice)', async () => {
  const { host, code } = await setup();
  assert.equal(await host.inputValue('#otherShare'), '50');
  const anna = await joinPlayer(env, code, { pick: 'Anna' });
  const ben = await joinPlayer(env, code, { pick: 'Ben' });
  await host.locator('.cell.val').nth(0).click(); // Anna ist am Zug
  for (const p of [anna, ben]) {
    await p.waitForSelector('.mc-opt');
    await p.waitForFunction(() => document.querySelector('.special-status').textContent.includes('Wer nicht am Zug ist, bekommt 50 %'));
    await p.click('.mc-opt:has-text("Richtig")');
  }
  await host.waitForFunction(() => document.getElementById('special').textContent.match(/✓ Richtig/g)?.length === 2);
  assert.match(await host.textContent('#special'), /alle anderen/);
  await host.click('#resolveBtn');
  await host.waitForFunction(() => [...document.querySelectorAll('.pscore')].map((e) => e.value).join(',') === '100,50');
  assert.match(await host.textContent('#special'), /🎯 Anna.*\+100/s);
  assert.match(await host.textContent('#log'), /Anna \+100, Ben \+50/);
  // Rückgängig stellt beides wieder her
  await host.click('#undo');
  assert.equal(await scores(host), '0,0');
  await host.close();
  assert.deepEqual(env.errors, []);
});

test('Einstellung ist nach Spielbeginn gesperrt, Zurücksetzen gibt sie frei', async () => {
  const { host } = await setup();
  await host.selectOption('#otherShare', '25');
  await host.locator('.cell.val').nth(0).click();
  assert.ok(await host.isDisabled('#otherShare'));
  assert.match(await host.textContent('#otherShareNote'), /Gesperrt/);
  await host.click('#cancel');
  await host.click('#resetGame');
  await host.waitForFunction(() => !document.getElementById('otherShare').disabled);
  assert.equal(await host.inputValue('#otherShare'), '25', 'Einstellung bleibt nach dem Zurücksetzen');
  await host.close();
});

test('Teams: jedes Team einzeln; Schätzfrage-Sieger nicht am Zug bekommt den Anteil', async () => {
  const { host, code } = await setup('team');
  await host.selectOption('#otherShare', '75');
  const anna = await joinPlayer(env, code, { name: 'Anna', pick: 'Rot' });
  const ben = await joinPlayer(env, code, { name: 'Ben', pick: 'Blau' });
  await host.locator('.cell.val').nth(1).click(); // Schätzfrage, Rot am Zug
  await anna.fill('#estInput', '50');
  await anna.press('#estInput', 'Enter');
  await ben.fill('#estInput', '99');
  await ben.press('#estInput', 'Enter');
  await host.waitForFunction(() => document.getElementById('special').textContent.includes('99'));
  await host.click('#resolveBtn');
  await host.waitForFunction(() => [...document.querySelectorAll('.pscore')].map((e) => e.value).join(',') === '0,75');
  await host.close();
  assert.deepEqual(env.errors, []);
});

test('Ohne „am Zug“ bekommen alle volle Punkte', async () => {
  const { host, code } = await setup();
  const anna = await joinPlayer(env, code, { pick: 'Anna' });
  const ben = await joinPlayer(env, code, { pick: 'Ben' });
  // Host nimmt den Zug weg (🎯 bei Anna nochmal klicken)
  await host.locator('.prow').nth(0).locator('button:has-text("🎯")').click();
  await host.locator('.cell.val').nth(0).click();
  for (const p of [anna, ben]) {
    await p.waitForSelector('.mc-opt');
    await p.click('.mc-opt:has-text("Richtig")');
  }
  await host.waitForFunction(() => document.getElementById('special').textContent.match(/✓ Richtig/g)?.length === 2);
  await host.click('#resolveBtn');
  await host.waitForFunction(() => [...document.querySelectorAll('.pscore')].map((e) => e.value).join(',') === '100,100');
  await host.close();
});
