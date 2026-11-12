// Animationen: Zoom aus dem Feld, Richtig/Falsch-Effekt, Punkte zählen hoch,
// Buzz-Einblendung und Timer-Sound auf der TV-Ansicht
const test = require('node:test');
const assert = require('node:assert/strict');
const { startEnv, openHost, joinPlayer } = require('./helpers');

let env;
test.before(async () => { env = await startEnv({ JEOP_BUZZ_DELAY_MS: 200, JEOP_TIMER_MS: 3000 }); });
test.after(async () => { await env.stop(); });

const hasClass = (page, sel, cls) => page.$eval(sel, (e, c) => e.classList.contains(c), cls);

test('Animationen auf Handy und TV', async (t) => {
  const { host, code } = await openHost(env, { names: ['Anna', 'Ben'] });
  const anna = await env.page({ viewport: { width: 1280, height: 800 }, extraInit: { JEOP_COUNT_MS: 600 } });
  await anna.goto(env.base + '/player.html?room=' + code);
  await anna.waitForSelector('#picker:not([hidden])');
  await anna.click('.pick:has-text("Anna")');
  const ben = await joinPlayer(env, code, { pick: 'Ben' });
  const tv = await joinPlayer(env, code, { viewport: { width: 1280, height: 720 } });
  await tv.click('#tvView');
  await tv.evaluate(() => {
    window.__music = [];
    let on = false;
    J.startTimerMusic = (ms) => { on = true; window.__music.push('start:' + Math.round(ms / 1000)); };
    J.stopTimerMusic = () => { on = false; window.__music.push('stop'); };
    J.timerMusicOn = () => on;
  });
  await host.waitForFunction(() => document.querySelectorAll('#players .device').length === 2);

  await t.test('Anzeige-Texte sind nicht markierbar, Eingabefelder schon', async () => {
    const sel = (page, q) => page.$eval(q, (e) => getComputedStyle(e).userSelect || getComputedStyle(e).webkitUserSelect);
    for (const q of ['.intro-title', '#board', '#q', '#scores']) assert.equal(await sel(tv, q), 'none', q);
    assert.equal(await sel(host, '#board'), 'none');
    assert.notEqual(await sel(anna, '#pickerName'), 'none');
  });

  await t.test('Frage zoomt aus dem Feld', async () => {
    await host.locator('.cell.val').nth(3).click();
    await anna.waitForSelector('#overlay.show.zoom-in');
    const tr = await anna.$eval('#overlay', (o) => o.style.transition);
    assert.match(tr, /transform/);
    await anna.waitForSelector('#overlay.show:not(.zoom-in)', { timeout: 3000 });
    assert.equal(await anna.$eval('#overlay', (o) => o.style.transform), '', 'Zoom räumt auf');
  });

  await t.test('Falsch: roter Wackler, Kachel rot, verschwindet wieder', async () => {
    await host.locator('.jrow').nth(1).locator('.red').click(); // Ben falsch
    await anna.waitForSelector('#overlay.fx-wrong');
    await anna.waitForSelector('#overlayScores .score.fx-down');
    await anna.waitForSelector('#overlay:not(.fx-wrong)', { timeout: 3000 });
  });

  await t.test('Buzz-Einblendung nur auf dem TV', async () => {
    await anna.waitForSelector('#buzzer.live');
    await anna.waitForTimeout(250);
    await anna.click('#buzzer');
    await tv.waitForSelector('#buzzShow.go');
    assert.equal(await tv.textContent('.buzz-show-name'), '⚡ Anna');
    assert.ok(!(await hasClass(anna, '#buzzShow', 'go')), 'nicht am Handy');
  });

  await t.test('Richtig: grüner Puls, Punkte zählen hoch', async () => {
    await host.locator('.jrow.buzzed .green').click();
    await anna.waitForSelector('#overlay.fx-right');
    // Zwischenwert während des Hochzählens, dann Endstand (Klauen: 100 / 2 = 50)
    const seen = await anna.evaluate(() => new Promise((res) => {
      const vals = new Set();
      const t0 = performance.now();
      (function poll() {
        const v = document.querySelector('#overlayScores .score-value');
        if (v) vals.add(v.textContent);
        if (performance.now() - t0 < 900) requestAnimationFrame(poll); else res([...vals]);
      })();
    }));
    assert.ok(seen.includes('50'), seen.join(','));
    assert.ok(seen.some((v) => v !== '0' && v !== '50'), 'Zwischenwerte: ' + seen.join(','));
  });

  await t.test('Timer-Sound läuft auf dem TV und stoppt', async () => {
    await host.click('#timerBtn');
    await anna.waitForSelector('#timerBox:not([hidden])');
    await tv.waitForFunction(() => window.__music.some((m) => m.startsWith('start:')));
    await host.click('#timerStop');
    await tv.waitForFunction(() => window.__music.at(-1) === 'stop');
    assert.equal((await tv.evaluate(() => window.__music)).filter((m) => m.startsWith('start')).length, 1);
    // Handys spielen keinen Timer-Sound
    assert.ok(!(await ben.evaluate(() => J.timerMusicOn())));
  });

  assert.deepEqual(env.errors, []);
});

