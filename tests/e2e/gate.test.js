// Spielleiter-Passwort (nur übers Relay wie auf Vercel): Ohne Passwort kein Raum,
// falsches Passwort → Hinweis, richtiges oder Host-Passwort → Raum ist online.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startEnv, joinPlayer, SERVER, GAME_PASSWORD, HOST_PASSWORD } = require('./helpers');

const ONLY_RELAY = { skip: !SERVER && 'nur übers Relay (WebRTC hat keinen Server)' };
let env;
test.before(async () => { if (SERVER) env = await startEnv(); });
test.after(async () => { if (env) await env.stop(); });

async function openGatedHost() {
  const host = await env.page({ extraInit: { noGamePw: true } });
  await host.goto(env.base + '/host.html');
  await host.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await host.reload();
  return host;
}

test('Ohne Spielleiter-Passwort kein Raum, mit Passwort schon', ONLY_RELAY, async () => {
  const host = await openGatedHost();
  await host.waitForSelector('#gameGate:not([hidden])');
  assert.equal(await host.textContent('#peerStatus'), 'Spielleiter-Passwort nötig');
  await host.fill('#gamePw', 'falsch');
  await host.click('#gameGate button');
  await host.waitForFunction(() => document.getElementById('gameGateError').textContent === 'Falsches Passwort.');
  assert.notEqual(await host.textContent('#peerStatus'), 'online');
  await host.fill('#gamePw', GAME_PASSWORD);
  await host.click('#gameGate button');
  await host.waitForFunction(() => document.getElementById('peerStatus')?.textContent === 'online');
  assert.ok(await host.isHidden('#gameGate'));
  // Spieler brauchen das Passwort nicht
  await host.fill('#newName', 'Anna');
  await host.click('#addForm button');
  const p = await joinPlayer(env, await host.textContent('#code'), { pick: 'Anna', extraInit: { noGamePw: true } });
  await host.waitForFunction(() => document.querySelectorAll('#players .device').length === 1);
  // Passwort gilt nur für diesen Tab, nicht dauerhaft
  assert.equal(await host.evaluate(() => localStorage.getItem('jeopardy.gamePw')), null);
  await host.context().close();
  await p.context().close();
  assert.deepEqual(env.errors, []);
});

test('Das Host-Passwort aus dem Editor reicht auch', ONLY_RELAY, async () => {
  const host = await openGatedHost();
  await host.evaluate((pw) => localStorage.setItem('jeopardy.hostPw', pw), HOST_PASSWORD);
  await host.reload();
  await host.waitForFunction(() => document.getElementById('peerStatus')?.textContent === 'online');
  assert.ok(await host.isHidden('#gameGate'));
  await host.context().close();
});
