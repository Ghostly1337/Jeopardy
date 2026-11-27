// Audio-/Video-Clips: Editor (Upload, Link, Ablehnung), Wiedergabe auf allen Geräten gesteuert
// vom Host, Nachreichen für Nachzügler, große Clips übers Relay, gefälschte Clip-Daten.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startEnv, joinPlayer, SERVER, HOST_PASSWORD } = require('./helpers');

let env;
test.before(async () => { env = await startEnv(); });
test.after(async () => { await env.stop(); });

// Gültige WAV-Datei (Stille, 8 kHz mono 8 bit) mit gewünschter Größe
function wav(bytes) {
  const n = Math.max(800, bytes - 44);
  const b = Buffer.alloc(44 + n, 128);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  return b;
}
const CLIP = wav(1_200_000); // ~1,2 MB: groß genug, um das Bündeln übers Relay zu prüfen

async function openEditor(page) {
  await page.goto(env.base + '/editor.html');
  if (SERVER) {
    await page.waitForSelector('#pwForm:not([hidden])');
    await page.fill('#hostPw', HOST_PASSWORD);
    await page.click('#pwForm button');
    await page.waitForFunction(() => document.getElementById('setSource').textContent.includes('Server'));
  }
  await page.waitForFunction(() => !document.getElementById('setSelect').disabled);
}
const media = (page) => page.evaluate(() => {
  const el = document.getElementById('playerMedia');
  return { shown: !document.getElementById('mediaWrap').hidden, src: el.getAttribute('src') || '', paused: el.paused, t: el.currentTime, label: document.getElementById('mediaLabel').textContent };
});
// Autoplay-Sperre des Browsers: dann tippt der Spieler einmal (wie im echten Leben)
async function ensurePlaying(p) {
  if (await p.isVisible('#mediaTap')) await p.click('#mediaTap');
  await p.waitForFunction(() => !document.getElementById('playerMedia').paused);
}

test('Clips im Editor, auf allen Geräten, gesteuert vom Host', async (t) => {
  const ed = await env.page();
  await ed.goto(env.base + '/editor.html');
  await ed.evaluate(() => localStorage.clear());
  await openEditor(ed);
  const clue = (cat) => ed.locator('.ed-cat').nth(cat).locator('.ed-clue').first();

  await t.test('Editor: Upload, Link, unsichere Links und zu große Dateien', async () => {
    await clue(0).locator('.ed-media input[type=file]').setInputFiles({ name: 'clip.wav', mimeType: 'audio/wav', buffer: CLIP });
    await clue(0).locator('.ed-media-info:text-is("🔊 Audio (hochgeladen)")').waitFor();
    const link = clue(1).locator('.ed-media input:not([type=file])');
    for (const bad of ['http://media.example.com/a.mp4', 'javascript:alert(1)', 'data:text/html;base64,AAAA']) {
      await link.fill(bad);
      await link.press('Tab');
      assert.ok(await link.evaluate((e) => e.classList.contains('invalid')), bad);
    }
    await link.fill('https://media.example.com/clip.mp4');
    await link.press('Tab');
    await clue(1).locator('.ed-media-info:text-is("🎬 Video (Link)")').waitFor();
    // zu groß → Hinweis, nichts gespeichert
    let msg = '';
    ed.once('dialog', (d) => { msg = d.message(); });
    await clue(2).locator('.ed-media input[type=file]').setInputFiles({ name: 'gross.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(2_100_000) });
    await ed.waitForTimeout(300);
    assert.match(msg, /zu groß/);
    const saved = await ed.evaluate(() => JSON.parse(localStorage.getItem('jeopardy.set')).rounds[0].categories.map((c) => c.clues[0].media || ''));
    assert.match(saved[0], /^data:audio\/wav;base64,/);
    assert.equal(saved[1], 'https://media.example.com/clip.mp4');
    assert.equal(saved[2], '');
    if (SERVER) await ed.waitForFunction(() => document.getElementById('saved').textContent.includes('Server gespeichert'), null, { timeout: 15000 });
  });

  const host = await ed.context().newPage();
  await host.goto(env.base + '/host.html');
  await host.waitForFunction(() => document.getElementById('peerStatus')?.textContent === 'online');
  for (const n of ['Anna', 'Ben']) { await host.fill('#newName', n); await host.click('#addForm button'); }
  const code = await host.textContent('#code');
  const anna = await joinPlayer(env, code, { pick: 'Anna' });

  await t.test('Frage mit Clip: Spieler bekommt ihn, Host startet, pausiert und spult zurück', async () => {
    await host.locator('.cell.val').nth(0).click();
    assert.ok(await host.isVisible('#mediaBox'));
    await anna.waitForFunction(() => !document.getElementById('mediaWrap').hidden && document.getElementById('playerMedia').getAttribute('src'));
    let m = await media(anna);
    assert.match(m.src, /^data:audio\/wav;base64,/);
    assert.equal(m.label, '🔊 Audio-Clip');
    assert.ok(m.paused, 'läuft erst, wenn der Host startet');
    await host.click('#mediaPlay');
    await ensurePlaying(anna);
    await anna.waitForTimeout(600);
    await host.click('#mediaPlay'); // Pause
    await anna.waitForFunction(() => document.getElementById('playerMedia').paused);
    m = await media(anna);
    assert.ok(m.t > 0.2, 'war am Laufen');
    await host.click('#mediaRestart');
    await anna.waitForFunction(() => !document.getElementById('playerMedia').paused && document.getElementById('playerMedia').currentTime < 0.5);
  });

  await t.test('Wer später kommt, bekommt den Clip nachgereicht', async () => {
    const ben = await joinPlayer(env, code, { pick: 'Ben' });
    await ben.waitForFunction(() => document.getElementById('playerMedia').getAttribute('src')?.startsWith('data:audio/wav'));
    await ben.context().close();
  });

  await t.test('Frage zu → Clip stoppt und verschwindet; Link-Clip kommt als Video', async () => {
    await host.click('#cancel');
    await anna.waitForFunction(() => document.getElementById('mediaWrap').hidden && document.getElementById('playerMedia').paused);
    await anna.context().route('https://media.example.com/**', (r) => r.fulfill({ body: CLIP, contentType: 'audio/wav' }));
    await host.locator('.cell.val').nth(1).click();
    await anna.waitForFunction(() => document.getElementById('playerMedia').getAttribute('src') === 'https://media.example.com/clip.mp4');
    assert.equal((await media(anna)).label, '🎬 Video-Clip');
    await host.click('#cancel');
    await anna.waitForFunction(() => !document.getElementById('playerMedia').getAttribute('src'));
  });

  await t.test('Gefälschte Clip-Nachrichten werden ignoriert', async () => {
    const r = await anna.evaluate(() => {
      const out = [];
      for (const src of ['javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'http://evil.example/a.mp3', 'data:image/svg+xml;base64,AAAA']) {
        JMedia.playerMessage({ type: 'media', key: 'fake-' + out.length, src, playing: true, kind: 'video' });
        out.push(document.getElementById('playerMedia').getAttribute('src') || '');
      }
      JMedia.playerMessage({ type: 'media', key: 'x'.repeat(500), src: 'https://ok.example/a.mp3', playing: true });
      out.push(document.getElementById('playerMedia').getAttribute('src') || '');
      return out;
    });
    assert.deepEqual(r, ['', '', '', '', ''], 'nichts davon geladen');
    assert.deepEqual(env.allErrors, []);
  });
});
