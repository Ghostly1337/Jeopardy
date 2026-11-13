(function () {
  let set = J.loadSet();
  let state = J.loadState();
  const HISTORY_LIMIT = 200;
  const $ = (id) => document.getElementById(id);

  // ---------- State-Änderungen mit Undo ----------
  function snapshot(label) {
    return {
      label,
      round: state.round,
      used: JSON.parse(JSON.stringify(state.used)),
      players: JSON.parse(JSON.stringify(state.players)),
      current: state.current ? JSON.parse(JSON.stringify(state.current)) : null,
      turn: state.turn,
      finished: state.finished,
      stats: JSON.parse(JSON.stringify(state.stats || {})),
      personStats: JSON.parse(JSON.stringify(state.personStats || {})),
      mode: state.mode,
      teamSize: state.teamSize,
    };
  }

  function mutate(label, fn) {
    state.history.push(snapshot(label));
    if (state.history.length > HISTORY_LIMIT) state.history.shift();
    fn();
    commit();
  }

  function undo() {
    const snap = state.history.pop();
    if (!snap) return;
    stopIntro(false);
    state.round = snap.round;
    state.used = snap.used;
    state.players = snap.players;
    state.current = snap.current;
    state.turn = snap.turn || null;
    state.finished = !!snap.finished;
    state.stats = snap.stats || {};
    state.personStats = snap.personStats || {};
    if (snap.mode) state.mode = snap.mode;
    if (snap.teamSize) state.teamSize = snap.teamSize;
    pendingBuzz = null;
    if (state.current) state.current.timer = null; // alte Timer nicht wiederbeleben
    commit();
  }

  function commit() {
    J.saveState(state);
    render();
    broadcast();
  }

  // ---------- Rendering ----------
  function render() {
    renderBoard();
    renderClue();
    renderPlayers();
    renderLog();
    renderFinish();
    renderModeUI();
    // Gleiche Daten wie bei den Spielern (inkl. Kategoriename) – sonst bleibt der Titel leer
    J.renderIntro($('intro'), J.publicState(set, state).intro,
      state.round, Array.from({ length: J.ROWS }, (_, row) => J.pointsFor(state.round, row)));
    $('introBtn').disabled = !!state.current || !!state.intro;
    J.renderTurn($('turnBanner'), state.players, state.turn);
    $('r0').className = state.round === 0 ? 'primary' : '';
    $('r1').className = state.round === 1 ? 'primary' : '';
    $('undo').disabled = state.history.length === 0;
  }

  function renderBoard() {
    const r = state.round;
    const cats = set.rounds[r].categories;
    const board = $('board');
    board.innerHTML = '';
    const intro = state.intro && state.intro.round === r ? state.intro : null;
    board.classList.toggle('intro-active', !!intro);
    cats.forEach((c, i) => {
      const el = document.createElement('div');
      el.className = 'cell cat' + J.introCellClass(intro, i);
      el.textContent = c.name;
      board.appendChild(el);
    });
    for (let row = 0; row < J.ROWS; row++) {
      for (let c = 0; c < J.CATS; c++) {
        const el = document.createElement('div');
        const used = state.used[r][c][row];
        const cur = state.current;
        const active = cur && cur.round === r && cur.cat === c && cur.row === row;
        el.className = 'cell val' + (used ? ' used' : '') + (active ? ' active' : '');
        el.textContent = J.pointsFor(r, row);
        el.title = cats[c].clues[row].q;
        el.style.setProperty('--i', row * J.CATS + c);
        el.addEventListener('click', () => onCell(c, row));
        board.appendChild(el);
      }
    }
  }

  function onCell(cat, row) {
    if (state.intro) return;
    const r = state.round;
    if (state.used[r][cat][row]) {
      if (confirm('Dieses Feld wieder freigeben?')) {
        mutate(`Feld ${J.pointsFor(r, row)} „${set.rounds[r].categories[cat].name}“ freigegeben`, () => {
          state.used[r][cat][row] = false;
        });
      }
      return;
    }
    // Verpixelte Bilder: Buzzer-Rennen – der Buzzer öffnet sofort für alle, wer das Bild
    // zuerst erkennt, darf antworten (sonst könnte der Spieler am Zug einfach abwarten)
    const race = J.pixelLevel(set.rounds[r].categories[cat].clues[row], { revealed: false }) != null && state.players.length > 0;
    mutate(`Frage ${J.pointsFor(r, row)} „${set.rounds[r].categories[cat].name}“ geöffnet`, () => {
      state.current = {
        round: r, cat, row, revealed: false, judged: {},
        buzz: race ? { open: false, winner: null, arming: true } : closedBuzz(), timer: null,
      };
    });
    sound('open');
    if (race) armBuzz();
  }

  const nameOf = (pid) => (state.players.find((p) => p.id === pid) || {}).name || '?';
  const isTeam = () => state.mode === 'team';
  const ids = () => state.players.map((p) => p.id);
  // „Anna (Team Rot)“ im Team-Modus, sonst nur der Spielername
  const whoBuzzed = (buzz) => (isTeam() && buzz.winnerName ? `${buzz.winnerName} (${nameOf(buzz.winner)})` : nameOf(buzz.winner));

  // ---------- Buzzer ----------
  // Spieler, die bei dieser Frage noch nicht gewertet wurden
  function unjudged() {
    const j = state.current.judged || {};
    return state.players.filter((p) => !j[p.id]);
  }

  // Neue Buzzer-Runde mit eigener ID, damit verspätete Buzzes aus einer älteren Runde nicht zählen
  const openBuzz = () => ({ open: true, winner: null, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5) });
  const closedBuzz = () => ({ open: false, winner: null });

  function stat(pid) {
    if (!state.stats) state.stats = {};
    return state.stats[pid] || (state.stats[pid] = { right: 0, wrong: 0, buzzWins: 0, steals: 0 });
  }

  // Fairer Buzzer: Jedes Handy misst die Reaktionszeit ab dem Moment, in dem der Knopf dort
  // erschien. Der Host sammelt nach dem ersten Buzz kurz alle weiteren ein und nimmt die
  // schnellste Reaktion – so entscheidet der Reflex, nicht die Internetleitung.
  let pendingBuzz = null;
  function handleBuzz(conn, msg) {
    const cur = state.current;
    const pid = conn.playerId;
    if (!cur || !cur.buzz || !cur.buzz.open || !pid) return;
    if (msg.id !== cur.buzz.id) return;
    if (!state.players.some((p) => p.id === pid) || (cur.judged || {})[pid]) return;
    let reaction = Number(msg.reaction);
    if (!Number.isFinite(reaction)) return;
    reaction = Math.min(60000, Math.round(reaction));
    if (J.isEarly(reaction)) return; // unmenschlich schnell = Frühstart, zählt nicht
    if (!pendingBuzz || pendingBuzz.id !== cur.buzz.id) {
      pendingBuzz = { id: cur.buzz.id, entries: new Map() };
      setTimeout(decideBuzz, window.JEOP_BUZZ_WINDOW_MS || (J.net.mode === 'relay' ? J.BUZZ_WINDOW_RELAY_MS : J.BUZZ_WINDOW_MS));
    }
    // Pro Spieler/Team zählt die schnellste Reaktion (im Team-Modus kann jedes Mitglied drücken)
    const prev = pendingBuzz.entries.get(pid);
    if (!prev || reaction < prev.ms) pendingBuzz.entries.set(pid, { ms: reaction, name: conn.memberName || null });
  }

  // ---------- Joker ----------
  function handleJoker(conn, msg) {
    const pid = conn.playerId;
    const kind = msg.kind;
    const target = kind === 'pass' ? msg.target : undefined;
    if (kind === 'pass' && typeof target !== 'string') return;
    const cur = state.current;
    if (J.jokerBlock(kind, { cur, players: state.players, turn: state.turn, pid, target })) return;
    const p = state.players.find((x) => x.id === pid);
    const info = J.jokerInfo(kind);
    const who = isTeam() && conn.memberName ? `${conn.memberName} (${p.name})` : p.name;
    const label = kind === 'pass' ? `👉 ${who} gibt weiter an ${nameOf(target)}` : `${info.icon} ${who}: ${info.name}`;
    mutate(label, () => {
      p.usedJokers = [...(p.usedJokers || []), kind];
      const jk = cur.jokers || (cur.jokers = {});
      if (kind === 'pass') jk.pass = { from: pid, to: target, by: who };
      else jk[kind] = [...(jk[kind] || []), pid];
    });
    sound('joker');
    if (kind === 'hint') sendHint(pid);
  }

  // Tipp nur an die Geräte dieses Spielers/Teams schicken – nie an alle
  function sendHint(pid) {
    const cur = state.current;
    if (!cur || !((cur.jokers && cur.jokers.hint) || []).includes(pid)) return;
    const clue = set.rounds[cur.round].categories[cur.cat].clues[cur.row];
    const msg = { type: 'hint', key: `${cur.round}:${cur.cat}:${cur.row}`, text: J.hintPattern(clue.a) };
    conns.forEach((c) => { if (c.open && c.playerId === pid) c.send(msg); });
  }

  function decideBuzz() {
    const pb = pendingBuzz;
    pendingBuzz = null;
    const cur = state.current;
    if (!pb || !cur || !cur.buzz || !cur.buzz.open || cur.buzz.id !== pb.id) return; // inzwischen geschlossen
    const best = J.pickBuzzWinner([...pb.entries].map(([id, e]) => [id, e.ms, e.name]));
    if (!best) return;
    const reactions = Object.fromEntries([...pb.entries].map(([id, e]) => [id, e.ms]));
    const buzz = { open: false, winner: best.id, winnerName: best.name, id: pb.id, reactions };
    mutate(`⚡ ${whoBuzzed(buzz)} buzzert (${J.fmtMs(best.ms)})`, () => {
      cur.buzz = buzz;
      cur.timer = null;
      stat(best.id).buzzWins++;
      if (isTeam() && best.name) {
        const key = best.id + ':' + best.name;
        const ps = state.personStats || (state.personStats = {});
        const entry = ps[key] || (ps[key] = { name: best.name, team: nameOf(best.id), buzzWins: 0 });
        entry.buzzWins++;
      }
    });
    sound('buzz');
  }

  // Nach einer falschen Antwort öffnet der Buzzer erst nach einer zufälligen Pause (0,5–1,5 s),
  // damit niemand den Zeitpunkt im Rhythmus erraten kann. Die Pause erzeugt keinen Undo-Eintrag.
  function armBuzz() {
    const cur = state.current;
    const fixed = window.JEOP_BUZZ_DELAY_MS;
    const delay = fixed != null ? fixed : 500 + Math.random() * 1000;
    setTimeout(() => {
      if (state.current !== cur || !cur.buzz || !cur.buzz.arming) return;
      cur.buzz = openBuzz();
      commit();
      sound('buzzopen');
    }, delay);
  }

  // ---------- Timer ----------
  let lastTickSec = null;
  function startTimer() {
    const total = window.JEOP_TIMER_MS || J.TIMER_MS;
    state.current.timer = { endsAt: Date.now() + total, total };
    lastTickSec = null;
    commit(); // bewusst ohne Undo-Eintrag
  }
  function stopTimer() {
    state.current.timer = null;
    commit();
  }
  let musicFor = null; // Timer, für den gerade der Timer-Sound läuft
  setInterval(() => {
    const t = state.current && state.current.timer;
    if (!t) {
      J.renderTimer($('timerBox'), null);
      if (musicFor) { musicFor = null; J.stopTimerMusic(); }
      return;
    }
    const remaining = t.endsAt - Date.now();
    if (musicFor !== t.endsAt && remaining > 0) {
      musicFor = t.endsAt;
      if (J.soundOn()) J.startTimerMusic(remaining);
    }
    if (remaining <= 0) {
      state.current.timer = null;
      commit();
      sound('timeup');
      return;
    }
    J.renderTimer($('timerBox'), remaining, t.total);
    const sec = Math.ceil(remaining / 1000);
    if (sec <= 5 && sec !== lastTickSec && J.soundOn() && !J.timerMusicOn()) J.sfx('tick');
    lastTickSec = sec;
  }, 100);

  // Sounds lokal abspielen und an alle Spieler schicken
  function sound(name) {
    if (!J.soundOn()) return;
    J.sfx(name);
    const msg = { type: 'sfx', name };
    conns.forEach((c) => { if (c.open) c.send(msg); });
  }

  function renderClue() {
    const cur = state.current;
    $('clue').classList.toggle('show', !!cur);
    if (!cur) return;
    const cat = set.rounds[cur.round].categories[cur.cat];
    const clue = cat.clues[cur.row];
    const value = J.pointsFor(cur.round, cur.row);
    const penalty = J.penaltyFor(cur.round, cur.row);
    const judged = cur.judged || (cur.judged = {});
    const solved = Object.values(judged).includes('right');
    // Geklaut: Hat schon jemand falsch geantwortet, gibt es für die richtige Antwort nur die Hälfte
    const stolen = Object.values(judged).includes('wrong');
    const gain = stolen ? J.stealFor(cur.round, cur.row) : value;
    $('clueMeta').textContent = `${cat.name} – ${value}` + (cur.revealed ? ' · Antwort ist für Spieler sichtbar' : '');
    $('clueQ').textContent = clue.q;
    // Verpixelt: Host sieht dasselbe wie die Spieler (die Antwort steht ja darunter)
    const lvl = J.pixelLevel(clue, cur);
    const px = lvl == null ? null : pixelImg(clue, lvl);
    const img = lvl == null ? J.safeImg(clue.img) : px && px.src;
    $('clueImg').hidden = !img;
    $('clueImg').classList.toggle('pixel', lvl != null);
    if (img && $('clueImg').getAttribute('src') !== img) $('clueImg').src = img;
    $('pixelHint').textContent = px && px.error ? '⚠ ' + px.error : '';
    $('pixelHint').hidden = !(px && px.error);
    $('pixelBtn').hidden = lvl == null;
    if (lvl != null) {
      $('pixelBtn').textContent = lvl + 1 < J.PIXEL_STEPS.length
        ? `🔍 Schärfer (${lvl + 1}/${J.PIXEL_STEPS.length})` : '🖼 Ganzes Bild zeigen';
    }
    $('clueA').textContent = clue.a;
    $('clueNote').textContent = clue.note || '';
    $('clueNote').hidden = !clue.note;
    $('reveal').disabled = cur.revealed;

    // Buzzer- und Timer-Steuerung
    const buzz = cur.buzz || (cur.buzz = { open: false, winner: null });
    const jk = cur.jokers || {};
    const pass = jk.pass && !Object.keys(judged).length ? jk.pass : null;
    const status = $('buzzStatus');
    if (solved) {
      status.textContent = '';
    } else if (buzz.arming) {
      status.textContent = '🔔 Buzzer öffnet gleich …';
    } else if (buzz.open) {
      status.textContent = stolen
        ? `🔔 Buzzer offen – wer zuerst drückt, darf klauen (+${gain} bei richtig)`
        : '🔔 Buzzer offen – wer zuerst drückt, darf antworten';
    } else if (buzz.winner && !judged[buzz.winner]) {
      const rx = buzz.reactions || {};
      const others = Object.keys(rx).filter((id) => id !== buzz.winner)
        .sort((a, b) => rx[a] - rx[b]).map((id) => `${nameOf(id)} ${J.fmtMs(rx[id])}`);
      status.textContent = `⚡ ${whoBuzzed(buzz)} hat gebuzzert und ist dran` +
        (rx[buzz.winner] != null ? ` (${J.fmtMs(rx[buzz.winner])})` : '') +
        (others.length ? ` · danach: ${others.join(', ')}` : '');
    } else {
      status.textContent = '';
    }
    if (pass && !buzz.winner && !solved) status.textContent = `👉 ${pass.by || nameOf(pass.from)} gibt weiter: ${nameOf(pass.to)} muss antworten`;
    status.hidden = !status.textContent;
    const jparts = [];
    (jk.double || []).forEach((id) => jparts.push(`🎲 ${nameOf(id)}: Doppelt oder nichts`));
    (jk.hint || []).forEach((id) => jparts.push(`💡 ${nameOf(id)}: Tipp (${J.hintPattern(clue.a)})`));
    $('jokerStatus').textContent = jparts.join(' · ');
    $('jokerStatus').hidden = !jparts.length;
    $('buzzBtn').textContent = buzz.open ? 'Buzzer schließen' : 'Buzzer öffnen';
    $('buzzBtn').disabled = solved;
    $('timerBtn').textContent = cur.timer ? '⏱ Neu starten' : '⏱ 15 s Timer';
    $('timerStop').hidden = !cur.timer;
    if (cur.timer) J.renderTimer($('timerBox'), Math.max(0, cur.timer.endsAt - Date.now()), cur.timer.total);
    else J.renderTimer($('timerBox'), null);

    const judge = $('judge');
    judge.innerHTML = '';
    if (!state.players.length) {
      judge.innerHTML = `<span class="hint">Lege rechts ${isTeam() ? 'Teams' : 'Spieler'} an, um Punkte zu vergeben.</span>`;
    }
    state.players.forEach((p) => {
      const verdict = judged[p.id];
      const rowEl = document.createElement('div');
      const isWinner = (buzz.winner === p.id || (pass && pass.to === p.id && !buzz.winner)) && !verdict;
      const double = (jk.double || []).includes(p.id);
      const { gain, penalty } = J.judgePoints(cur.round, cur.row, { stolen, double });
      rowEl.className = 'jrow' + (verdict ? ' ' + verdict : '') + (isWinner ? ' buzzed' : '');
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = (isWinner ? (buzz.winner === p.id ? '⚡ ' : '👉 ') : '') + p.name + (isWinner && isTeam() && buzz.winnerName ? ` (${buzz.winnerName})` : '')
        + (double ? ' 🎲' : '') + ((jk.hint || []).includes(p.id) ? ' 💡' : '');
      // Pro Frage: nur ein Spieler kann richtig liegen, jeder Spieler wird höchstens einmal gewertet.
      // Korrekturen gehen über „Rückgängig“.
      if (verdict) {
        const tag = document.createElement('span');
        tag.className = 'verdict';
        tag.textContent = verdict === 'right' ? `✓ +${gain}` + (stolen ? ' (geklaut)' : '') : `✗ −${penalty}`;
        rowEl.append(name, tag);
        judge.appendChild(rowEl);
        return;
      }
      const ok = document.createElement('button');
      ok.className = 'green small';
      ok.textContent = `✓ +${gain}`;
      if (stolen) ok.title = 'Geklaut: halbe Punkte';
      ok.disabled = solved;
      ok.addEventListener('click', () => {
        mutate(`${p.name} richtig (+${gain}${stolen ? ', geklaut' : ''})`, () => {
          p.score += gain;
          state.current.judged[p.id] = 'right';
          stat(p.id).right++;
          if (stolen) stat(p.id).steals = (stat(p.id).steals || 0) + 1;
          state.current.buzz = closedBuzz();
          state.current.timer = null;
          state.current.revealed = true;
          state.used[cur.round][cur.cat][cur.row] = true;
        });
        sound('right');
      });
      const bad = document.createElement('button');
      bad.className = 'red small';
      bad.textContent = `✗ −${penalty}`;
      bad.disabled = solved;
      bad.addEventListener('click', () => {
        let opened = false;
        mutate(`${p.name} falsch (−${penalty})`, () => {
          p.score -= penalty;
          state.current.judged[p.id] = 'wrong';
          stat(p.id).wrong++;
          state.current.timer = null;
          // Klauen: Buzzer öffnet für alle, die noch nicht gewertet wurden
          opened = unjudged().length > 0;
          state.current.buzz = opened ? { open: false, winner: null, arming: true } : closedBuzz();
        });
        sound('wrong');
        if (opened) armBuzz();
      });
      rowEl.append(name, ok, bad);
      judge.appendChild(rowEl);
    });
  }

  function renderPlayers() {
    const box = $('players');
    box.innerHTML = '';
    state.players.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'prow';

      const name = document.createElement('span');
      name.className = 'pname';
      name.textContent = p.name;
      if (linkedPlayers().has(p.id)) {
        const dev = document.createElement('span');
        dev.className = 'device';
        dev.title = isTeam() ? 'Geräte verbunden – klicken zum Trennen' : 'Gerät verbunden – klicken zum Trennen';
        dev.addEventListener('click', (e) => {
          e.stopPropagation();
          const q = isTeam()
            ? `Alle Geräte von ${p.name} trennen? Sie müssen ihr Team neu wählen.`
            : `Gerät von ${p.name} trennen? Der Name wird wieder frei.`;
          if (confirm(q)) releasePlayer(p.id);
        });
        name.prepend(dev);
      }
      name.addEventListener('click', () => {
        const n = prompt('Neuer Name', p.name);
        if (n && n.trim() && n.trim() !== p.name) {
          mutate(`${p.name} umbenannt in ${n.trim()}`, () => { p.name = n.trim(); });
        }
      });

      const score = document.createElement('input');
      score.type = 'number';
      score.className = 'pscore';
      score.value = p.score;
      score.addEventListener('change', () => {
        const v = parseInt(score.value, 10);
        if (Number.isNaN(v) || v === p.score) { score.value = p.score; return; }
        mutate(`${p.name}: ${p.score} → ${v} (manuell)`, () => { p.score = v; });
      });

      const btns = document.createElement('span');
      btns.className = 'pbtns';
      const plus = document.createElement('button');
      plus.className = 'small green';
      plus.textContent = '+100';
      plus.addEventListener('click', () => mutate(`${p.name} +100 (manuell)`, () => { p.score += 100; }));
      const minus = document.createElement('button');
      minus.className = 'small red';
      minus.textContent = '−100';
      minus.addEventListener('click', () => mutate(`${p.name} −100 (manuell)`, () => { p.score -= 100; }));
      const del = document.createElement('button');
      del.className = 'small ghost';
      del.textContent = '✕';
      del.title = isTeam() ? 'Team entfernen' : 'Spieler entfernen';
      del.addEventListener('click', () => {
        if (confirm(`${p.name} entfernen?`)) {
          mutate(`${p.name} entfernt`, () => {
            state.turn = J.turnAfterRemoval(ids(), state.turn, p.id);
            state.players = state.players.filter((x) => x.id !== p.id);
          });
        }
      });
      const turnBtn = document.createElement('button');
      const hasTurn = state.turn === p.id;
      turnBtn.className = 'small turn-btn' + (hasTurn ? ' on' : '');
      turnBtn.textContent = '🎯';
      turnBtn.title = hasTurn ? 'Ist am Zug (klicken zum Aufheben)' : 'Ist am Zug setzen';
      turnBtn.addEventListener('click', () =>
        mutate(hasTurn ? 'Niemand am Zug' : `${p.name} ist am Zug`, () => { state.turn = hasTurn ? null : p.id; })
      );
      btns.append(turnBtn, plus, minus, del);
      row.append(name, score, btns);
      if (isTeam()) {
        const names = teamMembers().get(p.id) || [];
        const mem = document.createElement('div');
        mem.className = 'pmembers';
        mem.style.setProperty('--team', J.teamColor(state.players.indexOf(p)));
        mem.textContent = (names.length ? '📱 ' + names.join(', ') : 'Noch niemand beigetreten') + ` · ${names.length}/${state.teamSize}`;
        row.appendChild(mem);
      }
      box.appendChild(row);
    });
  }

  function renderLog() {
    const items = state.history.slice(-15).reverse();
    $('log').innerHTML = items.length
      ? items.map((h) => `<div>${J.escapeHtml(h.label)}</div>`).join('')
      : '<div>Noch keine Aktionen</div>';
  }

  // ---------- Buttons ----------
  $('reveal').addEventListener('click', () => {
    mutate('Antwort aufgedeckt', () => { state.current.revealed = true; });
    sound('reveal');
  });
  function renderSoundToggle() {
    $('soundToggle').textContent = J.soundOn() ? '🔊 Sounds an' : '🔇 Sounds aus';
  }
  $('soundToggle').addEventListener('click', () => {
    J.setSoundOn(!J.soundOn());
    renderSoundToggle();
    if (J.soundOn()) J.sfx('right');
  });
  renderSoundToggle();
  $('close').addEventListener('click', () => {
    const cur = state.current;
    mutate('Frage geschlossen', () => {
      state.used[cur.round][cur.cat][cur.row] = true;
      state.current = null;
      state.turn = J.nextTurn(ids(), state.turn);
    });
  });
  $('cancel').addEventListener('click', () =>
    mutate('Frage abgebrochen', () => { state.current = null; })
  );
  $('buzzBtn').addEventListener('click', () => {
    const open = !state.current.buzz.open;
    mutate(open ? 'Buzzer geöffnet' : 'Buzzer geschlossen', () => {
      state.current.buzz = open ? openBuzz() : closedBuzz();
    });
    if (open) sound('buzzopen');
  });
  $('timerBtn').addEventListener('click', startTimer);
  $('pixelBtn').addEventListener('click', () => {
    state.current.pixel = (state.current.pixel || 0) + 1;
    commit(); // wie der Timer ohne Undo-Eintrag
  });

  // ---------- Verpixelte Bilder ----------
  // Mini-Bilder je Stufe einmal berechnen; bis sie fertig sind, bekommen Spieler kein Bild
  const pixelCache = new Map();
  function pixelImg(clue, lvl) {
    const src = J.safeImg(clue.img);
    const blocks = J.PIXEL_STEPS[lvl];
    const key = blocks + '|' + src.length + '|' + src.slice(0, 64) + src.slice(-64);
    if (!pixelCache.has(key)) {
      pixelCache.set(key, { src: null });
      J.pixelate(src, blocks)
        .then((u) => pixelCache.set(key, { src: u }))
        .catch((e) => pixelCache.set(key, { src: null, error: e.message }))
        .then(() => { renderClue(); broadcast(); });
    }
    return pixelCache.get(key);
  }

  // ---------- Einzel- / Team-Modus ----------
  function renderModeUI() {
    $('modeSingle').className = isTeam() ? '' : 'primary';
    $('modeTeam').className = isTeam() ? 'primary' : '';
    $('teamSizeRow').hidden = !isTeam();
    if (document.activeElement !== $('teamSize')) $('teamSize').value = state.teamSize;
    $('newName').placeholder = isTeam() ? 'Team hinzufügen' : 'Spieler hinzufügen';
    $('playersHint').textContent = isTeam()
      ? 'Spieler wählen am Handy ihr Team und geben ihren Namen ein. Punkte zählen nur fürs Team.'
      : 'Punkte direkt eintippen oder mit ± anpassen. Namen anklicken zum Umbenennen.';
  }
  function setMode(mode) {
    if (state.mode === mode) return;
    if (state.players.length && !confirm('Moduswechsel entfernt alle Spieler/Teams und setzt die Punkte zurück. (Rückgängig möglich)')) return;
    conns.forEach((c) => {
      if (c.playerId) { c.playerId = null; c.memberName = null; if (c.open) c.send({ type: 'released' }); }
    });
    mutate(mode === 'team' ? 'Team-Modus' : 'Einzelspieler-Modus', () => {
      state.mode = mode;
      state.players = [];
      state.turn = null;
      state.current = null;
      state.stats = {};
      state.personStats = {};
    });
  }
  $('modeSingle').addEventListener('click', () => setMode('single'));
  $('modeTeam').addEventListener('click', () => setMode('team'));
  $('teamSize').addEventListener('change', () => {
    state.teamSize = J.clampTeamSize($('teamSize').value);
    $('teamSize').value = state.teamSize;
    commit(); // betrifft nur neue Beitritte, niemand fliegt raus
  });

  // ---------- Siegerehrung ----------
  let shownFinished = false;
  function renderFinish() {
    const el = $('finish');
    el.classList.toggle('show', !!state.finished);
    if (state.finished) {
      J.renderPodium($('podium'), state.players, set.title, state.stats, isTeam() ? state.personStats : null);
      if (!shownFinished) J.confetti(el);
    }
    shownFinished = !!state.finished;
  }
  $('finishBtn').addEventListener('click', () => {
    if (!state.players.length) { alert(isTeam() ? 'Es gibt noch keine Teams.' : 'Es gibt noch keine Spieler.'); return; }
    mutate('🏆 Siegerehrung', () => { state.finished = true; state.current = null; });
    sound('fanfare');
  });
  $('finishBack').addEventListener('click', () =>
    mutate('Zurück zum Spiel', () => { state.finished = false; })
  );
  $('timerStop').addEventListener('click', stopTimer);
  function switchRound(r) {
    if (state.round === r) return;
    stopIntro(false);
    mutate('Runde ' + (r + 1), () => { state.round = r; state.current = null; });
    startIntro();
  }
  $('r0').addEventListener('click', () => switchRound(0));
  $('r1').addEventListener('click', () => switchRound(1));

  // ---------- Runden-Intro ----------
  // Läuft ohne Undo-Eintrag; der Host taktet die Schritte, die Spieler zeigen nur an.
  const INTRO_TITLE_MS = window.JEOP_INTRO_MS || 2600;
  const INTRO_CAT_MS = window.JEOP_INTRO_MS || 1900;
  let introTimer = null;
  let dealTimer = null;
  function startIntro() {
    if (state.current) return;
    clearTimeout(introTimer);
    state.intro = { round: state.round, step: 0 };
    commit();
    sound('intro');
    introTimer = setTimeout(nextIntroStep, INTRO_TITLE_MS);
  }
  function nextIntroStep() {
    if (!state.intro) return;
    const step = state.intro.step + 1;
    if (step > J.CATS) { stopIntro(true); return; }
    state.intro.step = step;
    commit();
    sound('catreveal');
    introTimer = setTimeout(nextIntroStep, INTRO_CAT_MS);
  }
  function stopIntro(deal) {
    clearTimeout(introTimer);
    if (!state.intro) return;
    state.intro = null;
    // Punktefelder „austeilen“
    $('board').classList.toggle('deal', !!deal);
    clearTimeout(dealTimer);
    dealTimer = setTimeout(() => $('board').classList.remove('deal'), 2000);
    commit();
  }
  $('introBtn').addEventListener('click', startIntro);
  $('introSkip').addEventListener('click', () => stopIntro(true));
  $('undo').addEventListener('click', undo);
  $('addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('newName').value.trim();
    if (!name) return;
    mutate(`${name} hinzugefügt`, () => {
      state.players.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, score: 0 });
      if (!state.turn) state.turn = state.players[0].id; // Der Erste in der Liste beginnt
    });
    $('newName').value = '';
  });
  $('resetGame').addEventListener('click', () => {
    if (!confirm('Alle Felder freigeben und Punkte auf 0 setzen? (Rückgängig möglich)')) return;
    mutate('Spielstand zurückgesetzt', () => {
      state.used = J.defaultState().used;
      state.players.forEach((p) => { p.score = 0; p.usedJokers = []; });
      state.current = null;
      state.round = 0;
      state.turn = state.players.length ? state.players[0].id : null;
      state.finished = false;
      state.stats = {};
      state.personStats = {};
    });
  });
  $('newCode').addEventListener('click', () => {
    if (!confirm('Neuen Raumcode erzeugen? Spieler müssen den neuen Link öffnen.')) return;
    J.newRoomCode();
    location.reload();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      undo();
    }
  });

  // Editor in anderem Tab → Fragen live übernehmen
  window.addEventListener('storage', (e) => {
    if (e.key === J.SET_KEY) {
      set = J.loadSet();
      render();
      broadcast();
    }
  });

  // ---------- Farbschema ----------
  function renderThemes() {
    const box = $('themes');
    const current = J.getTheme();
    box.innerHTML = '';
    J.THEMES.forEach((t) => {
      const b = document.createElement('button');
      b.className = 'theme-btn' + (t.id === current ? ' on' : '');
      b.dataset.id = t.id;
      b.innerHTML = `<span class="sw" style="background:linear-gradient(135deg, ${t.sw[0]} 55%, ${t.sw[1]} 55%)"></span>${t.name}`;
      b.addEventListener('click', () => {
        J.setTheme(t.id);
        renderThemes();
        broadcast();
      });
      box.appendChild(b);
    });
  }
  renderThemes();

  // ---------- Netzwerk (PeerJS oder Relay, siehe net.js) ----------
  const code = J.roomCode();
  // Verbindungshilfe: TURN-Zugang wandert im #-Teil des Links mit (wird nicht an Server übertragen)
  const turn = J.loadTurn();
  const joinUrl = new URL('player.html?room=' + code, location.href).href + (turn ? '#t=' + J.encodeTurn(turn) : '');
  const peerOptions = () => ({ config: J.iceConfig(turn, window.JEOP_FORCE_RELAY) });
  $('code').textContent = code;
  $('link').textContent = joinUrl;
  $('copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      $('copy').textContent = 'Kopiert ✓';
    } catch (e) {
      prompt('Link kopieren:', joinUrl);
    }
    setTimeout(() => ($('copy').textContent = 'Link kopieren'), 1500);
  });

  const conns = new Set();
  let peer;

  function setStatus(text, ok) {
    const el = $('peerStatus');
    el.textContent = text;
    el.className = 'status-inline ' + (ok ? 'ok' : 'bad');
  }

  function updateViewers() {
    $('viewers').textContent = `${conns.size} verbunden`;
    renderPlayers();
  }

  // Team-Modus: Namen der verbundenen Mitglieder je Team
  function teamMembers() {
    const m = new Map();
    conns.forEach((c) => {
      if (c.open && c.playerId) {
        if (!m.has(c.playerId)) m.set(c.playerId, []);
        m.get(c.playerId).push(c.memberName || 'Spieler');
      }
    });
    return m;
  }

  // Welche Spieler haben ein Gerät verbunden?
  function linkedPlayers() {
    const ids = new Set();
    conns.forEach((c) => { if (c.open && c.playerId) ids.add(c.playerId); });
    return ids;
  }

  function onData(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'hello') {
      const pid = typeof msg.playerId === 'string' ? msg.playerId : null;
      conn.deviceId = typeof msg.deviceId === 'string' ? msg.deviceId : null;
      let ok = state.players.some((p) => p.id === pid) ? pid : null;
      conn.memberName = null;
      if (ok && isTeam()) {
        // Team-Modus: mehrere Geräte pro Team bis zur Teamgröße
        for (const c of conns) {
          if (c !== conn && c.open && conn.deviceId && c.deviceId === conn.deviceId && c.playerId) {
            c.playerId = null; // dasselbe Gerät hat sich neu verbunden
            c.close();
          }
        }
        const members = [...conns].filter((c) => c !== conn && c.open && c.playerId === ok).length;
        if (J.teamIsFull(members, state.teamSize)) {
          ok = null;
          conn.send({ type: 'taken', playerId: pid, reason: 'full' });
        } else {
          conn.memberName = J.cleanName(msg.name) || 'Spieler';
        }
      } else if (ok) {
        // Jeder Name darf nur von einem Gerät belegt sein. Dasselbe Gerät (z. B. nach
        // Verbindungsabbruch) darf übernehmen, ein fremdes nicht.
        for (const c of conns) {
          if (c === conn || !c.open || c.playerId !== ok) continue;
          if (conn.deviceId && c.deviceId === conn.deviceId) {
            c.playerId = null;
            c.close();
          } else {
            ok = null;
            conn.send({ type: 'taken', playerId: pid });
          }
        }
      }
      conn.playerId = ok;
      renderPlayers();
      broadcast(); // Belegung an alle schicken
      if (ok) sendHint(ok); // nach Verbindungsabbruch den Tipp erneut schicken
    } else if (msg.type === 'buzz') {
      handleBuzz(conn, msg);
    } else if (msg.type === 'joker') {
      handleJoker(conn, msg);
    } else if (msg.type === 'react') {
      handleReaction(conn, msg);
    }
  }

  // Live-Reaktionen: prüfen, drosseln (max. ~3 pro Sekunde und Gerät) und an alle verteilen
  function handleReaction(conn, msg) {
    if (!J.REACTIONS.includes(msg.emoji)) return;
    const now = Date.now();
    conn.reactTimes = (conn.reactTimes || []).filter((t) => now - t < 1000);
    if (conn.reactTimes.length >= 3) return;
    conn.reactTimes.push(now);
    const name = conn.playerId
      ? (isTeam() && conn.memberName ? `${conn.memberName} (${nameOf(conn.playerId)})` : nameOf(conn.playerId))
      : '👀';
    const out = { type: 'react', emoji: msg.emoji, name };
    conns.forEach((c) => { if (c.open) c.send(out); });
    J.showReaction(msg.emoji, name);
  }

  function message() {
    const data = J.publicState(set, state);
    if (data.current && data.current.pixel) {
      const cur = state.current;
      const px = pixelImg(set.rounds[cur.round].categories[cur.cat].clues[cur.row], data.current.pixel.step);
      data.current.img = px.src;
    }
    if (isTeam()) {
      const m = teamMembers();
      data.members = Object.fromEntries([...m]);
      data.full = state.players.filter((p) => J.teamIsFull((m.get(p.id) || []).length, state.teamSize)).map((p) => p.id);
      data.taken = [];
    } else {
      data.taken = [...linkedPlayers()];
    }
    return { type: 'state', data };
  }

  // Host gibt einen Namen frei (z. B. wenn sich jemand verwählt hat)
  function releasePlayer(pid) {
    conns.forEach((c) => {
      if (c.playerId === pid) {
        c.playerId = null;
        c.memberName = null;
        if (c.open) c.send({ type: 'released' });
      }
    });
    renderPlayers();
    broadcast();
  }

  function broadcast() {
    const msg = message();
    conns.forEach((c) => { if (c.open) c.send(msg); });
  }

  function startPeer() {
    if (!J.net.available()) {
      setStatus('PeerJS nicht geladen (offline?)', false);
      return;
    }
    peer = J.net.createPeer(J.peerId(code), peerOptions());
    peer.on('open', () => setStatus('online', true));
    peer.on('connection', (conn) => {
      // Selbsttest-Verbindung: nur bestätigen, nicht als Spieler zählen
      if (conn.metadata && conn.metadata.probe) {
        conn.on('open', () => setTimeout(() => conn.close(), 500));
        return;
      }
      conn.on('open', () => {
        conns.add(conn);
        updateViewers();
        conn.send(message());
      });
      conn.on('data', (msg) => onData(conn, msg));
      const gone = () => {
        if (!conns.delete(conn)) return;
        updateViewers();
        if (conn.playerId) broadcast(); // Name wird wieder frei
      };
      conn.on('close', gone);
      conn.on('error', gone);
    });
    peer.on('disconnected', () => {
      setStatus('Verbindung zum Server verloren – neuer Versuch…', false);
      setTimeout(() => { if (!peer.destroyed && peer.disconnected) { try { peer.reconnect(); } catch (e) {} } }, 2000);
    });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // Alte Sitzung (z. B. nach Reload) hält die ID noch kurz fest.
        setStatus('Raumcode noch belegt – neuer Versuch…', false);
        peer.destroy();
        setTimeout(startPeer, 4000);
      } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
        setStatus('Netzwerkfehler – neuer Versuch…', false);
        setTimeout(selfCheck, 3000);
      } else {
        console.warn('Peer-Fehler', err);
      }
    });
  }

  // ---------- Selbsttest ----------
  // Handy-Browser frieren Hintergrund-Tabs ein. Dabei kann die Verbindung zum Vermittlungsserver
  // still abreißen, während die Seite weiter „online“ zeigt – neue Spieler finden den Raum dann
  // nicht mehr. Deshalb prüft der Host regelmäßig, ob er unter seinem Raumcode erreichbar ist,
  // und meldet sich sonst neu an (bestehende Spielerverbindungen bleiben dabei bestehen).
  let probeBusy = false;
  function reRegister() {
    if (!peer || peer.destroyed) return startPeer();
    setStatus('Verbindung wird erneuert…', false);
    try { if (!peer.disconnected) peer.disconnect(); } catch (e) {}
    setTimeout(() => { try { if (!peer.destroyed) peer.reconnect(); } catch (e) {} }, 500);
  }
  function selfCheck() {
    // Das Relay erkennt Abbrüche selbst (jede Abfrage geht zum Server), der Selbsttest gilt nur für WebRTC.
    if (J.net.mode !== 'peer' || !peer || peer.destroyed || probeBusy || typeof Peer === 'undefined') return;
    if (peer.disconnected) { reRegister(); return; }
    probeBusy = true;
    let done = false;
    const probe = new Peer(peerOptions());
    const finish = (reachable) => {
      if (done) return;
      done = true;
      probeBusy = false;
      try { probe.destroy(); } catch (e) {}
      if (!reachable) reRegister();
    };
    probe.on('open', () => {
      const c = probe.connect(J.peerId(code), { metadata: { probe: true } });
      c.on('open', () => finish(true));
    });
    probe.on('error', (err) => finish(err.type !== 'peer-unavailable'));
    setTimeout(() => finish(true), 15000); // keine Antwort: lieber nichts tun
  }
  setInterval(selfCheck, window.JEOP_SELFCHECK_MS || 20000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { setTimeout(selfCheck, 500); keepAwake(); }
  });
  window.addEventListener('online', () => setTimeout(selfCheck, 1000));

  // Bildschirm am Handy wach halten, solange das Host-Pult offen ist
  let wakeLock = null;
  async function keepAwake() {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) {}
  }
  keepAwake();
  document.addEventListener('click', keepAwake, { once: true });

  // ---------- Verbindungshilfe (TURN) ----------
  function renderTurnBox() {
    $('turnState').textContent = turn
      ? `✓ aktiv (${turn.urls.length} Adresse${turn.urls.length > 1 ? 'n' : ''}) – im Beitrittslink enthalten`
      : 'nicht eingerichtet';
    $('turnState').className = 'turn-state ' + (turn ? 'on' : '');
    if (turn) {
      $('turnUrls').value = turn.urls.join('\n');
      $('turnUser').value = turn.username;
      $('turnPass').value = turn.credential;
    }
  }
  $('turnSave').addEventListener('click', () => {
    const t = J.parseTurn({ urls: $('turnUrls').value, username: $('turnUser').value, credential: $('turnPass').value });
    if (!t) { alert('Bitte mindestens eine Adresse eintragen, die mit turn: oder turns: beginnt.'); return; }
    J.saveTurn(t);
    location.reload(); // Verbindung mit neuem Zugang neu aufbauen
  });
  $('turnClear').addEventListener('click', () => {
    if (!confirm('Verbindungshilfe entfernen?')) return;
    J.saveTurn(null);
    location.reload();
  });
  renderTurnBox();
  // Übers Relay (Vercel) wird keine Verbindungshilfe gebraucht
  J.net.ready.then((m) => { $('turnBox').hidden = m === 'relay'; });

  window.addEventListener('beforeunload', () => { if (peer) peer.destroy(); });

  render();
  J.net.ready.then(startPeer);
})();
