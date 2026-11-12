(function () {
  const $ = (id) => document.getElementById(id);
  const room = (new URLSearchParams(location.search).get('room') || '').trim().toUpperCase();

  if (!room) {
    location.href = 'index.html';
    return;
  }
  document.title = `Jeopardy – Raum ${room}`;

  // Verbindungshilfe (TURN) aus dem Beitrittslink übernehmen und für diesen Raum merken
  const TURN_ROOM_KEY = 'jeopardy.turn.' + room;
  const fromLink = /(?:^|[#&])t=([\w-]+)/.exec(location.hash);
  if (fromLink) {
    J.saveTurn(J.decodeTurn(fromLink[1]), TURN_ROOM_KEY);
    history.replaceState(null, '', location.pathname + location.search); // Zugang nicht in der Adresszeile lassen
  }
  const turn = J.loadTurn(TURN_ROOM_KEY);
  const peerOptions = () => ({ config: J.iceConfig(turn, window.JEOP_FORCE_RELAY) });

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

    const intro = s.intro;
    board.classList.toggle('intro-active', !!intro);
    // Intro gerade fertig → Punktefelder austeilen
    if (prevIntro && !intro) {
      board.classList.add('deal');
      clearTimeout(dealTimer);
      dealTimer = setTimeout(() => board.classList.remove('deal'), 2000);
    }
    prevIntro = !!intro;
    J.renderIntro($('intro'), intro, s.round, s.values);
    let html = s.categories.map((c, i) => `<div class="cell cat${J.introCellClass(intro, i)}">${J.escapeHtml(c)}</div>`).join('');
    for (let row = 0; row < s.values.length; row++) {
      for (let c = 0; c < s.categories.length; c++) {
        const used = s.used[c][row];
        const active = s.current && s.current.cat === c && s.current.row === row;
        html += `<div class="cell val${used ? ' used' : ''}${active ? ' active' : ''}" style="--i:${row * s.categories.length + c}">${s.values[row]}</div>`;
      }
    }
    board.innerHTML = html;
    J.renderScores($('scores'), s.players, s.turn);
    J.renderTurn($('turnBanner'), s.players, s.turn);

    const cur = s.current;
    $('overlay').classList.toggle('show', !!cur);
    if (cur) {
      $('meta').textContent = `${cur.category} – ${cur.value}`;
      $('q').textContent = cur.q;
      const img = $('img');
      img.hidden = !cur.img;
      if (cur.img && img.getAttribute('src') !== cur.img) img.src = cur.img;
      if (!cur.img) img.removeAttribute('src');
      img.classList.toggle('pixel', !!cur.pixel);
      $('a').textContent = cur.a || '';
      J.renderScores($('overlayScores'), s.players, s.turn);
    }

    // Siegerehrung
    $('finish').classList.toggle('show', !!s.finished);
    if (s.finished) {
      J.renderPodium($('podium'), s.players, s.title, s.stats, s.mode === 'team' ? s.personStats : null);
      if (!wasFinished) J.confetti($('finish'));
    }
    wasFinished = !!s.finished;

    last = s;
    renderMe();
    renderBuzz();
    syncTimer(cur && cur.timer);
  }

  // ---------- Wer bin ich? ----------
  const ME_KEY = 'jeopardy.me.' + room;
  let me = null; // Spieler-/Team-ID, 'watch', 'tv' oder null (noch nicht gewählt)
  try { me = localStorage.getItem(ME_KEY); } catch (e) {}
  const NAME_KEY = 'jeopardy.myname';
  let myName = '';
  try { myName = localStorage.getItem(NAME_KEY) || ''; } catch (e) {}
  const isTeamMode = () => !!last && last.mode === 'team';
  let last = null;
  let prevIntro = false;
  let dealTimer = null;
  let wasFinished = false;

  const myPlayer = () => (last && last.players.find((p) => p.id === me)) || null;

  // Stabile Geräte-ID, damit derselbe Spieler nach einem Verbindungsabbruch seinen Namen behält
  const DEVICE_KEY = 'jeopardy.device';
  let deviceId = null;
  try { deviceId = localStorage.getItem(DEVICE_KEY); } catch (e) {}
  if (!deviceId) {
    deviceId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem(DEVICE_KEY, deviceId); } catch (e) {}
  }
  let pickerError = '';

  function forget(reason) {
    me = null;
    pickerError = reason;
    try { localStorage.removeItem(ME_KEY); } catch (e) {}
    renderMe();
  }

  function choose(id) {
    if (isTeamMode() && id !== 'watch' && id !== 'tv') {
      const n = J.cleanName($('pickerName').value);
      if (!n) {
        pickerError = 'Bitte gib zuerst deinen Namen ein.';
        renderMe();
        $('pickerName').focus();
        return;
      }
      myName = n;
      try { localStorage.setItem(NAME_KEY, n); } catch (e) {}
    }
    if (id === 'tv') {
      // Klick = Nutzeraktion: Ton freischalten und Vollbild versuchen
      J.setSoundOn(true);
      J.unlockAudio();
      goFullscreen();
    }
    pickerError = '';
    me = id;
    try { localStorage.setItem(ME_KEY, id); } catch (e) {}
    $('picker').hidden = true;
    sendHello();
    if (last) render(last);
  }

  function renderMe() {
    if (!last) return;
    const special = me === 'watch' || me === 'tv';
    const valid = special || myPlayer();
    const team = isTeamMode();
    document.body.classList.toggle('tv', me === 'tv');
    $('fullBtn').hidden = me !== 'tv';
    // Noch nicht gewählt oder Spieler/Team wurde gelöscht → Auswahl zeigen, Board bleibt verdeckt.
    // Ohne Spieler/Teams gibt es nur TV/Zuschauen; die Liste füllt sich live, sobald der Host welche anlegt.
    if (!valid) {
      const list = $('pickerList');
      list.innerHTML = '';
      $('pickerTitle').textContent = team ? 'Wähle dein Team' : 'Wer bist du?';
      $('pickerNameRow').hidden = !team || !last.players.length;
      if (team && !$('pickerName').value) $('pickerName').value = myName;
      $('pickerEmpty').hidden = last.players.length > 0;
      $('pickerEmpty').textContent = team
        ? 'Der Host hat noch keine Teams angelegt. Warte kurz – die Teams erscheinen hier automatisch.'
        : 'Der Host hat noch keine Spieler angelegt. Warte kurz – dein Name erscheint hier automatisch.';
      const taken = new Set(team ? last.full || [] : last.taken || []);
      const members = last.members || {};
      last.players.forEach((p) => {
        const b = document.createElement('button');
        b.className = 'pick';
        if (team) {
          const n = (members[p.id] || []).length;
          b.innerHTML = `<span class="pick-name"><i class="team-dot" style="--team:${p.color}"></i>${J.escapeHtml(p.name)}</span>` +
            `<span class="pick-count">${n}/${last.teamSize}</span>`;
        } else {
          b.textContent = p.name;
        }
        if (taken.has(p.id)) {
          b.disabled = true;
          b.classList.add('taken');
          b.dataset.reason = team ? 'voll' : 'vergeben';
          b.title = team ? 'Team ist voll' : 'Schon vergeben';
        }
        b.addEventListener('click', () => choose(p.id));
        list.appendChild(b);
      });
      $('pickerError').hidden = !pickerError;
      $('pickerError').textContent = pickerError;
      $('picker').hidden = false;
    } else {
      $('picker').hidden = true;
    }
    const btn = $('me');
    btn.hidden = !valid;
    $('reactBar').hidden = !valid || me === 'tv';
    btn.textContent = me === 'watch' ? '👀 Zuschauer'
      : me === 'tv' ? '📺 TV'
      : !myPlayer() ? ''
      : team ? `Du: ${myName || 'Spieler'} · ${myPlayer().name}`
      : 'Du: ' + myPlayer().name;
  }

  function goFullscreen() {
    const el = document.documentElement;
    try { if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {}); } catch (e) {}
  }
  $('fullBtn').addEventListener('click', goFullscreen);
  $('tvView').addEventListener('click', () => choose('tv'));

  $('me').addEventListener('click', () => {
    me = null;
    try { localStorage.removeItem(ME_KEY); } catch (e) {}
    sendHello();
    renderMe();
  });
  $('watchOnly').addEventListener('click', () => choose('watch'));

  function sendHello() {
    const pid = me && me !== 'watch' && me !== 'tv' ? me : null;
    if (conn && conn.open) conn.send({ type: 'hello', playerId: pid, deviceId, name: myName });
  }

  // ---------- Buzzer ----------
  let pressed = false; // lokal gesperrt nach dem Drücken, bis der Host antwortet
  let shownId = null;  // Buzzer-Runde, für die der Knopf gerade angezeigt wird
  let shownAt = 0;     // Zeitpunkt, an dem der Knopf auf DIESEM Gerät erschien
  let lockedUntil = 0; // Frühstart-Sperre (performance.now())
  let lockTimer = null;

  function renderBuzz() {
    const cur = last && last.current;
    const buzzer = $('buzzer');
    const info = $('buzzInfo');
    if (!cur) { buzzer.hidden = true; info.hidden = true; return; }
    const buzz = cur.buzz || {};
    const judged = cur.judged || {};
    const isPlayer = !!myPlayer();
    if (!buzz.open) pressed = false;

    const solved = Object.values(judged).includes('right');
    // Wer bei dieser Frage noch antworten darf, sieht den Buzzer die ganze Zeit –
    // grau, solange er zu ist. Drücken auf den grauen Knopf sperrt kurz (gegen Dauer-Hämmern).
    const eligible = isPlayer && !judged[me] && !solved;
    const canBuzz = eligible && buzz.open;
    // Reaktionszeit startet, sobald der Knopf hier scharf wird (Netzlaufzeit zählt nicht)
    if (canBuzz && shownId !== buzz.id) {
      shownId = buzz.id;
      shownAt = performance.now();
      pressed = false;
    }
    // Wer gebuzzert hat (bzw. dessen Team), ist dran: Knopf grün und ohne Funktion –
    // sonst würde Weiterdrücken als Frühstart zählen
    const myTurn = eligible && !!buzz.winner && buzz.winner === me && !judged[buzz.winner];
    if (myTurn) lockedUntil = 0;
    const locked = performance.now() < lockedUntil;
    buzzer.hidden = !eligible;
    buzzer.disabled = pressed || myTurn;
    buzzer.className = 'buzzer ' + (myTurn ? 'mine' : locked ? 'locked' : canBuzz ? 'live' : 'wait');
    buzzer.textContent = myTurn ? 'Dran!' : pressed ? '…' : locked ? 'Zu früh!' : canBuzz ? 'BUZZ' : 'Noch nicht';

    let text = '';
    if (buzz.winner && !judged[buzz.winner] && !solved) {
      const w = last.players.find((p) => p.id === buzz.winner);
      const wName = isTeamMode() && buzz.winnerName ? `${buzz.winnerName} (${w ? w.name : '?'})` : (w ? w.name : '?');
      const rx = buzz.reactions || {};
      const t = (id) => (rx[id] != null ? J.fmtMs(rx[id]) : '');
      if (buzz.winner === me && (!isTeamMode() || buzz.winnerName === myName)) {
        text = 'Du bist dran!' + (t(me) ? ` (${t(me)})` : '');
      } else if (buzz.winner === me) {
        text = `⚡ ${buzz.winnerName} aus deinem Team ist dran`;
      } else if (rx[me] != null) {
        text = `⚡ ${wName} war schneller: ${t(buzz.winner)} vs. ${isTeamMode() ? 'euer Team' : 'deine'} ${t(me)}`;
      } else {
        text = `⚡ ${wName} ist dran` + (t(buzz.winner) ? ` (${t(buzz.winner)})` : '');
      }
    } else if (locked) {
      text = 'Zu früh gedrückt – kurz gesperrt';
    } else if (canBuzz && Object.values(judged).includes('wrong')) {
      text = `Klauen bringt +${cur.value / 2}`;
    } else if (canBuzz && cur.pixel) {
      text = 'Erkannt? Wer zuerst buzzert, darf antworten';
    } else if (buzz.open && isPlayer && judged[me]) {
      text = 'Du hast schon geantwortet';
    } else if (buzz.open && !isPlayer) {
      text = '🔔 Buzzer offen';
    }
    info.textContent = text;
    info.hidden = !text;
    info.classList.toggle('mine', buzz.winner === me);
  }

  function lockBuzzer() {
    lockedUntil = performance.now() + J.LOCK_MS; // jedes weitere Hämmern verlängert die Sperre
    try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) {}
    clearTimeout(lockTimer);
    lockTimer = setTimeout(renderBuzz, J.LOCK_MS + 20);
    renderBuzz();
  }

  function pressBuzz() {
    const b = $('buzzer');
    if (b.hidden || b.disabled || pressed || !conn || !conn.open) return;
    const now = performance.now();
    if (!b.classList.contains('live') || now < lockedUntil) return lockBuzzer();
    const reaction = now - shownAt;
    if (J.isEarly(reaction)) return lockBuzzer(); // schneller als menschlich möglich = vorher gehämmert
    pressed = true;
    const buzz = (last && last.current && last.current.buzz) || {};
    conn.send({ type: 'buzz', id: buzz.id, reaction });
    renderBuzz();
  }
  // pointerdown statt click: reagiert sofort beim Antippen
  $('buzzer').addEventListener('pointerdown', (e) => { e.preventDefault(); pressBuzz(); });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target.tagName !== 'INPUT') { e.preventDefault(); if (!e.repeat) pressBuzz(); }
  });

  // ---------- Live-Reaktionen ----------
  let lastReact = 0;
  const toggle = document.createElement('button');
  toggle.className = 'react-btn react-toggle';
  toggle.textContent = '😀';
  toggle.title = 'Reaktionen';
  toggle.addEventListener('click', () => $('reactBar').classList.toggle('open'));
  $('reactBar').appendChild(toggle);
  J.REACTIONS.forEach((emoji) => {
    const b = document.createElement('button');
    b.className = 'react-btn';
    b.textContent = emoji;
    b.addEventListener('click', () => {
      const now = Date.now();
      if (now - lastReact < 350 || !conn || !conn.open) return; // lokal drosseln
      lastReact = now;
      conn.send({ type: 'react', emoji });
    });
    $('reactBar').appendChild(b);
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
  let hintTimer;

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
    // Kommt die Direktverbindung nicht zustande, blockiert meist das Netz (z. B. Uni-WLAN)
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      if (thisConn !== conn || conn.open || J.net.mode !== 'peer') return; // nur WebRTC hat dieses Problem
      setStatus('Keine Direktverbindung', false);
      $('waiting').textContent = turn
        ? 'Die Verbindung kommt nicht zustande, obwohl die Verbindungshilfe aktiv ist. Prüft den TURN-Zugang im Host-Pult oder wechselt auf mobile Daten.'
        : 'Die Verbindung kommt nicht zustande – vermutlich blockiert euer Netz direkte Verbindungen (z. B. im selben Uni-WLAN). Wechsle auf mobile Daten, oder der Host richtet im Host-Pult die „Verbindungshilfe“ ein und schickt den Link neu.';
    }, window.JEOP_CONNECT_HINT_MS || 12000);
    conn.on('open', () => {
      clearTimeout(hintTimer);
      setStatus(`Raum ${room}`, true);
      sendHello();
    });
    conn.on('data', (msg) => {
      if (!msg) return;
      if (msg.type === 'state') render(msg.data);
      else if (msg.type === 'sfx' && J.soundOn()) J.sfx(msg.name);
      else if (msg.type === 'react') J.showReaction(msg.emoji, msg.name);
      else if (msg.type === 'taken' && msg.playerId === me) {
        forget(msg.reason === 'full' ? 'Dieses Team ist schon voll. Wähle ein anderes.' : 'Dieser Name ist schon auf einem anderen Gerät vergeben.');
      } else if (msg.type === 'released') forget('Der Host hat dein Gerät getrennt. Bitte wähle neu.');
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
    if (!J.net.available()) {
      setStatus('PeerJS nicht geladen (offline?)', false);
      $('waiting').textContent = 'Keine Verbindung möglich. Internet prüfen und neu laden.';
      return;
    }
    peer = J.net.createPeer(null, peerOptions());
    peer.on('open', connect);
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') {
        setStatus('Host nicht erreichbar – neuer Versuch…', false);
        $('waiting').textContent = `Warte auf den Host von Raum ${room}… Stimmt der Code? Der Host sollte sein Host-Pult geöffnet und im Vordergrund haben.`;
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
  J.net.ready.then(startPeer);
})();
