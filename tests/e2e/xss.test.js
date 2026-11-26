// Sicherheit: HTML aus Fragen, Namen, Tipps und Netzwerkdaten wird überall nur als Text angezeigt.
// Doppelt abgesichert: Escaping verhindert das Einfügen, die Content-Security-Policy würde
// eingeschleusten Code zusätzlich blockieren (Verstöße landen in env.errors).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startEnv, openHost, joinPlayer, TRANSPORT } = require('./helpers');

// Escaping in der Oberfläche hängt nicht vom Transport ab: einmal reicht (Flut-Test läuft in beiden)
const ONCE = { skip: TRANSPORT !== 'peer' && 'transportunabhängig, läuft im WebRTC-Durchlauf' };

let env;
test.before(async () => { env = await startEnv(); });
test.after(async () => { await env.stop(); });

const EVIL = '<img src=x onerror=window.__xss=1>';
const EVIL_NAME = EVIL.slice(0, 30); // Namensfeld im Host: maxlength 30
const xss = (page) => page.evaluate(() => window.__xss);
const imgs = (page, sel) => page.locator(`${sel} img`).count();

test('HTML in Fragen, Namen und Tipps bleibt Text (Host, Spieler, TV)', ONCE, async (t) => {
  const { host, code } = await openHost(env, { mode: 'team', teamSize: 2, names: [EVIL, 'Blau'] });
  await host.evaluate((evil) => {
    const s = J.defaultSet();
    s.title = evil;
    s.rounds[0].categories[0].name = evil;
    s.rounds[0].categories[0].clues[0] = { q: evil, a: evil, img: 'javascript:alert(1)', note: evil, hint: 'custom', hintText: evil };
    s.rounds[0].categories[1].clues[0] = { q: evil, a: `${evil} | falsch`, img: '', note: '', kind: 'choice' };
    s.rounds[0].categories[2].clues[0] = { q: evil, a: `${evil} | b | c`, img: '', note: '', kind: 'order' };
    J.saveSet(s);
  }, EVIL);
  await host.reload();
  await host.waitForFunction(() => document.getElementById('peerStatus')?.textContent === 'online');

  // Teammitglied mit HTML im Namen
  const player = await joinPlayer(env, code, { name: EVIL, pick: EVIL_NAME });
  const tv = await joinPlayer(env, code, { viewport: { width: 1280, height: 720 } });
  await tv.click('#tvView');
  const views = [host, player, tv];
  await player.waitForFunction((e) => document.querySelector('#board').textContent.includes(e), EVIL);

  await t.test('Namen, Titel und Kategorien als Text', async () => {
    for (const pg of [player, tv]) {
      await pg.waitForFunction((e) => document.getElementById('scores').textContent.includes(e), EVIL_NAME);
      assert.equal(await imgs(pg, '#scores'), 0);
      assert.equal(await imgs(pg, '#board'), 0);
    }
    assert.equal(await host.locator('#players .pname').first().textContent(), EVIL_NAME);
    assert.equal(await imgs(host, '#players'), 0);
    assert.equal(await imgs(host, '#board'), 0);
  });

  await t.test('Frage, Antwort, Notiz, Tipp und unsichere Bild-Adresse', async () => {
    await host.locator('.cell.val').nth(0).click();
    for (const pg of [player, tv]) {
      await pg.waitForSelector('#overlay.show');
      assert.equal(await pg.textContent('#q'), EVIL);
      assert.equal(await pg.locator('#overlay img:not([hidden])').count(), 0, 'javascript:-Bild wird nicht geladen');
    }
    assert.equal(await host.textContent('#clueA'), EVIL);
    assert.equal(await host.textContent('#clueNote'), EVIL);
    await player.waitForSelector('.joker[data-kind="hint"]:not([disabled])');
    await player.click('.joker[data-kind="hint"]');
    await player.click('.joker[data-kind="hint"]');
    await player.waitForSelector('#hintBox:not([hidden])');
    assert.equal(await player.textContent('.hint-text'), EVIL);
    assert.equal(await imgs(player, '#hintBox'), 0);
    await host.waitForFunction(() => document.getElementById('jokerStatus').textContent.includes('Tipp'));
    assert.equal(await imgs(host, '#jokerStatus'), 0);
    await host.click('#cancel');
    assert.equal(await imgs(host, '#log'), 0);
  });

  await t.test('Multiple Choice und Reihenfolge', async () => {
    await host.locator('.cell.val').nth(1).click();
    await player.waitForSelector('.mc-opt');
    assert.ok((await player.textContent('#specialBox')).includes(EVIL));
    assert.equal(await imgs(player, '#specialBox'), 0);
    await player.locator('.mc-opt').first().click();
    await host.waitForFunction(() => document.getElementById('special').textContent.includes('gewählt'));
    assert.equal(await imgs(host, '#special'), 0);
    await host.click('#cancel');
    await host.locator('.cell.val').nth(2).click();
    await player.waitForSelector('.order-list.editable li');
    assert.equal(await imgs(player, '#specialBox'), 0);
    await host.click('#cancel');
  });

  await t.test('Gefälschte Netzwerkdaten (z. B. falscher Host) werden entschärft', async () => {
    const injected = await player.evaluate(() => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      J.renderScores(el, [{ id: 'x', name: 'n', score: '<img src=x onerror=window.__xss=2>', color: 'red;"><img src=x onerror=window.__xss=3>' }], null);
      const pod = document.createElement('div');
      document.body.appendChild(pod);
      J.renderPodium(pod, [{ id: 'x', name: 'n', score: '<img src=x onerror=window.__xss=4>' }], '<img src=x>', {}, {});
      J.showReaction('<img src=x onerror=window.__xss=5>', 'n');
      return el.querySelectorAll('img').length + pod.querySelectorAll('img').length + document.querySelectorAll('.react-layer img').length;
    });
    assert.equal(injected, 0);
  });

  await t.test('Nirgends wurde Code ausgeführt, keine CSP-Verstöße', async () => {
    await player.waitForTimeout(300);
    for (const pg of views) assert.equal(await xss(pg), undefined);
    assert.deepEqual(env.errors, []);
  });
  for (const pg of views) await pg.context().close();
});

