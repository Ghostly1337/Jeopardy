(function () {
  const $ = (id) => document.getElementById(id);
  const room = (new URLSearchParams(location.search).get('room') || '').trim().toUpperCase();

  if (!room) {
    location.href = 'index.html';
    return;
  }
  document.title = `Jeopardy – Raum ${room}`;

  function setStatus(text, ok) {
    $('status').textContent = text;
    $('status').className = 'status ' + (ok ? 'ok' : 'bad');
  }

  function render(s) {
    J.applyTheme(s.theme);
    $('waiting').hidden = true;
    const board = $('board');
    board.hidden = false;
    document.title = `${s.title} – Runde ${s.round + 1}`;

    let html = s.categories.map((c) => `<div class="cell cat">${J.escapeHtml(c)}</div>`).join('');
    for (let row = 0; row < s.values.length; row++) {
      for (let c = 0; c < s.categories.length; c++) {
        const used = s.used[c][row];
        const active = s.current && s.current.cat === c && s.current.row === row;
        html += `<div class="cell val${used ? ' used' : ''}${active ? ' active' : ''}">${s.values[row]}</div>`;
      }
    }
    board.innerHTML = html;
    J.renderScores($('scores'), s.players);

    const cur = s.current;
    $('overlay').classList.toggle('show', !!cur);
    if (cur) {
      $('meta').textContent = `${cur.category} – ${cur.value}`;
      $('q').textContent = cur.q;
      $('a').textContent = cur.a || '';
      J.renderScores($('overlayScores'), s.players);
    }

    last = s;
    renderMe();
    renderBuzz();
    syncTimer(cur && cur.timer);
  }

  // ---------- Wer bin ich? ----------
  const ME_KEY = 'jeopardy.me.' + room;
  let me = null; // Spieler-ID, 'watch' oder null (noch nicht gewählt)
  try { me = localStorage.getItem(ME_KEY); } catch (e) {}
  let last = null;

  const myPlayer = () => (last && last.players.find((p) => p.id === me)) || null;

  function choose(id) {
    me = id;
    try { localStorage.setItem(ME_KEY, id); } catch (e) {}
    $('picker').hidden = true;
    sendHello();
    if (last) render(last);
  }

  function renderMe() {
    if (!last) return;
    const valid = me === 'watch' || myPlayer();
    // Noch nicht gewählt oder Spieler wurde gelöscht → Auswahl zeigen, Board bleibt verdeckt.
    // Ohne Spieler gibt es nur „Nur zuschauen“; die Liste füllt sich live, sobald der Host Spieler anlegt.
    if (!valid) {
      const list = $('pickerList');
      list.innerHTML = '';
      $('pickerEmpty').hidden = last.players.length > 0;
      last.players.forEach((p) => {
        const b = document.createElement('button');
        b.className = 'pick';
        b.textContent = p.name;
        b.addEventListener('click', () => choose(p.id));
        list.appendChild(b);
      });
      $('picker').hidden = false;
    } else {
      $('picker').hidden = true;
    }
    const btn = $('me');
    btn.hidden = !valid;
    btn.textContent = me === 'watch' ? '👀 Zuschauer' : myPlayer() ? 'Du: ' + myPlayer().name : '';
  }

  $('me').addEventListener('click', () => {
    me = null;
    try { localStorage.removeItem(ME_KEY); } catch (e) {}
    sendHello();
    renderMe();
  });
  $('watchOnly').addEventListener('click', () => choose('watch'));

  function sendHello() {
    if (conn && conn.open) conn.send({ type: 'hello', playerId: me && me !== 'watch' ? me : null });
  }

  // ---------- Buzzer ----------
  let pressed = false; // lokal gesperrt nach dem Drücken, bis der Host antwortet

  function renderBuzz() {
    const cur = last && last.current;
    const buzzer = $('buzzer');
    const info = $('buzzInfo');
    if (!cur) { buzzer.hidden = true; info.hidden = true; return; }
    const buzz = cur.buzz || {};
    const judged = cur.judged || {};
    const isPlayer = !!myPlayer();
    if (!buzz.open) pressed = false;

    const canBuzz = buzz.open && isPlayer && !judged[me];
    buzzer.hidden = !canBuzz;
    buzzer.disabled = pressed;
    buzzer.textContent = pressed ? '…' : 'BUZZ';

    let text = '';
    const solved = Object.values(judged).includes('right');
    if (buzz.winner && !judged[buzz.winner] && !solved) {
      const w = last.players.find((p) => p.id === buzz.winner);
      text = buzz.winner === me ? 'Du bist dran!' : `⚡ ${w ? w.name : '?'} ist dran`;
    } else if (buzz.open && isPlayer && judged[me]) {
      text = 'Du hast schon geantwortet';
    } else if (buzz.open && !isPlayer) {
      text = '🔔 Buzzer offen';
    }
    info.textContent = text;
    info.hidden = !text;
    info.classList.toggle('mine', buzz.winner === me);
  }

  function pressBuzz() {
    const b = $('buzzer');
    if (b.hidden || b.disabled || !conn || !conn.open) return;
    pressed = true;
    conn.send({ type: 'buzz' });
    renderBuzz();
  }
  $('buzzer').addEventListener('click', pressBuzz);
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); pressBuzz(); }
  });

  // ---------- Timer ----------
  let timerEnd = null;
  let timerTotal = 0;
  let lastTick = null;
  function syncTimer(t) {
    if (!t) { timerEnd = null; J.renderTimer($('timerBox'), null); return; }
    timerEnd = Date.now() + t.remaining;
    timerTotal = t.total;
  }
  setInterval(() => {
    if (timerEnd == null) return;
    const remaining = Math.max(0, timerEnd - Date.now());
    J.renderTimer($('timerBox'), remaining, timerTotal);
    const sec = Math.ceil(remaining / 1000);
    if (sec > 0 && sec <= 5 && sec !== lastTick && J.soundOn()) J.sfx('tick');
    lastTick = sec;
  }, 100);

  // ---------- Verbindung ----------
  let peer;
  let conn;
  let retryTimer;

  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, 3000);
  }

  function connect() {
    if (conn && conn.open) return;
    if (!peer || peer.destroyed) return startPeer();
    if (peer.disconnected) {
      peer.reconnect();
      return scheduleRetry();
    }
    if (conn) conn.close();
    setStatus('verbinde…', false);
    conn = peer.connect(J.peerId(room), { reliable: true });
    const thisConn = conn;
    conn.on('open', () => {
      setStatus(`Raum ${room}`, true);
      sendHello();
    });
    conn.on('data', (msg) => {
      if (!msg) return;
      if (msg.type === 'state') render(msg.data);
      else if (msg.type === 'sfx' && J.soundOn()) J.sfx(msg.name);
    });
    conn.on('close', () => {
      if (thisConn !== conn) return;
      setStatus('Verbindung verloren – neuer Versuch…', false);
      scheduleRetry();
    });
    conn.on('error', () => {
      if (thisConn !== conn) return;
      scheduleRetry();
    });
  }

  function startPeer() {
    if (typeof Peer === 'undefined') {
      setStatus('PeerJS nicht geladen (offline?)', false);
      $('waiting').textContent = 'Keine Verbindung möglich. Internet prüfen und neu laden.';
      return;
    }
    peer = new Peer();
    peer.on('open', connect);
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') {
        setStatus('Host nicht erreichbar – neuer Versuch…', false);
        $('waiting').textContent = `Warte auf den Host von Raum ${room}…`;
      } else {
        setStatus('Fehler: ' + err.type + ' – neuer Versuch…', false);
      }
      scheduleRetry();
    });
    peer.on('disconnected', scheduleRetry);
  }

  // ---------- Ton ----------
  // Browser spielen Ton erst nach einer Nutzeraktion ab. Bis dahin zeigt der Button „Ton aktivieren“.
  const soundBtn = $('sound');
  function renderSound() {
    if (!J.audioUnlocked()) {
      soundBtn.textContent = '🔇 Ton aktivieren';
      soundBtn.classList.add('attention');
    } else {
      soundBtn.textContent = J.soundOn() ? '🔊' : '🔇';
      soundBtn.classList.remove('attention');
    }
  }
  soundBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!J.audioUnlocked()) {
      J.setSoundOn(true);
      J.unlockAudio();
    } else {
      J.setSoundOn(!J.soundOn());
    }
    setTimeout(renderSound, 50);
  });
  document.addEventListener('pointerdown', () => {
    if (!J.audioUnlocked()) { J.unlockAudio(); setTimeout(renderSound, 50); }
  });
  renderSound();

  window.addEventListener('beforeunload', () => { if (peer) peer.destroy(); });
  startPeer();
})();
