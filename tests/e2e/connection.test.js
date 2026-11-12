// Runden-Intro und Verbindung: Host-Selbsttest nach stillem Verbindungsabbruch
const test = require('node:test');
const assert = require('node:assert/strict');
const { TRANSPORT, startEnv, openHost, joinPlayer } = require('./helpers');

let env;
test.before(async () => { env = await startEnv({ JEOP_INTRO_MS: 500, JEOP_SELFCHECK_MS: 3000 }); });
test.after(async () => { await env.stop(); });

test('Verbindungsart wird erkannt, Verbindungshilfe nur bei WebRTC', async () => {
  const { host } = await openHost(env);
  assert.equal(await host.evaluate(() => J.net.mode), TRANSPORT);
  assert.equal(await host.isVisible('#turnBox'), TRANSPORT === 'peer');
  await host.context().close();
});

test('Runden-Intro bei Host und Spieler', async (t) => {
  const { host, code } = await openHost(env, { names: ['Anna'] });
  const p = await joinPlayer(env, code, { pick: 'Anna', viewport: { width: 1280, height: 800 } });

  await t.test('Intro beginnt mit „Runde 1“, Kategorien bleiben verdeckt', async () => {
    await host.click('#introBtn');
    await p.waitForSelector('#intro.show');
    assert.equal(await p.textContent('#intro .intro-title'), 'Runde 1');
    assert.equal(await p.locator('#board .cell.cat.hidden-cat').count(), 6);
    assert.ok(!(await p.textContent('#board')).includes('Kategorie'), 'Namen noch nicht im Spieler-DOM');
  });

  await t.test('Host und Spieler sehen denselben Kategorienamen', async () => {
    await p.waitForFunction(() => document.querySelector('#intro .intro-title').textContent === 'Kategorie 3');
    await host.waitForFunction(() => document.querySelector('#intro .intro-title').textContent === 'Kategorie 3');
  });

  await t.test('Während des Intros öffnet ein Klick keine Frage', async () => {
    await host.locator('.cell.val').first().click({ force: true }).catch(() => {});
    assert.ok(await host.isHidden('#clue'));
  });

  await t.test('Intro endet, alle Kategorien sichtbar, Sounds kamen an', async () => {
    await p.waitForSelector('#intro:not(.show)', { state: 'attached', timeout: 10000 });
    assert.equal(await p.locator('#board .cell.cat.hidden-cat').count(), 0);
    const sfx = await p.evaluate(() => window.__sfx);
    assert.equal(sfx[0], 'intro');
    assert.equal(sfx.filter((x) => x === 'catreveal').length, 6);
  });

  await t.test('Rundenwechsel startet das Intro, Überspringen beendet es', async () => {
    await host.click('#r1');
    await p.waitForFunction(() => document.querySelector('#intro .intro-title').textContent === 'Runde 2');
    assert.equal(await p.textContent('#intro .intro-sub'), '200 – 1000 Punkte');
    await host.click('#introSkip');
    await p.waitForSelector('#intro:not(.show)', { state: 'attached' });
    await host.locator('.cell.val').first().click();
    await p.waitForSelector('#overlay.show');
  });
  await host.context().close();
  await p.context().close();
});

// Betrifft nur WebRTC: das Relay fragt ohnehin ständig beim Server nach
test('Host meldet sich nach stillem Verbindungsabbruch neu an', { skip: TRANSPORT === 'relay' }, async () => {
  const { host, code } = await openHost(env, { names: ['Anna', 'Ben'] });
  const a = await joinPlayer(env, code, { pick: 'Anna' });

  // Verbindung zum Vermittlungsserver kappen, ohne dass die Seite es merkt
  // (so verhält sich ein eingefrorener Tab im Handy-Browser)
  await host.evaluate(() => {
    const ws = window.__peer.socket._socket;
    ws.onclose = null; ws.onerror = null; ws.close();
  });
  await host.waitForTimeout(300);
  assert.equal(await host.textContent('#peerStatus'), 'online', 'Seite merkt den Abbruch selbst nicht');

  // Ein neuer Spieler kommt trotzdem rein, weil der Selbsttest greift
  const b = await joinPlayer(env, code, { pick: 'Ben' });
  assert.equal(await b.textContent('#me'), 'Du: Ben');
  // Der schon verbundene Spieler bekommt weiter Updates
  await host.fill('#newName', 'Cem');
  await host.click('#addForm button');
  await a.waitForFunction(() => document.querySelectorAll('#scores .score').length === 3, null, { timeout: 10000 });
  assert.deepEqual(env.errors, []);
});