test('Host verkraftet kaputte und geflutete Spieler-Nachrichten', async () => {
  const { host, code } = await openHost(env, { names: ['Anna', 'Ben'] });
  const p = await joinPlayer(env, code, { pick: 'Anna' });
  await host.waitForFunction(() => document.querySelectorAll('#players .device').length === 1);
  // Direkt über die Verbindung des Spielers: Müll, falsche Typen, Joker ohne offene Frage, Flut
  await p.evaluate(() => {
    const c = window.__jeopConn;
    const junk = [42, 'x', [], { type: 5 }, { type: 'joker', kind: 'hint' }, { type: 'joker', kind: '__proto__' },
      { type: 'hello', playerId: 'x'.repeat(10000), deviceId: {} }, { type: 'order', order: 'nope' },
      { type: 'estimate', value: 'x'.repeat(100000) }, { type: 'draft', kind: 'order', value: [1, 1, 1] },
      { type: 'react', emoji: '<img src=x onerror=1>' }, { type: 'choice', pick: -1 }];
    for (const m of junk) c.send(m);
    for (let i = 0; i < 300; i++) c.send({ type: 'react', emoji: '🔥' });
  });
  await host.waitForTimeout(800);
  // Host läuft weiter: neue Frage öffnen klappt, Anna ist noch verbunden
  await host.locator('.cell.val').nth(0).click();
  await p.waitForSelector('#overlay.show');
  assert.ok(await host.locator('.react-float').count() <= 15, 'Emoji-Flut begrenzt');
  assert.deepEqual(env.errors, []);
  await host.context().close();
  await p.context().close();
});
