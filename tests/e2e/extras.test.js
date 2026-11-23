// Bilder in Fragen, Siegerehrung, Live-Reaktionen, Handy-Layout
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { startEnv, openHost, joinPlayer, TEST_PNG } = require('./helpers');

let env;
test.before(async () => { env = await startEnv({ JEOP_BUZZ_DELAY_MS: 150 }); });
test.after(async () => { await env.stop(); });

// Screenshots nur auf Wunsch (SHOTS=Ordner), z. B. für die manuelle Kontrolle
async function shot(page, name) {
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, name + '.png') });
}

test('Bilder in Fragen: Upload, Link und unsichere Links', async (t) => {
  const ed = await env.page();
  await ed.goto(env.base + '/editor.html');
  await ed.evaluate(() => localStorage.clear());
  await ed.reload();

  await t.test('Unsichere Links werden abgelehnt', async () => {
    const link = ed.locator('.ed-cat').nth(1).locator('.ed-clue').first().locator('.ed-img input:not([type=file])');
    await link.fill('javascript:alert(1)');
    await link.press('Tab');
    assert.ok(await link.evaluate((e) => e.classList.contains('invalid')));
    await link.fill('https://img.example.com/karte.png');
    await link.press('Tab');
    await ed.waitForSelector('.ed-cat >> nth=1 >> .ed-img img');
  });

  await t.test('Upload wird als JPEG gespeichert', async () => {
    await ed.locator('.ed-cat').nth(0).locator('.ed-clue').first().locator('.ed-img input[type=file]')
      .setInputFiles({ name: 'bild.png', mimeType: 'image/png', buffer: TEST_PNG });
    await ed.waitForSelector('.ed-cat >> nth=0 >> .ed-img img');
    const imgs = await ed.evaluate(() => JSON.parse(localStorage.getItem('jeopardy.set')).rounds[0].categories.map((c) => c.clues[0].img || ''));
    assert.match(imgs[0], /^data:image\/jpeg;base64,/);
    assert.equal(imgs[1], 'https://img.example.com/karte.png');
  });

  await t.test('Spieler sieht das Bild erst mit der Frage', async () => {
    // Host im selben Browser-Profil wie der Editor öffnen
    const host = await ed.context().newPage();
    host.on('dialog', (d) => d.accept());
    await host.goto(env.base + '/host.html');
    await host.waitForFunction(() => document.getElementById('peerStatus').textContent === 'online');
    await host.fill('#newName', 'Anna');
    await host.click('#addForm button');
    const code = await host.textContent('#code');
    const p = await joinPlayer(env, code, { pick: 'Anna' });
    assert.ok(await p.isHidden('#img'));
    await host.locator('.cell.val').nth(0).click();
    await p.waitForFunction(() => document.getElementById('img').naturalWidth > 0);
    assert.ok(await host.isVisible('#clueImg'));
    await host.click('#cancel');
    await host.locator('.cell.val').nth(1).click();
    await p.waitForFunction(() => document.getElementById('img').src.startsWith('https://img.example.com'));
    await host.click('#cancel');
    await host.locator('.cell.val').nth(2).click();
    await p.waitForFunction(() => document.getElementById('q').textContent === 'Frage für 100' && document.getElementById('img').hidden);
    await ed.context().close();
    await p.context().close();
  });
});

