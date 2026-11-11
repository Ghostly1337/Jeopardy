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
      current: state.current ? { ...state.current } : null,
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
    state.round = snap.round;
    state.used = snap.used;
    state.players = snap.players;
    state.current = snap.current;
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
    $('r0').className = state.round === 0 ? 'gold' : '';
    $('r1').className = state.round === 1 ? 'gold' : '';
    $('undo').disabled = state.history.length === 0;
  }

  function renderBoard() {
    const r = state.round;
    const cats = set.rounds[r].categories;
    const board = $('board');
    board.innerHTML = '';
    cats.forEach((c) => {
      const el = document.createElement('div');
      el.className = 'cell cat';
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
        el.addEventListener('click', () => onCell(c, row));
        board.appendChild(el);
      }
    }
  }

  function onCell(cat, row) {
    const r = state.round;
    if (state.used[r][cat][row]) {
      if (confirm('Dieses Feld wieder freigeben?')) {
        mutate(`Feld ${J.pointsFor(r, row)} „${set.rounds[r].categories[cat].name}“ freigegeben`, () => {
          state.used[r][cat][row] = false;
        });
      }
      return;
    }
    mutate(`Frage ${J.pointsFor(r, row)} „${set.rounds[r].categories[cat].name}“ geöffnet`, () => {
      state.current = { round: r, cat, row, revealed: false };
    });
  }

  function renderClue() {
    const cur = state.current;
    $('clue').classList.toggle('show', !!cur);
    if (!cur) return;
    const cat = set.rounds[cur.round].categories[cur.cat];
    const clue = cat.clues[cur.row];
    const value = J.pointsFor(cur.round, cur.row);
    $('clueMeta').textContent = `${cat.name} – ${value}` + (cur.revealed ? ' · Antwort ist für Spieler sichtbar' : '');
    $('clueQ').textContent = clue.q;
    $('clueA').textContent = clue.a;
    $('reveal').disabled = cur.revealed;

    const judge = $('judge');
    judge.innerHTML = '';
    if (!state.players.length) {
      judge.innerHTML = '<span class="hint">Lege rechts Spieler an, um Punkte zu vergeben.</span>';
    }
    state.players.forEach((p) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'jrow';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = p.name;
      const ok = document.createElement('button');
      ok.className = 'green small';
      ok.textContent = `✓ +${value}`;
      ok.addEventListener('click', () =>
        mutate(`${p.name} richtig (+${value})`, () => {
          p.score += value;
          state.current.revealed = true;
          state.used[cur.round][cur.cat][cur.row] = true;
        })
      );
      const bad = document.createElement('button');
      bad.className = 'red small';
      bad.textContent = `✗ −${value}`;
      bad.addEventListener('click', () =>
        mutate(`${p.name} falsch (−${value})`, () => { p.score -= value; })
      );
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
      name.style.cursor = 'pointer';
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
      del.title = 'Spieler entfernen';
      del.addEventListener('click', () => {
        if (confirm(`${p.name} entfernen?`)) {
          mutate(`${p.name} entfernt`, () => {
            state.players = state.players.filter((x) => x.id !== p.id);
          });
        }
      });
      btns.append(plus, minus, del);
      row.append(name, score, btns);
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
  $('reveal').addEventListener('click', () =>
    mutate('Antwort aufgedeckt', () => { state.current.revealed = true; })
  );
  $('close').addEventListener('click', () => {
    const cur = state.current;
    mutate('Frage geschlossen', () => {
      state.used[cur.round][cur.cat][cur.row] = true;
      state.current = null;
    });
  });
  $('cancel').addEventListener('click', () =>
    mutate('Frage abgebrochen', () => { state.current = null; })
  );
  $('r0').addEventListener('click', () => state.round !== 0 && mutate('Runde 1', () => { state.round = 0; state.current = null; }));
  $('r1').addEventListener('click', () => state.round !== 1 && mutate('Runde 2', () => { state.round = 1; state.current = null; }));
  $('undo').addEventListener('click', undo);
  $('addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('newName').value.trim();
    if (!name) return;
    mutate(`${name} hinzugefügt`, () => {
      state.players.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, score: 0 });
    });
    $('newName').value = '';
  });
  $('resetGame').addEventListener('click', () => {
    if (!confirm('Alle Felder freigeben und Punkte auf 0 setzen? (Rückgängig möglich)')) return;
    mutate('Spielstand zurückgesetzt', () => {
      state.used = J.defaultState().used;
      state.players.forEach((p) => (p.score = 0));
      state.current = null;
      state.round = 0;
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

  // ---------- Netzwerk (PeerJS) ----------
  const code = J.roomCode();
  const joinUrl = new URL('player.html?room=' + code, location.href).href;
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
    el.style.color = ok ? '#3ddc84' : '#ff7b7b';
  }

  function updateViewers() {
    $('viewers').textContent = `${conns.size} Zuschauer`;
  }

  function message() {
    return { type: 'state', data: J.publicState(set, state) };
  }

  function broadcast() {
    const msg = message();
    conns.forEach((c) => { if (c.open) c.send(msg); });
  }

  function startPeer() {
    if (typeof Peer === 'undefined') {
      setStatus('PeerJS nicht geladen (offline?)', false);
      return;
    }
    peer = new Peer(J.peerId(code));
    peer.on('open', () => setStatus('online', true));
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        conns.add(conn);
        updateViewers();
        conn.send(message());
      });
      conn.on('close', () => { conns.delete(conn); updateViewers(); });
      conn.on('error', () => { conns.delete(conn); updateViewers(); });
    });
    peer.on('disconnected', () => {
      setStatus('Verbindung zum Server verloren – neuer Versuch…', false);
      setTimeout(() => { if (!peer.destroyed) peer.reconnect(); }, 2000);
    });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // Alte Sitzung (z. B. nach Reload) hält die ID noch kurz fest.
        setStatus('Raumcode noch belegt – neuer Versuch…', false);
        peer.destroy();
        setTimeout(startPeer, 4000);
      } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
        setStatus('Netzwerkfehler – neuer Versuch…', false);
      } else {
        console.warn('Peer-Fehler', err);
      }
    });
  }

  window.addEventListener('beforeunload', () => { if (peer) peer.destroy(); });

  render();
  startPeer();
})();
