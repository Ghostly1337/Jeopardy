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
  }

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
    conn.on('open', () => setStatus(`Raum ${room}`, true));
    conn.on('data', (msg) => {
      if (msg && msg.type === 'state') render(msg.data);
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

  window.addEventListener('beforeunload', () => { if (peer) peer.destroy(); });
  startPeer();
})();