test('Emoji-Spam-Sperre und Schalter im Host-Pult', async (t) => {
  const { host, code } = await openHost(env, { names: ['Anna', 'Ben'] });
  const p = await joinPlayer(env, code, { pick: 'Anna', viewport: { width: 1280, height: 800 } });
  const max = await p.evaluate(() => J.REACT_MAX);

  await t.test('Zu viele Emojis: Pause mit Countdown, nichts kommt mehr an', async () => {
    for (let i = 0; i < max; i++) {
      await p.click('.react-btn:text-is("🔥")');
      await p.waitForTimeout(1700);
    }
    await host.waitForSelector('.react-float .react-emoji:text-is("🔥")');
    await p.click('.react-btn:text-is("🔥")');
    await p.waitForSelector('#reactBar.locked');
    assert.match(await p.getAttribute('#reactBar', 'data-wait'), /^⏳ \d+$/);
    const before = await host.locator('.react-float').count();
    await p.locator('.react-btn:text-is("😂")').click({ force: true });
    await p.waitForTimeout(600);
    assert.equal(await host.locator('.react-float .react-emoji:text-is("😂")').count(), 0, 'gesperrtes Emoji kommt nicht an');
    assert.ok(await host.locator('.react-float').count() <= before);
  });

  await t.test('Host schaltet Emojis ab und wieder an', async () => {
    assert.equal(await host.textContent('#reactToggle'), '😀 Emojis an');
    await host.click('#reactToggle');
    assert.equal(await host.textContent('#reactToggle'), '🚫 Emojis aus');
    await p.waitForSelector('#reactBar', { state: 'hidden' });
    await host.click('#reactToggle');
    await p.waitForSelector('#reactBar', { state: 'visible' });
  });

  await host.context().close();
  await p.context().close();
  assert.deepEqual(env.errors, []);
});

test('Host tippt Punkte, während sich ein Spieler verbindet: Eingabe bleibt erhalten', async () => {
  const { host, code } = await openHost(env, { names: ['Anna', 'Ben'] });
  const input = host.locator('.pscore').nth(1);
  await input.click();
  await input.fill('350');
  // Verbinden baut die Spielerliste neu auf
  const p = await joinPlayer(env, code, { pick: 'Anna' });
  await host.waitForFunction(() => document.querySelectorAll('#players .device').length === 1);
  assert.equal(await host.locator('.pscore').nth(1).inputValue(), '350', 'getippter Wert bleibt');
  assert.ok(await host.locator('.pscore').nth(1).evaluate((e) => e === document.activeElement), 'Fokus bleibt');
  await host.locator('.pscore').nth(1).press('Enter');
  await p.waitForFunction(() => [...document.querySelectorAll('#scores .score-value')].map((e) => e.textContent).join(',') === '0,350');
  await host.context().close();
  await p.context().close();
});

test('Siegerehrung mit Gleichstand und Reaktionen', async (t) => {
  const { host, code } = await openHost(env, { names: ['Anna', 'Ben', 'Cem'] });
  const p = await joinPlayer(env, code, { pick: 'Anna', viewport: { width: 1280, height: 800 } });
  // Ben und Cem je 100, Anna 0
  await host.locator('.pscore').nth(1).fill('100');
  await host.locator('.pscore').nth(1).press('Enter');
  await host.locator('.pscore').nth(2).fill('100');
  await host.locator('.pscore').nth(2).press('Enter');
  await host.locator('.pscore').nth(2).blur();
  // erst weitermachen, wenn beide Punktestände beim Spieler angekommen sind (übers Relay etwas später)
  await p.waitForFunction(() => [...document.querySelectorAll('#scores .score-value')].map((e) => e.textContent).join(',') === '0,100,100');

  await t.test('Reaktion fliegt bei Host und Spieler mit Namen', async () => {
    // Der Absender sieht sein Emoji sofort, ohne Umweg übers Netz
    const shownAt = await p.evaluate(() => {
      const t0 = performance.now();
      document.querySelector('.react-btn[title]') ; // Leiste ist da
      [...document.querySelectorAll('.react-btn')].find((b) => b.textContent === '😂').click();
      return document.querySelector('.react-float .react-name')?.textContent === 'Anna' ? performance.now() - t0 : null;
    });
    assert.ok(shownAt !== null && shownAt < 50, 'sofort beim Absender');
    await host.waitForSelector('.react-float .react-name:text-is("Anna")');
    await p.waitForSelector('.react-float .react-name:text-is("Anna")');
  });

  await t.test('Gleichstand teilt sich Platz 1', async () => {
    await host.click('#finishBtn');
    await p.waitForSelector('#finish.show');
    assert.equal(await p.textContent('.pod-winner'), '🏆 Ben & Cem');
    assert.equal(await p.locator('.p1 .pod-name').count(), 2);
    assert.equal(await p.textContent('.p3 .pod-name'), 'Anna');
    assert.ok(await p.locator('#finish .confetti').count() > 50);
    await host.keyboard.press('Control+z');
    await p.waitForSelector('#finish:not(.show)', { state: 'attached' });
  });
  await host.context().close();
  await p.context().close();
});

