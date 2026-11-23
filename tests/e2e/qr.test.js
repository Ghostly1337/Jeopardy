// QR-Einladung: Host zeigt Link + QR (offline erzeugt), der gescannte Link führt in den Raum,
// und die TV-Ansicht zeigt den QR groß bis zum Spielstart.
const test = require('node:test');
const assert = require('node:assert/strict');
const jsQR = require('jsqr');
const { startEnv, openHost, joinPlayer, HOST_PASSWORD } = require('./helpers');

let env;
test.before(async () => { env = await startEnv(); });
test.after(async () => { await env.stop(); });

// SVG im Browser auf ein Canvas zeichnen und mit jsQR lesen (wie eine Handy-Kamera)
async function scan(page, sel) {
  await page.waitForSelector(sel + ' svg');
  const img = await page.evaluate(async (s) => {
    const svg = document.querySelector(s + ' svg');
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
    const im = new Image();
    await new Promise((r, j) => { im.onload = r; im.onerror = j; im.src = url; });
    const c = document.createElement('canvas');
    c.width = c.height = 400;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(im, 0, 0, 400, 400);
    return Array.from(ctx.getImageData(0, 0, 400, 400).data);
  }, sel);
  const res = jsQR(Uint8ClampedArray.from(img), 400, 400);
  return res && res.data;
}

test('Host zeigt QR und Link; QR enthält nur den Beitrittslink', async () => {
  const { host, code } = await openHost(env, { names: ['Anna'] });
  const link = await host.textContent('#link');
  assert.equal(link, `${env.base}/player.html?room=${code}`);
  assert.equal(await scan(host, '#qr'), link);
  assert.ok(!link.includes(HOST_PASSWORD));
  const small = (await host.locator('#qr').boundingBox()).width;
  await host.click('#qr');
  await host.waitForFunction((w) => document.getElementById('qr').getBoundingClientRect().width > w, small);
  assert.equal(await scan(host, '#qr'), link, 'groß weiterhin lesbar');

  // Gescannter Link öffnet die Spielerseite mit Raumcode
  const p = await env.page({ viewport: { width: 390, height: 844 } });
  await p.goto(link);
  await p.waitForSelector('#picker:not([hidden])');
  await p.click('.pick:has-text("Anna")');
  await host.waitForFunction(() => document.querySelectorAll('#players .device').length === 1);
  assert.deepEqual(env.errors, []);
  await host.context().close();
  await p.context().close();
});

test('TV zeigt großen QR bis zum Spielstart, QR-Taste blendet ein und aus', async () => {
  const { host, code } = await openHost(env, { names: ['Anna'] });
  const tv = await joinPlayer(env, code, { viewport: { width: 1280, height: 720 } });
  await tv.click('#tvView');
  await tv.waitForSelector('#invite:not([hidden])');
  assert.equal(await scan(tv, '#inviteQr'), `${env.base}/player.html?room=${code}`);
  assert.equal(await tv.textContent('#inviteCode'), code);
  await tv.click('#qrBtn');
  await tv.waitForSelector('#invite', { state: 'hidden' });
  await tv.click('#qrBtn');
  await tv.waitForSelector('#invite:not([hidden])');
  // Erstes Feld geöffnet → QR verschwindet von selbst und kommt nicht automatisch zurück
  await host.locator('.cell.val').nth(0).click();
  await tv.waitForSelector('#invite', { state: 'hidden' });
  await host.click('#cancel');
  await tv.waitForTimeout(300);
  assert.ok(await tv.isHidden('#invite'));
  // Normale Spieler sehen weder QR-Taste noch Einladung
  const p = await joinPlayer(env, code, { pick: 'Anna' });
  assert.ok(await p.isHidden('#qrBtn'));
  assert.ok(await p.isHidden('#invite'));
  assert.deepEqual(env.errors, []);
});
