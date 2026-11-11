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

  function defaultSet() {
    return {
      title: 'Jeopardy',
      rounds: Array.from({ length: ROUNDS }, (_, r) => ({
        categories: Array.from({ length: CATS }, (_, c) => ({
          name: `Kategorie ${r * CATS + c + 1}`,
          clues: Array.from({ length: ROWS }, (_, row) => ({
            q: `Frage für ${pointsFor(r, row)}`,
            a: 'Antwort',
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
        }
      }
    }
    return base;
  }

  function emptyUsed() {
    return Array.from({ length: ROUNDS }, () =>
      Array.from({ length: CATS }, () => Array(ROWS).fill(false))
    );
  }

  function defaultState() {
    return { round: 0, used: emptyUsed(), players: [], current: null, history: [] };
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
    } catch (e) {
      console.warn('Speichern fehlgeschlagen', e);
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
        a: cur.revealed ? clue.a : null,
        judged: cur.judged || {},
        buzz: cur.buzz || { open: false, winner: null },
        // Restzeit statt Uhrzeit, damit abweichende Geräteuhren egal sind
        timer: cur.timer
          ? { remaining: Math.max(0, cur.timer.endsAt - Date.now()), total: cur.timer.total }
          : null,
      };
    }
    return {
      title: set.title,
      theme: getTheme(),
      round: r,
      categories: set.rounds[r].categories.map((c) => c.name),
      values: Array.from({ length: ROWS }, (_, row) => pointsFor(r, row)),
      used: state.used[r],
      players: state.players.map((p) => ({ id: p.id, name: p.name, score: p.score })),
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

  function tone(ctx, { freq, to, start = 0, dur = 0.15, type = 'sine', vol = 0.2, filter }) {
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
    node.connect(gain).connect(ctx.destination);
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
    // Tiefer Summer
    wrong(ctx) {
      tone(ctx, { freq: 180, to: 110, dur: 0.55, type: 'sawtooth', vol: 0.16, filter: 900 });
      tone(ctx, { freq: 186, to: 113, dur: 0.55, type: 'square', vol: 0.06, filter: 700 });
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
    // Heller Glockenton beim Aufdecken
    reveal(ctx) {
      tone(ctx, { freq: 880, dur: 0.5, type: 'sine', vol: 0.16 });
      tone(ctx, { freq: 1320, start: 0.04, dur: 0.45, type: 'sine', vol: 0.08 });
    },
  };

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

  function renderScores(el, players) {
    if (!players.length) {
      el.innerHTML = '<div class="score-empty">Noch keine Spieler</div>';
      return;
    }
    el.innerHTML = players.map((p) => `
      <div class="score">
        <div class="score-name">${escapeHtml(p.name)}</div>
        <div class="score-value ${p.score < 0 ? 'neg' : ''}">${p.score}</div>
      </div>`).join('');
  }

  window.J = {
    CATS, ROWS, ROUNDS, SET_KEY,
    pointsFor, defaultSet, normalizeSet, defaultState,
    loadSet, saveSet, loadState, saveState,
    roomCode, newRoomCode, peerId, publicState, escapeHtml, renderScores,
    THEMES, getTheme, applyTheme, setTheme,
    penaltyFor, sfx, soundOn, setSoundOn, unlockAudio, audioUnlocked, renderTimer,
    TIMER_MS: 15000,
  };
})();
