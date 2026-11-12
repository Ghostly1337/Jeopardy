// Gemeinsame Logik für Editor, Host und Spieleransicht.
(function () {
  const CATS = 6;
  const ROWS = 5;
  const ROUNDS = 2;
  const SET_KEY = 'jeopardy.set';
  const STATE_KEY = 'jeopardy.state';
  const ROOM_KEY = 'jeopardy.room';
  const PEER_PREFIX = 'jeop-ghostly-';

  // Runde 1: 100–500, Runde 2: 200–1000
  function pointsFor(round, row) {
    return (row + 1) * 100 * (round + 1);
  }

  // Falsche Antwort kostet die Hälfte des Feldwerts
  function penaltyFor(round, row) {
    return pointsFor(round, row) / 2;
  }

  // Geklaute Frage (nach einer falschen Antwort) bringt nur die Hälfte
  function stealFor(round, row) {
    return pointsFor(round, row) / 2;
  }

  function defaultSet() {
    return {
      title: 'Jeopardy',
      rounds: Array.from({ length: ROUNDS }, (_, r) => ({
        categories: Array.from({ length: CATS }, (_, c) => ({
          name: `Kategorie ${r * CATS + c + 1}`,
          clues: Array.from({ length: ROWS }, (_, row) => ({
            q: `Frage für ${pointsFor(r, row)}`,
            a: 'Antwort',
            img: '',
            note: '',
          })),
        })),
      })),
    };
  }

  // Bringt beliebiges (z. B. importiertes) JSON in die erwartete Form.
  function normalizeSet(raw) {
    const base = defaultSet();
    if (!raw || typeof raw !== 'object') return base;
    base.title = typeof raw.title === 'string' ? raw.title : base.title;
    for (let r = 0; r < ROUNDS; r++) {
      const rr = raw.rounds && raw.rounds[r];
      for (let c = 0; c < CATS; c++) {
        const cc = rr && rr.categories && rr.categories[c];
        if (!cc) continue;
        const cat = base.rounds[r].categories[c];
        if (typeof cc.name === 'string') cat.name = cc.name;
        for (let row = 0; row < ROWS; row++) {
          const cl = cc.clues && cc.clues[row];
          if (!cl) continue;
          if (typeof cl.q === 'string') cat.clues[row].q = cl.q;
          if (typeof cl.a === 'string') cat.clues[row].a = cl.a;
          const img = safeImg(cl.img);
          if (img) cat.clues[row].img = img;
          if (typeof cl.note === 'string') cat.clues[row].note = cl.note;
          if (cl.pixel === true && img) cat.clues[row].pixel = true;
        }
      }
    }
    return base;
  }

  // Nur Web-Adressen oder hochgeladene Bilder zulassen (kein javascript: o. ä.)
  function safeImg(v) {
    if (typeof v !== 'string') return '';
    v = v.trim();
    return /^https?:\/\//i.test(v) || /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(v) ? v : '';
  }

  // Hochgeladenes Bild verkleinern (max. 1000 px, JPEG), damit es in den Browserspeicher
  // passt und schnell an die Spieler übertragen wird.
  function compressImage(file, max = 1000, quality = 0.75) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; // transparente PNGs nicht schwarz werden lassen
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht gelesen werden')); };
      img.src = url;
    });
  }

  // ---------- Verpixelte Bilder ----------
  // Bild startet grob verpixelt und wird per Knopf schärfer. Werte = Pixel an der längeren Seite;
  // nach der letzten Stufe (oder beim Aufdecken) sieht man das echte Bild.
  const PIXEL_STEPS = [6, 10, 16, 28];

  // Aktuelle Pixelstufe oder null, wenn das echte Bild gezeigt werden darf
  function pixelLevel(clue, cur) {
    if (!clue || !clue.pixel || !safeImg(clue.img) || !cur || cur.revealed) return null;
    const lvl = Math.max(0, Math.floor(cur.pixel || 0));
    return lvl < PIXEL_STEPS.length ? lvl : null;
  }

  // Bild auf wenige Pixel verkleinern (nur im Browser des Hosts). Die Spieler bekommen nur
  // dieses Mini-Bild und vergrößern es per CSS – das echte Bild erreicht sie erst beim Aufdecken.
  function pixelate(src, blocks) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (!/^data:/i.test(src)) img.crossOrigin = 'anonymous';
      img.onload = () => {
        const scale = blocks / Math.max(img.naturalWidth, img.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        try {
          resolve(canvas.toDataURL('image/png'));
        } catch (e) {
          reject(new Error('Bild lässt sich nicht verpixeln – bitte hochladen statt verlinken'));
        }
      };
      img.onerror = () => reject(new Error('Bild lässt sich nicht verpixeln – bitte hochladen statt verlinken'));
      img.src = src;
    });
  }

  // ---------- Verbindungshilfe (TURN) ----------
  // Standard-Server von PeerJS. Ihr TURN-Server läuft auf Port 3478, den Uni-/Firmennetze oft
  // sperren. Ein eigener TURN-Zugang über Port 443 kommt durch fast jede Firewall.
  const DEFAULT_ICE = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
  ];
  const TURN_KEY = 'jeopardy.turn';

  // Prüft und vereinheitlicht einen TURN-Zugang { urls: [...], username, credential }
  function parseTurn(t) {
    if (!t || typeof t !== 'object') return null;
    const list = (Array.isArray(t.urls) ? t.urls : String(t.urls || '').split(/[\s,]+/))
      .map((u) => String(u).trim())
      .filter((u) => /^turns?:[^\s]+$/i.test(u));
    if (!list.length) return null;
    return { urls: list, username: String(t.username || ''), credential: String(t.credential || '') };
  }
  function iceConfig(turn, forceRelay) {
    const servers = DEFAULT_ICE.slice();
    const t = parseTurn(turn);
    if (t) servers.unshift(t); // eigener Server zuerst
    const config = { iceServers: servers };
    if (forceRelay) config.iceTransportPolicy = 'relay';
    return config;
  }
  // Für den Beitrittslink: kompakt, URL-sicher, Unicode-fest
  function encodeTurn(t) {
    t = parseTurn(t);
    if (!t) return '';
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify([t.urls, t.username, t.credential]))));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeTurn(s) {
    try {
      const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
      const [urls, username, credential] = JSON.parse(decodeURIComponent(escape(atob(b64))));
      return parseTurn({ urls, username, credential });
    } catch (e) {
      return null;
    }
  }
  function loadTurn(key = TURN_KEY) {
    try { return parseTurn(JSON.parse(localStorage.getItem(key))); } catch (e) { return null; }
  }
  function saveTurn(t, key = TURN_KEY) {
    try {
      const p = parseTurn(t);
      if (p) localStorage.setItem(key, JSON.stringify(p)); else localStorage.removeItem(key);
      return p;
    } catch (e) { return null; }
  }

  // ---------- Spielregeln (reine Funktionen, unit-getestet) ----------
  // „Am Zug“ geht reihum in Listenreihenfolge.
  function nextTurn(ids, current) {
    if (!ids.length) return null;
    const i = ids.indexOf(current);
    return ids[(i + 1) % ids.length]; // unbekannt/null → erster (i = -1)
  }
  // Wer bekommt den Zug, wenn ein Spieler entfernt wird?
  function turnAfterRemoval(ids, current, removedId) {
    if (current !== removedId) return current;
    const rest = ids.filter((id) => id !== removedId);
    if (!rest.length) return null;
    const i = ids.indexOf(removedId);
    return ids.slice(i + 1).find((id) => id !== removedId) || rest[0];
  }

  // Anti-Spam: Wer zu früh drückt, wird gesperrt; Reaktionen unter MIN_REACTION_MS gelten als Frühstart.
  const LOCK_MS = 1000;
  const MIN_REACTION_MS = 100;
  const isEarly = (reactionMs) => !(reactionMs >= MIN_REACTION_MS);

  // Schnellste gültige Reaktion gewinnt. entries: [[id, ms, name?], ...]
  function pickBuzzWinner(entries) {
    let best = null;
    for (const [id, ms, name] of entries) {
      if (!Number.isFinite(ms) || isEarly(ms)) continue;
      if (!best || ms < best.ms) best = { id, ms, name: name || null };
    }
    return best;
  }

  // Team-Modus
  function clampTeamSize(n) {
    n = parseInt(n, 10);
    return Number.isFinite(n) ? Math.min(20, Math.max(1, n)) : 3;
  }
  const teamIsFull = (members, teamSize) => members >= clampTeamSize(teamSize);
  const TEAM_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#14b8a6', '#ec4899'];
  const teamColor = (index) => TEAM_COLORS[index % TEAM_COLORS.length];
  function cleanName(n) {
    return String(n || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  }

  function emptyUsed() {
    return Array.from({ length: ROUNDS }, () =>
      Array.from({ length: CATS }, () => Array(ROWS).fill(false))
    );
  }

  function defaultState() {
    return {
      round: 0, used: emptyUsed(), players: [], current: null, turn: null, finished: false,
      stats: {}, personStats: {}, mode: 'single', teamSize: 3, history: [],
    };
  }

  function load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback();
    } catch (e) {
      return fallback();
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('Speichern fehlgeschlagen', e);
      return false;
    }
  }

  const loadSet = () => normalizeSet(load(SET_KEY, defaultSet));
  const saveSet = (s) => save(SET_KEY, s);

  function loadState() {
    const s = load(STATE_KEY, defaultState);
    const d = defaultState();
    return {
      round: s.round === 1 ? 1 : 0,
      used: Array.isArray(s.used) && s.used.length === ROUNDS ? s.used : d.used,
      players: Array.isArray(s.players) ? s.players : [],
      current: s.current || null,
      turn: typeof s.turn === 'string' ? s.turn : null,
      stats: s.stats && typeof s.stats === 'object' ? s.stats : {},
      personStats: s.personStats && typeof s.personStats === 'object' ? s.personStats : {},
      mode: s.mode === 'team' ? 'team' : 'single',
      teamSize: clampTeamSize(s.teamSize),
      finished: !!s.finished,
      history: Array.isArray(s.history) ? s.history : [],
    };
  }
  const saveState = (s) => save(STATE_KEY, s);

  function roomCode() {
    let code = localStorage.getItem(ROOM_KEY);
    if (!code) {
      code = newRoomCode();
    }
    return code;
  }
  function newRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    try { localStorage.setItem(ROOM_KEY, code); } catch (e) {}
    return code;
  }
  const peerId = (code) => PEER_PREFIX + code.toUpperCase();

  // Was die Spieler sehen dürfen: keine Antworten, außer der aktuellen nach dem Aufdecken.
  function publicState(set, state) {
    const r = state.round;
    const cur = state.current;
    let current = null;
    if (cur) {
      const clue = set.rounds[cur.round].categories[cur.cat].clues[cur.row];
      current = {
        cat: cur.cat,
        row: cur.row,
        category: set.rounds[cur.round].categories[cur.cat].name,
        value: pointsFor(cur.round, cur.row),
        q: clue.q,
        // Verpixelte Bilder: echtes Bild erst nach der letzten Stufe; das Mini-Bild setzt der Host ein
        img: pixelLevel(clue, cur) == null ? safeImg(clue.img) || null : null,
        pixel: pixelLevel(clue, cur) == null ? null : { step: pixelLevel(clue, cur), steps: PIXEL_STEPS.length },
        a: cur.revealed ? clue.a : null,
        judged: cur.judged || {},
        buzz: cur.buzz || { open: false, winner: null },
        // Restzeit statt Uhrzeit, damit abweichende Geräteuhren egal sind
        timer: cur.timer
          ? { remaining: Math.max(0, cur.timer.endsAt - Date.now()), total: cur.timer.total }
          : null,
      };
    }
    // Runden-Intro: noch nicht aufgedeckte Kategorien bleiben leer
    const intro = state.intro && state.intro.round === r ? state.intro : null;
    const names = set.rounds[r].categories.map((c) => c.name);
    return {
      title: set.title,
      theme: getTheme(),
      round: r,
      categories: names.map((n, i) => (intro && i >= intro.step ? '' : n)),
      intro: intro ? { step: intro.step, name: intro.step > 0 ? names[intro.step - 1] : null } : null,
      values: Array.from({ length: ROWS }, (_, row) => pointsFor(r, row)),
      used: state.used[r],
      players: state.players.map((p, i) => ({
        id: p.id, name: p.name, score: p.score,
        color: state.mode === 'team' ? teamColor(i) : null,
      })),
      mode: state.mode === 'team' ? 'team' : 'single',
      teamSize: clampTeamSize(state.teamSize),
      turn: state.turn || null,
      finished: !!state.finished,
      stats: state.stats || {},
      personStats: state.mode === 'team' ? state.personStats || {} : {},
      current,
    };
  }

  // Farbthemen (Werte nur für die Vorschau im Host; das eigentliche Styling steckt in style.css)
  const THEMES = [
    { id: 'graphit', name: 'Graphit', sw: ['#1d1e22', '#34d399'] },
    { id: 'hell', name: 'Hell', sw: ['#ffffff', '#18181b'] },
    { id: 'nacht', name: 'Nacht', sw: ['#5b21b6', '#f472b6'] },
    { id: 'wald', name: 'Wald', sw: ['#1b5e3b', '#e9d8a6'] },
    { id: 'klassisch', name: 'Klassisch', sw: ['#2f55f0', '#ffc940'] },
  ];
  const THEME_KEY = 'jeopardy.theme';
  function getTheme() {
    try {
      const t = localStorage.getItem(THEME_KEY);
      if (THEMES.some((x) => x.id === t)) return t;
    } catch (e) {}
    return 'graphit';
  }
  function applyTheme(id) {
    if (!THEMES.some((x) => x.id === id)) id = 'graphit';
    document.documentElement.dataset.theme = id;
  }
  function setTheme(id) {
    try { localStorage.setItem(THEME_KEY, id); } catch (e) {}
    applyTheme(id);
  }

  // ---------- Sounds (per Web Audio erzeugt, keine Dateien nötig) ----------
  const SOUND_KEY = 'jeopardy.sound';
  let audio = null;
  function soundOn() {
    try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch (e) { return true; }
  }
  function setSoundOn(on) {
    try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch (e) {}
  }
  function audioCtx() {
    if (!audio) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audio = new AC();
    }
    if (audio.state === 'suspended') audio.resume();
    return audio;
  }
  // Browser erlauben Ton erst nach einer Nutzeraktion → beim ersten Tippen freischalten.
  function unlockAudio() {
    const ctx = audioCtx();
    return !!ctx && ctx.state === 'running';
  }
  function audioUnlocked() {
    return !!audio && audio.state === 'running';
  }

  function tone(ctx, { freq, to, start = 0, dur = 0.15, type = 'sine', vol = 0.2, filter, dest }) {
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filter;
      osc.connect(f);
      node = f;
    }
    node.connect(gain).connect(dest || ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  const SOUNDS = {
    // Aufsteigender Dreiklang
    right(ctx) {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        tone(ctx, { freq: f, start: i * 0.08, dur: i === 3 ? 0.45 : 0.18, type: 'triangle', vol: 0.22 })
      );
    },
    // Dumpfer „Bonk“
    wrong(ctx) {
      tone(ctx, { freq: 160, to: 60, dur: 0.3, type: 'sine', vol: 0.45 });
    },
    // Kurzes „Swoosh“ beim Öffnen einer Frage
    open(ctx) {
      tone(ctx, { freq: 380, to: 900, dur: 0.18, type: 'sine', vol: 0.14 });
      tone(ctx, { freq: 760, start: 0.12, dur: 0.25, type: 'triangle', vol: 0.08 });
    },
    // Jemand hat gebuzzert
    buzz(ctx) {
      tone(ctx, { freq: 1046.5, dur: 0.12, type: 'square', vol: 0.12, filter: 3000 });
      tone(ctx, { freq: 1568, start: 0.1, dur: 0.3, type: 'square', vol: 0.1, filter: 3000 });
    },
    // Buzzer ist offen
    buzzopen(ctx) {
      tone(ctx, { freq: 660, dur: 0.1, type: 'triangle', vol: 0.18 });
      tone(ctx, { freq: 660, start: 0.16, dur: 0.1, type: 'triangle', vol: 0.18 });
    },
    // Zeit abgelaufen
    timeup(ctx) {
      tone(ctx, { freq: 330, dur: 0.35, type: 'square', vol: 0.12, filter: 1200 });
      tone(ctx, { freq: 247, start: 0.4, dur: 0.6, type: 'square', vol: 0.12, filter: 1200 });
    },
    // Sekunden-Tick in den letzten 5 Sekunden
    tick(ctx) {
      tone(ctx, { freq: 1200, dur: 0.05, type: 'sine', vol: 0.12 });
    },
    // Rundenstart: aufsteigender Akkord
    intro(ctx) {
      [261.63, 329.63, 392, 523.25, 659.25].forEach((f, i) =>
        tone(ctx, { freq: f, start: i * 0.11, dur: 1.2 - i * 0.1, type: 'triangle', vol: 0.12 })
      );
      tone(ctx, { freq: 130.81, dur: 1.4, type: 'sine', vol: 0.15 });
    },
    // Kategorie wird aufgedeckt: Wusch + heller Ton
    catreveal(ctx) {
      tone(ctx, { freq: 200, to: 1200, dur: 0.25, type: 'sine', vol: 0.08 });
      tone(ctx, { freq: 987.77, start: 0.2, dur: 0.5, type: 'triangle', vol: 0.12 });
      tone(ctx, { freq: 1479.98, start: 0.24, dur: 0.45, type: 'sine', vol: 0.06 });
    },
    // Fanfare zur Siegerehrung
    fanfare(ctx) {
      const notes = [[523.25, 0, 0.14], [523.25, 0.16, 0.14], [523.25, 0.32, 0.14], [659.25, 0.48, 0.5],
        [587.33, 1.0, 0.14], [659.25, 1.16, 0.14], [783.99, 1.32, 0.9]];
      notes.forEach(([f, s, d]) => {
        tone(ctx, { freq: f, start: s, dur: d, type: 'sawtooth', vol: 0.1, filter: 2200 });
        tone(ctx, { freq: f * 2, start: s, dur: d, type: 'triangle', vol: 0.06 });
      });
    },
    // Heller Glockenton beim Aufdecken
    reveal(ctx) {
      tone(ctx, { freq: 880, dur: 0.5, type: 'sine', vol: 0.16 });
      tone(ctx, { freq: 1320, start: 0.04, dur: 0.45, type: 'sine', vol: 0.08 });
    },
  };

  // Timer-Sound (nur TV-Ansicht und Host-Pult): Uhr-Ticken jede Sekunde, tiefer Herzschlag
  // alle 2,5 s (am Ende etwas kräftiger), leise Piepser bei 3-2-1. Alles wird beim Start
  // vorausgeplant und hängt an einem eigenen Regler, damit Stopp sofort alles verstummen lässt.
  // Musik-Spuren: jede hat einen eigenen Lautstärkeregler, damit Stopp sofort alles verstummen lässt
  const tracks = {};
  function startTrack(name, schedule) {
    stopTrack(name);
    const ctx = audioCtx();
    if (!ctx) return;
    const bus = ctx.createGain();
    bus.connect(ctx.destination);
    schedule((o) => tone(ctx, { ...o, dest: bus }));
    tracks[name] = { ctx, bus };
  }
  function stopTrack(name) {
    const tr = tracks[name];
    if (!tr) return;
    delete tracks[name];
    tr.bus.gain.setTargetAtTime(0.0001, tr.ctx.currentTime, 0.08);
    setTimeout(() => tr.bus.disconnect(), 600);
  }
  const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // Intro-Musik (TV-Ansicht und Host-Pult): 120 bpm, Am – F – C – G als Arpeggio mit Bass,
  // 8 Takte = 16 s, so lang wie das Runden-Intro; die letzten zwei Takte doppelt so dicht
  function startIntroMusic() {
    startTrack('intro', (T) => {
      const beat = 0.5;
      const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
      for (let bar = 0; bar < 8; bar++) {
        const ch = chords[bar % 4], t0 = bar * 4 * beat;
        T({ freq: midiHz(ch[0] - 12), start: t0, dur: 0.45, vol: 0.28 });
        T({ freq: midiHz(ch[0] - 12), start: t0 + 2 * beat, dur: 0.45, vol: 0.22 });
        const steps = bar >= 6 ? 16 : 8, len = 4 * beat / steps;
        for (let i = 0; i < steps; i++) {
          const n = ch[i % 3] + (i % 6 >= 3 ? 12 : 0);
          T({ freq: midiHz(n + 12), start: t0 + i * len, dur: len * 0.9, type: 'triangle', vol: bar >= 6 ? 0.07 : 0.09 });
        }
        for (let k = 0; k < 4; k++) T({ freq: 2400, start: t0 + k * beat, dur: 0.03, type: 'square', vol: 0.025 });
      }
    });
  }
  const stopIntroMusic = () => stopTrack('intro');

  function startTimerMusic(remainingMs) {
    startTrack('timer', (T) => {
      const R = remainingMs / 1000;
      for (let t = R % 1, k = 0; t < R - 0.05; t += 1, k++) {
        T({ freq: k % 2 ? 1400 : 1800, start: t, dur: 0.025, type: 'square', vol: 0.02 });
      }
      for (let t = 0.5; t < R; t += 2.5) {
        const v = R - t <= 5 ? 0.32 : 0.22;
        T({ freq: 55, start: t, dur: 0.22, vol: v });
        T({ freq: 52, start: t + 0.24, dur: 0.26, vol: v * 0.7 });
      }
      [3, 2, 1].forEach((s) => { if (R - s > 0.05) T({ freq: 880, start: R - s, dur: 0.1, vol: 0.08 }); });
    });
  }
  const stopTimerMusic = () => stopTrack('timer');
  const timerMusicOn = () => !!tracks.timer;

  function sfx(name) {
    const ctx = audioCtx();
    if (!ctx || !SOUNDS[name]) return;
    try { SOUNDS[name](ctx); } catch (e) { console.warn('Sound fehlgeschlagen', e); }
  }

  // Timer-Anzeige (Host und Spieler): Balken + Sekunden
  function renderTimer(el, remaining, total) {
    if (remaining == null) { el.hidden = true; return; }
    el.hidden = false;
    const secs = Math.ceil(remaining / 1000);
    el.classList.toggle('urgent', secs <= 5);
    el.querySelector('.timer-num').textContent = secs;
    el.querySelector('.timer-fill').style.width = (100 * remaining / total) + '%';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]);
  }

  function renderScores(el, players, turnId) {
    if (!players.length) {
      el.innerHTML = '<div class="score-empty">Noch keine Spieler</div>';
      el.__prev = null;
      return;
    }
    const prev = el.__prev || null;
    el.__prev = Object.fromEntries(players.map((p) => [p.id, p.score]));
    el.innerHTML = players.map((p) => `
      <div class="score${p.id && p.id === turnId ? ' turn' : ''}"${p.color ? ` style="--team:${p.color}"` : ''}>
        <div class="score-name">${p.color ? '<i class="team-dot"></i>' : ''}${escapeHtml(p.name)}</div>
        <div class="score-value ${p.score < 0 ? 'neg' : ''}">${p.score}</div>
        ${scoreDelta(prev, p)}
      </div>`).join('');
    // Geänderte Punkte: Kachel leuchtet grün/rot auf, Zahl rollt vom alten zum neuen Wert
    if (!prev) return;
    el.querySelectorAll('.score').forEach((tile, i) => {
      const p = players[i];
      if (!(p.id in prev) || prev[p.id] === p.score) return;
      tile.classList.add(p.score > prev[p.id] ? 'fx-up' : 'fx-down');
      countUp(tile.querySelector('.score-value'), prev[p.id], p.score);
    });
  }
  function countUp(node, from, to) {
    const dur = window.JEOP_COUNT_MS != null ? window.JEOP_COUNT_MS : 700;
    if (!dur || typeof requestAnimationFrame !== 'function') return;
    const t0 = performance.now();
    node.textContent = from;
    (function step(now) {
      if (!node.isConnected) return; // inzwischen neu gezeichnet
      const k = Math.min(1, (now - t0) / dur);
      node.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }
  // „+500“ / „−250“ fliegt kurz über die Kachel, wenn sich die Punkte geändert haben
  function scoreDelta(prev, p) {
    if (!prev || !(p.id in prev)) return '';
    const d = p.score - prev[p.id];
    if (!d) return '';
    return `<span class="delta ${d > 0 ? 'pos' : 'neg'}">${d > 0 ? '+' : '−'}${Math.abs(d)}</span>`;
  }

  // ---------- Runden-Intro ----------
  // Großes Overlay: erst „Runde X“, dann jede Kategorie einzeln
  function renderIntro(el, intro, round, values) {
    el.classList.toggle('show', !!intro);
    if (!intro) { el.dataset.step = ''; return; }
    const key = round + ':' + intro.step;
    if (el.dataset.step === key) return; // Animation nicht bei jedem Update neu starten
    el.dataset.step = key;
    const kicker = el.querySelector('.intro-kicker');
    const title = el.querySelector('.intro-title');
    const sub = el.querySelector('.intro-sub');
    if (intro.step === 0) {
      kicker.textContent = 'Jeopardy';
      title.textContent = 'Runde ' + (round + 1);
      sub.textContent = values[0] + ' – ' + values[values.length - 1] + ' Punkte';
    } else {
      kicker.textContent = `Kategorie ${intro.step} von ${CATS}`;
      title.textContent = intro.name || '';
      sub.textContent = '';
    }
    const inner = el.querySelector('.intro-inner');
    inner.classList.remove('anim');
    void inner.offsetWidth; // Reflow, damit die Animation neu startet
    inner.classList.add('anim');
  }

  // Klassen für Board-Zellen während/nach dem Intro
  function introCellClass(intro, catIndex) {
    if (!intro) return '';
    if (catIndex >= intro.step) return ' hidden-cat';
    return catIndex === intro.step - 1 ? ' flip' : '';
  }

  // Banner „Anna wählt“
  function renderTurn(el, players, turnId) {
    const p = players.find((x) => x.id === turnId);
    el.hidden = !p;
    if (p) el.innerHTML = `<span class="turn-label">Am Zug</span> ${escapeHtml(p.name)} wählt`;
  }

  // ---------- Siegerehrung ----------
  // Platzierung mit Gleichstand (1, 1, 3 …)
  function ranking(players) {
    const sorted = [...players].sort((a, b) => b.score - a.score);
    let place = 0;
    return sorted.map((p, i) => {
      if (i === 0 || p.score !== sorted[i - 1].score) place = i + 1;
      return { ...p, place };
    });
  }

  // 420 → „0,42 s“
  function fmtMs(ms) {
    return (ms / 1000).toFixed(2).replace('.', ',') + ' s';
  }

  // Auszeichnungen aus der Spielstatistik (nur vergeben, wenn es etwas zu zeigen gibt)
  const AWARDS = [
    { icon: '⚡', title: 'Buzzer-König', key: 'buzzWins', best: 'max', fmt: (v) => v + '× zuerst gebuzzert' },
    { icon: '🦝', title: 'Meisterdieb', key: 'steals', best: 'max', fmt: (v) => v + '× geklaut' },
    { icon: '🎯', title: 'Treffsicher', key: 'right', best: 'max', fmt: (v) => v + ' richtig' },
    { icon: '🙈', title: 'Meiste Fehlversuche', key: 'wrong', best: 'max', fmt: (v) => v + ' falsch' },
  ];
  // persons (nur Team-Modus): { key: { name, team, buzzWins } } – Buzzer-König geht dann an eine Person
  function awards(players, stats, persons) {
    stats = stats || {};
    const personList = persons && Object.keys(persons).length
      ? Object.values(persons).map((x) => ({ p: { name: `${x.name} (${x.team})` }, s: x }))
      : null;
    const out = [];
    AWARDS.forEach((a) => {
      const source = a.key === 'buzzWins' && personList
        ? personList
        : players.map((p) => ({ p, s: stats[p.id] || {} }));
      const vals = source
        .map(({ p, s }) => ({ p, v: s[a.key] }))
        .filter((x) => typeof x.v === 'number' && (a.best === 'min' || x.v > 0));
      if (!vals.length) return;
      const best = a.best === 'min' ? Math.min(...vals.map((x) => x.v)) : Math.max(...vals.map((x) => x.v));
      const who = vals.filter((x) => x.v === best).map((x) => x.p.name);
      out.push({ ...a, names: who, value: a.fmt(best) });
    });
    return out;
  }

  function renderPodium(el, players, title, stats, persons) {
    const ranked = ranking(players);
    const top = ranked.filter((p) => p.place <= 3);
    const rest = ranked.filter((p) => p.place > 3);
    // Reihenfolge auf dem Treppchen: 2 – 1 – 3
    const slot = (place) => top.filter((p) => p.place === place);
    const col = (place) => {
      const ps = slot(place);
      if (!ps.length) return '<div class="pod-col empty"></div>';
      return `<div class="pod-col p${place}">
        <div class="pod-names">${ps.map((p) => `<div class="pod-name">${escapeHtml(p.name)}</div>`).join('')}</div>
        <div class="pod-score">${ps[0].score}</div>
        <div class="pod-block"><span>${place}</span></div>
      </div>`;
    };
    const winners = slot(1).map((p) => escapeHtml(p.name)).join(' & ');
    el.innerHTML = `
      <div class="pod-title">${escapeHtml(title || 'Endstand')}</div>
      <div class="pod-winner">${winners ? '🏆 ' + winners : 'Keine Spieler'}</div>
      <div class="podium">${col(2)}${col(1)}${col(3)}</div>
      ${rest.length ? `<div class="pod-rest">${rest.map((p) =>
        `<div><span>${p.place}.</span> ${escapeHtml(p.name)} <b>${p.score}</b></div>`).join('')}</div>` : ''}
      ${(() => {
        const list = awards(players, stats, persons);
        return list.length ? `<div class="awards">${list.map((a, i) => `
          <div class="award" style="--d:${1.2 + i * 0.25}s">
            <div class="award-icon">${a.icon}</div>
            <div class="award-title">${escapeHtml(a.title)}</div>
            <div class="award-name">${a.names.map(escapeHtml).join(' & ')}</div>
            <div class="award-value">${escapeHtml(a.value)}</div>
          </div>`).join('')}</div>` : '';
      })()}`;
  }

  // ---------- Live-Reaktionen ----------
  const REACTIONS = ['😂', '👏', '😱', '🔥', '🤔'];
  function showReaction(emoji, name) {
    if (!REACTIONS.includes(emoji)) return;
    let layer = document.getElementById('reactLayer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'reactLayer';
      layer.className = 'react-layer';
      document.body.appendChild(layer);
    }
    if (layer.childElementCount > 40) layer.firstElementChild.remove(); // bei Spam begrenzen
    const el = document.createElement('div');
    el.className = 'react-float';
    el.style.left = (8 + Math.random() * 84) + '%';
    el.style.setProperty('--sway', (Math.random() * 80 - 40).toFixed(0) + 'px');
    el.innerHTML = `<span class="react-emoji">${emoji}</span>${name ? `<span class="react-name">${escapeHtml(name)}</span>` : ''}`;
    el.addEventListener('animationend', () => el.remove());
    layer.appendChild(el);
  }

  // Konfetti als DOM-Elemente (keine Bibliothek nötig)
  function confetti(el, count = 140) {
    el.querySelectorAll('.confetti').forEach((c) => c.remove());
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const colors = ['var(--accent)', 'var(--accent-2)', '#f87171', '#60a5fa', '#fbbf24', '#a78bfa', '#ffffff'];
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const c = document.createElement('i');
      c.className = 'confetti';
      c.style.left = Math.random() * 100 + '%';
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = (Math.random() * 2.5).toFixed(2) + 's';
      c.style.animationDuration = (3 + Math.random() * 3).toFixed(2) + 's';
      c.style.setProperty('--drift', (Math.random() * 200 - 100).toFixed(0) + 'px');
      c.style.setProperty('--spin', (Math.random() * 1080 - 540).toFixed(0) + 'deg');
      if (i % 3 === 0) c.style.borderRadius = '50%';
      frag.appendChild(c);
    }
    el.appendChild(frag);
  }

  window.J = {
    PIXEL_STEPS, pixelLevel, pixelate,
    CATS, ROWS, ROUNDS, SET_KEY,
    pointsFor, defaultSet, normalizeSet, defaultState,
    loadSet, saveSet, loadState, saveState,
    roomCode, newRoomCode, peerId, publicState, escapeHtml, renderScores,
    THEMES, getTheme, applyTheme, setTheme,
    penaltyFor, stealFor, sfx, startTimerMusic, stopTimerMusic, timerMusicOn, startIntroMusic, stopIntroMusic, soundOn, setSoundOn, unlockAudio, audioUnlocked, renderTimer,
    TIMER_MS: 15000,
    safeImg, compressImage, renderTurn, renderPodium, confetti, ranking,
    renderIntro, introCellClass,
    nextTurn, turnAfterRemoval, LOCK_MS, MIN_REACTION_MS, isEarly, pickBuzzWinner,
    clampTeamSize, teamIsFull, teamColor, cleanName,
    DEFAULT_ICE, parseTurn, iceConfig, encodeTurn, decodeTurn, loadTurn, saveTurn, scoreDelta,
    fmtMs, awards, REACTIONS, showReaction, BUZZ_WINDOW_MS: 400,
    // Übers Relay kommen Buzzes ungleichmäßiger an (HTTP statt Direktverbindung) → länger sammeln
    BUZZ_WINDOW_RELAY_MS: 900,
  };
})();
