// Audio-/Video-Clips zu Fragen: Editor-Feld, Host-Steuerung und Wiedergabe auf allen Geräten.
// Ihr spielt online: Der Clip läuft auf jedem Handy/Laptop (und TV), der Host steuert Start,
// Pause und Neustart. Die Clip-Daten gehen als eigene 'media'-Nachricht an jede Verbindung –
// pro Frage nur einmal, danach nur noch kleine Steuerbefehle.
// Sicherheit: Quellen laufen immer durch J.safeMedia (nur https-Links oder data:audio/video),
// nichts davon landet in innerHTML; Elemente werden per DOM-API gebaut.
(function () {
  const J = window.J;

  // ---------- Editor ----------
  function editorControls(clue, persist) {
    const wrap = document.createElement('div');
    wrap.className = 'ed-media';
    function draw() {
      wrap.replaceChildren();
      const src = J.safeMedia(clue.media);
      if (src) {
        const kind = J.mediaTypeOf(clue);
        const info = document.createElement('span');
        info.className = 'ed-media-info';
        info.textContent = (kind === 'video' ? '🎬 Video' : '🔊 Audio') + (/^data:/i.test(src) ? ' (hochgeladen)' : ' (Link)');
        const el = document.createElement(kind === 'video' ? 'video' : 'audio');
        el.controls = true;
        el.preload = 'none';
        el.src = src;
        const del = document.createElement('button');
        del.className = 'small ghost';
        del.textContent = '✕ Clip entfernen';
        del.addEventListener('click', () => { delete clue.media; delete clue.mediaType; persist(); draw(); });
        wrap.append(info, el, del);
        return;
      }
      const url = document.createElement('input');
      url.placeholder = 'Audio-/Video-Link (https://…, optional)';
      url.addEventListener('change', () => {
        const v = J.safeMedia(url.value);
        if (url.value.trim() && !v) {
          url.classList.add('invalid');
          url.title = 'Nur https://-Links zu Audio- oder Videodateien';
          return;
        }
        if (v) { clue.media = v; clue.mediaType = J.mediaTypeOf({ media: v }); persist(); }
        draw();
      });
      const file = document.createElement('input');
      file.type = 'file';
      file.accept = 'audio/*,video/*';
      file.hidden = true;
      const up = document.createElement('button');
      up.className = 'small';
      up.textContent = '🎵';
      up.title = `Clip hochladen (Audio bis ${J.MEDIA_LIMITS.audio / 1e6} MB, Video bis ${J.MEDIA_LIMITS.video / 1e6} MB)`;
      up.addEventListener('click', () => file.click());
      file.addEventListener('change', async () => {
        const f = file.files[0];
        file.value = '';
        if (!f) return;
        const err = J.mediaFileError(f);
        if (err) { alert(err); return; }
        up.textContent = '…';
        try {
          const data = await readDataUrl(f);
          if (!J.safeMedia(data)) throw new Error('ungültig');
          clue.media = data;
          clue.mediaType = J.mediaTypeOf({ media: data });
          if (!persist()) {
            delete clue.media; delete clue.mediaType;
            persist();
            alert('Der Clip passt nicht mehr in den Browserspeicher. Nutze lieber einen Link oder entferne andere hochgeladene Dateien.');
          }
        } catch (e) {
          alert('Der Clip konnte nicht gelesen werden.');
        }
        draw();
      });
      wrap.append(url, up, file);
    }
    draw();
    return wrap;
  }

  function readDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        // Typ nur aus der (geprüften) Hauptart, Untertyp bereinigt – nie ungeprüft übernehmen
        const [main, sub] = String(file.type || '').toLowerCase().split('/');
        const kind = main === 'video' ? 'video' : 'audio';
        const subtype = /^[a-z0-9.+-]+$/.test(sub || '') ? sub : (kind === 'video' ? 'mp4' : 'mpeg');
        resolve(String(r.result).replace(/^data:[^,]*,/, `data:${kind}/${subtype};base64,`));
      };
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  // ---------- Wiedergabe (gemeinsam für Host und Spieler) ----------
  // el: <video playsinline> – spielt Audio und Video; bei Audio ist das Bild ausgeblendet
  function load(el, src, kind) {
    el.pause();
    el.src = src;
    el.hidden = kind !== 'video';
    el.currentTime = 0;
  }
  function play(el, onBlocked) {
    const p = el.play();
    if (p && p.catch) p.catch((e) => { if (e && e.name === 'NotAllowedError' && onBlocked) onBlocked(); });
  }

  // ---------- Host ----------
  let H = null;
  // opts: { $, conns: () => Iterable der Verbindungen }
  function host(opts) {
    const $ = opts.$;
    H = { ...opts, key: null, src: null, kind: null, playing: false, n: 0, el: $('hostMedia') };
    H.el.playsInline = true;
    $('mediaPlay').addEventListener('click', () => { H.playing = !H.playing; applyLocal(); sync(); });
    $('mediaRestart').addEventListener('click', () => {
      H.playing = true;
      H.n++;
      H.el.currentTime = 0;
      applyLocal();
      sync();
    });
    $('mediaMute').addEventListener('click', () => { H.el.muted = !H.el.muted; label(); });
    H.el.addEventListener('ended', () => { H.playing = false; label(); sync(); });
  }

  function label() {
    H.$('mediaPlay').textContent = H.playing ? '⏸ Pause (alle)' : '▶ Abspielen (alle)';
    H.$('mediaMute').textContent = H.el.muted ? '🔇 Hier stumm' : '🔊 Hier an';
    H.$('mediaKind').textContent = H.kind === 'video' ? '🎬 Video-Clip' : '🔊 Audio-Clip';
  }

  function applyLocal() {
    if (H.playing) play(H.el, () => { H.el.muted = true; play(H.el); label(); });
    else H.el.pause();
    label();
  }

  // Jede Verbindung bekommt die Daten genau einmal pro Frage (conn.mediaKey), sonst nur Steuerbefehle
  function sendTo(c) {
    if (!c.open) return;
    const m = { type: 'media', key: H.key, playing: H.playing, n: H.n, kind: H.kind };
    if (H.key && c.mediaKey !== H.key) m.src = H.src;
    c.mediaKey = H.key;
    c.send(m);
  }
  function sync() { if (H) for (const c of H.conns()) sendTo(c); }

  // Bei jedem Rendern der Frage (clue = aktuelle Frage oder null, key = eindeutig je Frage)
  function hostClue(clue, key) {
    if (!H) return;
    const src = clue ? J.safeMedia(clue.media) : '';
    const newKey = src ? key : null;
    H.$('mediaBox').hidden = !src;
    if (newKey === H.key) return;
    H.key = newKey;
    H.src = src || null;
    H.kind = src ? J.mediaTypeOf(clue) : null;
    H.playing = false;
    H.n = 0;
    if (src) { load(H.el, src, H.kind); label(); } else { H.el.pause(); H.el.removeAttribute('src'); }
    sync();
  }

  // Neue oder wieder verbundene Verbindung: Daten der aktuellen Frage nachreichen
  function hostJoined(conn) {
    if (!H) return;
    conn.mediaKey = null;
    if (H.key) sendTo(conn);
  }

  // ---------- Spieler / TV ----------
  let P = null;
  function playerInit($) {
    P = { $, key: null, n: 0, playing: false, el: $('playerMedia'), box: $('mediaWrap') };
    P.el.playsInline = true;
    $('mediaLocalMute').addEventListener('click', () => {
      P.el.muted = !P.el.muted;
      $('mediaLocalMute').textContent = P.el.muted ? '🔇 Stumm' : '🔊 Ton an';
    });
    $('mediaTap').addEventListener('click', () => {
      $('mediaTap').hidden = true;
      if (P.playing) play(P.el);
    });
  }

  // Nachricht vom Host prüfen – sie kommt übers Netz und ist nicht vertrauenswürdig
  function playerMessage(m) {
    if (!P || !m || typeof m !== 'object') return;
    const key = typeof m.key === 'string' && m.key.length <= 40 ? m.key : null;
    if (!key) {
      P.key = null;
      P.playing = false;
      P.el.pause();
      P.el.removeAttribute('src');
      P.box.hidden = true;
      P.$('mediaTap').hidden = true;
      return;
    }
    if (key !== P.key) {
      const src = J.safeMedia(m.src);
      if (!src) return; // Daten fehlen oder sind ungültig → nichts abspielen
      const kind = m.kind === 'video' ? 'video' : 'audio';
      P.key = key;
      P.n = Number.isInteger(m.n) ? m.n : 0;
      load(P.el, src, kind);
      P.box.hidden = false;
      P.box.classList.toggle('audio', kind !== 'video');
      P.$('mediaLabel').textContent = kind === 'video' ? '🎬 Video-Clip' : '🔊 Audio-Clip';
    }
    if (Number.isInteger(m.n) && m.n !== P.n) { P.n = m.n; P.el.currentTime = 0; }
    P.playing = m.playing === true;
    if (P.playing) play(P.el, () => { P.$('mediaTap').hidden = false; });
    else { P.el.pause(); P.$('mediaTap').hidden = true; }
  }

  window.JMedia = { editorControls, host, hostClue, hostJoined, playerInit, playerMessage };
})();
