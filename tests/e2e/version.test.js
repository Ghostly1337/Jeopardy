// Versionsprüfung: Handys mit anderem Code-Stand als der Host laden sich einmal neu
const test = require('node:test');
const assert = require('node:assert/strict');
const { startEnv, openHost, joinPlayer } = require('./helpers');

let env;
test.before(async () => { env = await startEnv(); });
test.after(async () => { await env.stop(); });

test('Anderer Stand als der Host: einmal neu laden, sonst Hinweis', async () => {
  const { host, code } = await openHost(env, { names: ['Anna', 'Ben'] });
  const anna = await joinPlayer(env, code, { pick: 'Anna' });
  assert.ok(await anna.isHidden('#versionBanner'));
  await anna.evaluate(() => { window.__marker = 1; });
  // Host meldet eine andere Version (wie nach einem Update)
  await host.evaluate(() => { J.APP_VERSION = 'neuer-stand'; });
  await host.locator('.cell.val').first().click();
  await anna.waitForFunction(() => !window.__marker, null, { timeout: 15000 }); // Seite wurde neu geladen
  // Neu geladen, aber Host bleibt anders (hier: Host „veraltet“) → Hinweis statt Endlosschleife
  await anna.waitForSelector('#versionBanner:not([hidden])', { timeout: 15000 });
  await host.evaluate(() => { J.APP_VERSION = window.__orig || J.APP_VERSION; });
  assert.deepEqual(env.errors, []);
});

test('Editor verwirft unbekannte Fragearten nicht still', async () => {
  const ed = await env.page();
  await ed.goto(env.base + '/editor.html');
  await ed.evaluate(() => localStorage.clear());
  await ed.reload();
  await ed.waitForFunction(() => !document.getElementById('setSelect').disabled || !document.getElementById('pwForm').hidden);
  const data = await ed.evaluate(() => { const s = J.defaultSet(); s.title = 'Zukunft'; s.rounds[0].categories[0].clues[0].kind = 'zeitreise'; return JSON.stringify(s); });
  const msg = new Promise((res) => ed.once('dialog', (d) => res(d.message())));
  await ed.setInputFiles('#importFile', { name: 'zukunft.json', mimeType: 'application/json', buffer: Buffer.from(data) });
  assert.match(await msg, /neu laden/);
  assert.deepEqual(env.errors, []);
});
