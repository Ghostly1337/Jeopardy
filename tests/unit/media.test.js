// Audio-/Video-Clips: Prüfung der Quellen, Größenlimits, Typ, Import und öffentlicher Zustand
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCommon } = require('./load-common');

const { J } = loadCommon();
const b64 = (n) => 'A'.repeat(n);

test('safeMedia: nur https-Links und data:audio/video als base64', () => {
  assert.equal(J.safeMedia('https://x.example/clip.mp3'), 'https://x.example/clip.mp3');
  assert.equal(J.safeMedia('  https://x.example/a%20b.mp4  '), 'https://x.example/a%20b.mp4');
  assert.ok(J.safeMedia('data:audio/mpeg;base64,' + b64(100)));
  assert.ok(J.safeMedia('data:video/mp4;base64,' + b64(100)));
  for (const bad of ['http://x.example/a.mp3', 'javascript:alert(1)', 'data:text/html;base64,AAAA',
    'data:image/svg+xml;base64,AAAA', 'data:audio/mpeg,<script>', 'data:audio/mpeg;base64,AA"onerror=1',
    'data:audio/mp"eg;base64,AAAA', 'https://', 'ftp://x/a.mp3', '//x.example/a.mp3', 'https://x.example/' + 'a'.repeat(3000), {}, null]) {
    assert.equal(J.safeMedia(bad), '', String(bad).slice(0, 40));
  }
});

test('safeMedia: zu große hochgeladene Clips werden verworfen', () => {
  const okAudio = Math.floor(J.MEDIA_LIMITS.audio * 4 / 3);
  assert.ok(J.safeMedia('data:audio/mpeg;base64,' + b64(okAudio)));
  assert.equal(J.safeMedia('data:audio/mpeg;base64,' + b64(okAudio + 1000)), '');
  const okVideo = Math.floor(J.MEDIA_LIMITS.video * 4 / 3);
  assert.ok(J.safeMedia('data:video/mp4;base64,' + b64(okVideo)));
  assert.equal(J.safeMedia('data:video/mp4;base64,' + b64(okVideo + 1000)), '');
});

test('mediaTypeOf: aus data:-Typ, Angabe oder Dateiendung; ohne gültigen Clip null', () => {
  assert.equal(J.mediaTypeOf({ media: 'data:video/webm;base64,AAAA' }), 'video');
  assert.equal(J.mediaTypeOf({ media: 'data:audio/ogg;base64,AAAA', mediaType: 'video' }), 'audio', 'data:-Typ gewinnt');
  assert.equal(J.mediaTypeOf({ media: 'https://x/a.mp4' }), 'video');
  assert.equal(J.mediaTypeOf({ media: 'https://x/a.mp3' }), 'audio');
  assert.equal(J.mediaTypeOf({ media: 'https://x/stream', mediaType: 'video' }), 'video');
  assert.equal(J.mediaTypeOf({ media: 'javascript:1', mediaType: 'video' }), null);
  assert.equal(J.mediaTypeOf({}), null);
});

test('mediaFileError: Typ und Größe', () => {
  assert.equal(J.mediaFileError({ type: 'audio/mpeg', size: 1000 }), null);
  assert.equal(J.mediaFileError({ type: 'video/mp4', size: J.MEDIA_LIMITS.video }), null);
  assert.match(J.mediaFileError({ type: 'video/mp4', size: J.MEDIA_LIMITS.video + 1 }), /zu groß/);
  assert.match(J.mediaFileError({ type: 'image/png', size: 10 }), /keine Audio/);
  assert.match(J.mediaFileError({ type: 'text/html', size: 10 }), /keine Audio/);
  assert.match(J.mediaFileError(null), /Keine Datei/);
});

test('Import: gültige Clips bleiben, ungültige/zu große fallen weg', () => {
  const s = J.normalizeSet({ rounds: [{ categories: [{ clues: [
    { q: 'a', media: 'https://x/a.mp4' },
    { q: 'b', media: 'javascript:alert(1)', mediaType: 'video' },
    { q: 'c', media: 'data:audio/mpeg;base64,' + b64(J.MEDIA_LIMITS.audio * 2) },
    { q: 'd', media: 'data:audio/wav;base64,AAAA', mediaType: '<b>' },
  ] }] }] });
  const c = s.rounds[0].categories[0].clues;
  assert.equal(c[0].media, 'https://x/a.mp4');
  assert.equal(c[0].mediaType, 'video');
  assert.ok(!('media' in c[1]) && !('mediaType' in c[1]));
  assert.ok(!('media' in c[2]));
  assert.equal(c[3].mediaType, 'audio');
});

test('publicState: Spieler erfahren nur die Art des Clips, nicht die Daten', () => {
  const set = J.defaultSet();
  set.rounds[0].categories[0].clues[0].media = 'data:audio/mpeg;base64,' + b64(5000);
  const st = J.defaultState();
  st.current = { round: 0, cat: 0, row: 0, revealed: false, judged: {} };
  const pub = J.publicState(set, st);
  assert.equal(pub.current.media, 'audio');
  assert.ok(!JSON.stringify(pub).includes(b64(5000)), 'keine Clip-Daten im Zustand');
  st.current.row = 1;
  assert.equal(J.publicState(set, st).current.media, null);
});
