// Verbindungshilfe (TURN): Wenn direkte Verbindungen blockiert sind (z. B. alle im selben Uni-WLAN),
// läuft die Verbindung über einen Weiterleitungs-Server. Simuliert wird das, indem direkte Verbindungen
// verboten werden (iceTransportPolicy: relay) – dann geht es nur noch über TURN.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startEnv, startTurn, openHost } = require('./helpers');

let env;
let turn;
test.before(async () => {
  turn = await startTurn();
  env = await startEnv({ JEOP_FORCE_RELAY: true, JEOP_CONNECT_HINT_MS: 3000, JEOP_SELFCHECK_MS: 600000 });
});
test.after(async () => { await env.stop(); turn.stop(); });

test('Ohne Verbindungshilfe: Spieler bekommt einen verständlichen Hinweis', async () => {
  const { host } = await openHost(env, { names: ['Anna'] });
  const link = await host.textContent('#link');
  assert.ok(!link.includes('#t='), 'Link ohne TURN-Zugang');
  const p = await env.page();
  await p.goto(link);
  await p.waitForFunction(() => document.getElementById('waiting').textContent.includes('Verbindungshilfe'), null, { timeout: 15000 });
  assert.equal(await p.textContent('#status'), 'Keine Direktverbindung');
  assert.ok(await p.isHidden('#picker'), 'Spieler kommt ohne TURN nicht rein');
  await host.context().close();
  await p.context().close();
});

test('Mit Verbindungshilfe kommt der Spieler über den TURN-Server rein', async (t) => {
  const { host } = await openHost(env, { names: ['Anna'] });

  await t.test('Host richtet die Verbindungshilfe ein', async () => {
    assert.match(await host.textContent('#turnState'), /nicht eingerichtet/);
    await host.click('#turnBox summary');
    await host.fill('#turnUrls', 'kaputt\n' + turn.urls);
    await host.fill('#turnUser', turn.username);
    await host.fill('#turnPass', turn.credential);
    await host.click('#turnSave');
    await host.waitForFunction(() => document.getElementById('peerStatus').textContent === 'online');
    assert.match(await host.textContent('#turnState'), /aktiv \(1 Adresse\)/, 'ungültige Zeile wird verworfen');
    assert.match(await host.textContent('#link'), /#t=[\w-]+$/);
  });

  await t.test('Spieler öffnet den Link und verbindet sich über TURN', async () => {
    const link = await host.textContent('#link');
    const p = await env.page({ viewport: { width: 390, height: 844 } });
    await p.goto(link);
    await p.waitForSelector('#picker:not([hidden])', { timeout: 20000 });
    await p.click('.pick:text-is("Anna")');
    await host.waitForFunction(() => document.querySelectorAll('#players .device').length === 1);
    // Zugang verschwindet aus der Adresszeile, bleibt aber für Neuladen gespeichert
    assert.ok(!p.url().includes('#t='));
    await p.reload();
    await p.waitForSelector('#board:not([hidden])', { timeout: 20000 });
    assert.equal(await p.textContent('#me'), 'Du: Anna');
  });

  await t.test('Verbindungshilfe lässt sich wieder entfernen', async () => {
    await host.click('#turnBox summary').catch(() => {});
    await host.click('#turnClear');
    await host.waitForFunction(() => document.getElementById('peerStatus').textContent === 'online');
    assert.match(await host.textContent('#turnState'), /nicht eingerichtet/);
    assert.ok(!(await host.textContent('#link')).includes('#t='));
  });
  assert.deepEqual(env.errors, []);
});
