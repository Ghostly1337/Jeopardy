// Strengere Content-Security-Policy im Test-Modus (Report-Only): Ein Spiel mit Bild-, Audio- und
// Videofragen (https-Links und hochgeladene data:-Dateien) darf keinen einzigen Verstoß melden.
// Gegenprobe: Etwas wirklich Verbotenes wird gemeldet – der Header ist also aktiv.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startEnv, openHost, joinPlayer, TEST_PNG } = require('./helpers');

let env;
test.before(async () => { env = await startEnv(); });
test.after(async () => { await env.stop(); });

// Kleinste gültige WAV-Datei (Stille)
function wav() {
  const n = 800;
  const b = Buffer.alloc(44 + n, 128);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  return b;
}
const IMG_DATA = 'data:image/png;base64,' + TEST_PNG.toString('base64');
const AUDIO_DATA = 'data:audio/wav;base64,' + wav().toString('base64');
const VIDEO_DATA = 'data:video/mp4;base64,' + Buffer.alloc(64).toString('base64');

const violations = (page) => page.evaluate(() => window.__csp || []);

test('Spiel mit Bild-, Audio- und Videofragen: keine CSP-Meldung', async (t) => {
  const { host, code } = await openHost(env, { names: ['Anna'] });
  await host.context().route('https://img.example.com/**', (r) => r.fulfill({ body: TEST_PNG, contentType: 'image/png' }));
  await host.evaluate(([img, audio, video]) => {
    const s = J.loadSet();
    const c = s.rounds[0].categories[0].clues;
    c[0] = { q: 'Bild (Upload)', a: 'a', img, note: '' };
    c[1] = { q: 'Bild (Link)', a: 'a', img: 'https://img.example.com/bild.png', note: '' };
    c[2] = { q: 'Audio (Upload)', a: 'a', img: '', note: '', media: audio };
    c[3] = { q: 'Video (Upload)', a: 'a', img: '', note: '', media: video };
    c[4] = { q: 'Video (Link)', a: 'a', img: '', note: '', media: 'https://media.example.com/clip.mp4' };
    J.saveSet(s);
  }, [IMG_DATA, AUDIO_DATA, VIDEO_DATA]);
  await host.reload();
  await host.waitForFunction(() => document.getElementById('peerStatus')?.textContent === 'online');

  const anna = await joinPlayer(env, code, { pick: 'Anna' });
  for (const ctx of [anna.context(), host.context()]) {
    await ctx.route('https://img.example.com/**', (r) => r.fulfill({ body: TEST_PNG, contentType: 'image/png' }));
    await ctx.route('https://media.example.com/**', (r) => r.fulfill({ body: wav(), contentType: 'audio/wav' }));
  }

  const cats = await host.evaluate(() => J.loadSet().rounds[0].categories.length); // Brett ist zeilenweise
  const questions = ['Bild (Upload)', 'Bild (Link)', 'Audio (Upload)', 'Video (Upload)', 'Video (Link)'];
  for (let i = 0; i < questions.length; i++) {
    await t.test(questions[i], async () => {
      await host.locator('.cell.val').nth(i * cats).click();
      await anna.waitForFunction((q) => document.getElementById('q').textContent === q, questions[i]);
      if (i < 2) await anna.waitForFunction(() => document.getElementById('img').naturalWidth > 0);
      else await anna.waitForFunction(() => !!document.getElementById('playerMedia').getAttribute('src'));
      await anna.waitForTimeout(300); // Laden anstoßen lassen
      await host.click('#cancel');
      await anna.waitForFunction(() => !document.getElementById('overlay').classList.contains('show'));
    });
  }

  await t.test('Kein Gerät hat einen Verstoß gesehen', async () => {
    assert.deepEqual(await violations(host), []);
    assert.deepEqual(await violations(anna), []);
  });

  await t.test('Gegenprobe: Verbotenes wird im Test-Modus gemeldet, nicht blockiert', async () => {
    const r = await anna.evaluate(() => new Promise((resolve) => {
      window.__cspExpected = true;
      const before = (window.__csp || []).length;
      const img = document.createElement('img');
      img.src = 'http://unsicher.example/bild.png'; // http statt https: nur von der Report-Only-Regel erfasst
      document.body.append(img);
      setTimeout(() => {
        window.__cspExpected = false;
        img.remove();
        resolve((window.__csp || []).slice(before));
      }, 500);
    }));
    assert.ok(r.some((v) => v.disposition === 'report' && v.directive === 'img-src'), JSON.stringify(r));
    // Die Meldung per report-uri kommt auch am Server an …
    for (let i = 0; i < 50 && !env.cspReports.some((x) => x.includes('unsicher.example')); i++) await anna.waitForTimeout(100);
    assert.ok(env.cspReports.some((x) => x.includes('unsicher.example')), JSON.stringify(env.cspReports));
    // … zählt hier aber nicht als Fehler, sie war ja gewollt
    env.cspReports.splice(0, env.cspReports.length, ...env.cspReports.filter((x) => !x.includes('unsicher.example')));
    env.errors.splice(0, env.errors.length, ...env.errors.filter((x) => !x.includes('unsicher.example')));
  });

  await anna.context().close();
  await host.context().close();
  assert.deepEqual(env.allErrors, []);
});