test('Handy-Layout', async (t) => {
  const { host, code } = await openHost(env, { names: ['Anna', 'Ben', 'Cem', 'Dana', 'Emil'] });
  await host.evaluate(() => {
    const s = J.loadSet();
    s.rounds[0].categories[4].name = 'Wer hat das geschrieben?';
    s.rounds[0].categories[0].clues[0].q = 'Eine ziemlich lange Frage, damit man sieht, ob auf dem Handy noch alles in den Bildschirm passt?';
    J.saveSet(s);
  });
  await host.reload();
  await host.waitForFunction(() => document.getElementById('peerStatus').textContent === 'online');

  for (const [vp, name] of [[{ width: 360, height: 740 }, 'Anna'], [{ width: 390, height: 844 }, 'Ben']]) {
    await t.test(`Spielerseite passt auf ${vp.width} px`, async () => {
      const p = await joinPlayer(env, code, { pick: name, viewport: vp });
      await p.waitForSelector('#board:not([hidden])');
      const m = await p.evaluate(() => {
        const vals = [...document.querySelectorAll('#board .cell.val')];
        const cats = [...document.querySelectorAll('#board .cell.cat')];
        return {
          overflowX: document.documentElement.scrollWidth - window.innerWidth,
          valsFit: vals.every((v) => v.scrollWidth <= v.clientWidth + 1),
          minCatFont: Math.min(...cats.map((c) => parseFloat(getComputedStyle(c).fontSize))),
          catsFit: cats.every((c) => c.scrollWidth <= c.clientWidth + 1),
          reactVisible: [...document.querySelectorAll('.react-btn')].filter((b) => b.offsetParent).length,
          overflowY: document.documentElement.scrollHeight - window.innerHeight,
          scoresBottom: document.getElementById('scores').getBoundingClientRect().bottom,
          catHeight: cats[0].getBoundingClientRect().height,
          valHeight: vals[0].getBoundingClientRect().height,
        };
      });
      assert.ok(m.overflowX <= 0, 'kein seitliches Scrollen: ' + m.overflowX);
      assert.ok(m.valsFit, 'Punktwerte passen in die Kacheln');
      assert.ok(m.catsFit, 'Kategorienamen passen in die Kacheln');
      assert.ok(m.minCatFont >= 8, 'Kategorie-Schrift lesbar: ' + m.minCatFont);
      assert.equal(m.reactVisible, 1, 'Emoji-Leiste ist eingeklappt');
      assert.ok(m.overflowY <= 0, 'kein Scrollen nach unten nötig: ' + m.overflowY);
      assert.ok(m.scoresBottom <= vp.height, 'Punkte ohne Scrollen sichtbar: ' + m.scoresBottom);
      assert.ok(m.catHeight < m.valHeight, `Kategorie-Zeile niedriger als Punktefelder (${m.catHeight} / ${m.valHeight})`);
      await shot(p, `handy-board-${vp.width}`);
      await p.click('.react-toggle');
      assert.equal(await p.evaluate(() => [...document.querySelectorAll('.react-btn')].filter((b) => b.offsetParent).length), 6);
      await p.click('.react-toggle');

      // Frage offen: Buzzer liegt komplett im sichtbaren Bereich
      await host.locator('.cell.val').first().click();
      await p.waitForSelector('#buzzer.wait');
      const box = await p.locator('#buzzer').boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= vp.height, 'Buzzer sichtbar: ' + JSON.stringify(box));
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await p.waitForTimeout(500); // Einblend-Animation abwarten
      await shot(p, `handy-frage-${vp.width}`);
      await host.click('#cancel');
      await p.context().close();
    });
  }

  await t.test('Host-Pult passt aufs Handy', async () => {
    const h = await host.context().newPage();
    await h.setViewportSize({ width: 390, height: 844 });
    await h.goto(env.base + '/host.html');
    await h.waitForSelector('#players .prow');
    assert.ok(await h.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await shot(h, 'handy-host');
  });
  assert.deepEqual(env.errors, []);
});
