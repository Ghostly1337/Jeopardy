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
    const ov = $('overlay');
    const clueKey = cur ? `${s.round}:${cur.cat}:${cur.row}` : null;
    const opened = cur && clueKey !== lastClueKey;
    ov.classList.toggle('show', !!cur);
    if (opened && !zoomFromCell(ov)) {
      ov.classList.add('entering');
      clearTimeout(ov.__enter);
      ov.__enter = setTimeout(() => ov.classList.remove('entering'), 400);
    }
    if (!cur) ov.classList.remove('fx-right', 'fx-wrong');
    if (cur) {
      $('meta').textContent = `${cur.category} – ${cur.value}`;
      $('q').textContent = cur.q;
      const img = $('img');
      img.hidden = !cur.img;
      if (cur.img && img.getAttribute('src') !== cur.img) img.src = cur.img;
      if (!cur.img) img.removeAttribute('src');
      img.classList.toggle('pixel', !!cur.pixel && cur.pixel.mode !== 'zoom');
      img.classList.toggle('zoomed', !!cur.pixel && cur.pixel.mode === 'zoom');
      // Bei Schätzfrage und Reihenfolge zeigt die Ergebnisliste die Lösung
      $('a').textContent = cur.kind === 'estimate' || cur.kind === 'order' ? '' : cur.a || '';
      J.renderScores($('overlayScores'), s.players, s.turn);
      judgeEffects(ov, opened ? {} : prevJudged, cur.judged || {});
      buzzShow(cur, clueKey, s);
      jokerShow(cur, clueKey, s, opened);
    }
    lastClueKey = clueKey;
    prevJudged = cur ? { ...(cur.judged || {}) } : {};

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
    renderJokers(clueKey);
    renderSpecial(clueKey);
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
  let lastClueKey = null;
  let prevJudged = {};

  // ---------- Animationen ----------
  // Frage wächst aus dem angeklickten Feld heraus
  function zoomFromCell(ov) {
    const cell = $('board').querySelector('.cell.val.active');
    const r = cell && cell.getBoundingClientRect();
    if (!r || !r.width || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    ov.style.animation = 'none';
    ov.style.transition = 'none';
    ov.style.transformOrigin = '0 0';
    ov.style.transform = `translate(${r.left}px, ${r.top}px) scale(${r.width / window.innerWidth}, ${r.height / window.innerHeight})`;
    ov.classList.add('zoom-in');
    void ov.offsetWidth;
    ov.style.transition = 'transform .45s cubic-bezier(.2, .8, .2, 1)';
    ov.style.transform = 'none';
    clearTimeout(ov.__zoom);
    ov.__zoom = setTimeout(() => {
      ov.classList.remove('zoom-in');
      ov.style.animation = ov.style.transition = ov.style.transform = ov.style.transformOrigin = '';
    }, 700);
    return true;
  }

  // Grüner Puls bei richtig, roter Wackler bei falsch (nur für neue Wertungen)
  function judgeEffects(ov, before, now) {
    const fresh = Object.keys(now).filter((id) => !before[id]).map((id) => now[id]);
    if (!fresh.length) return;
    const cls = fresh.includes('right') ? 'fx-right' : 'fx-wrong';
    ov.classList.remove('fx-right', 'fx-wrong');
    void ov.offsetWidth;
    ov.classList.add(cls);
    clearTimeout(ov.__fx);
    ov.__fx = setTimeout(() => ov.classList.remove(cls), 1000); // sonst startet es beim nächsten Öffnen erneut
  }

  // ---------- Schätzfrage / Reihenfolge ----------
  let specialKey = null;   // für welche Frage/Phase die Eingabe gebaut ist
  let myGuess = null;      // eigener Tipp (Schätzfrage)
  let myOrder = null;      // eigene Reihenfolge: Positionen in der angezeigten Liste
  let orderSent = false;

  const fmtNum = (n) => (n == null ? '–' : Number(n).toLocaleString('de-DE', { maximumFractionDigits: 3 }));

  function renderSpecial(clueKey) {
    const box = $('specialBox');
    const cur = last && last.current;
    const kind = cur && cur.kind;
    if (!cur || (kind !== 'estimate' && kind !== 'order')) { box.hidden = true; specialKey = null; return; }
    box.hidden = false;
    const isPlayer = !!myPlayer();
    const data = kind === 'estimate' ? cur.est : cur.ord;
    const total = last.players.length;
    const nameOf = (id) => (last.players.find((p) => p.id === id) || {}).name || '?';
    const key = clueKey + ':' + (data.revealed ? 'r' : 'o') + ':' + (isPlayer ? me : 'view');
    if (key !== specialKey) {
      if (!specialKey || !specialKey.startsWith(clueKey + ':')) { myGuess = null; myOrder = null; orderSent = false; }
      specialKey = key;
      box.innerHTML = '';
      if (data.revealed) box.appendChild(kind === 'estimate' ? estimateResult(cur.est, nameOf) : orderResult(cur.ord, nameOf));
      else if (isPlayer) box.appendChild(kind === 'estimate' ? estimateInput() : orderInput(cur.ord.items));
      else if (kind === 'order') box.appendChild(orderList(cur.ord.items));
      const st = document.createElement('div');
      st.className = 'special-status';
      box.appendChild(st);
    }
    const st = box.querySelector('.special-status');
    if (data.revealed) { st.textContent = ''; st.hidden = true; return; }
    st.hidden = false;
    const n = data.submitted.length;
    const mine = isPlayer && data.submitted.includes(me);
    st.textContent = (kind === 'estimate' ? `🔢 ${n}/${total} haben getippt` : `↕️ ${n}/${total} haben abgegeben`) +
      (mine ? (kind === 'estimate' ? ` · Dein Tipp: ${fmtNum(myGuess)} ✓` : ' · Deine Reihenfolge ist abgegeben ✓') : '');
  }

  function estimateInput() {
    const f = document.createElement('form');
    f.className = 'est-form';
    f.innerHTML = '<input id="estInput" inputmode="decimal" autocomplete="off" placeholder="Deine Schätzung"><button class="primary" type="submit">Tippen</button>';
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = f.querySelector('input');
      const v = J.parseNumber(input.value);
      if (v == null || !conn || !conn.open) { input.classList.add('invalid'); return; }
      input.classList.remove('invalid');
      myGuess = v;
      conn.send({ type: 'estimate', value: v });
      renderSpecial(lastJokerKey);
    });
    return f;
  }

  function estimateResult(est, nameOf) {
    const wrap = document.createElement('div');
    wrap.className = 'est-result';
    const g = est.guesses || {};
    const ids = Object.keys(g).sort((a, b) => Math.abs(g[a] - est.answer) - Math.abs(g[b] - est.answer));
    wrap.innerHTML = `<div class="est-answer">Richtig: <b>${fmtNum(est.answer)}</b></div>` + (ids.length
      ? `<ol class="est-list">${ids.map((id) => {
        const won = est.winners.includes(id);
        const diff = Math.abs(g[id] - est.answer);
        return `<li class="${won ? 'won' : ''}"><span>${won ? '🏆 ' : ''}${J.escapeHtml(nameOf(id))}</span><b>${fmtNum(g[id])}</b><small>${diff === 0 ? 'exakt!' : 'daneben: ' + fmtNum(diff)}</small></li>`;
      }).join('')}</ol>`
      : '<div class="est-none">Niemand hat getippt</div>');
    return wrap;
  }

  function orderList(items) {
    const ol = document.createElement('ol');
    ol.className = 'order-list';
    ol.innerHTML = items.map((t) => `<li><span>${J.escapeHtml(t)}</span></li>`).join('');
    return ol;
  }

  function orderInput(items) {
    const wrap = document.createElement('div');
    wrap.className = 'order-input';
    if (!myOrder) myOrder = items.map((_, i) => i);
    const draw = () => {
      wrap.innerHTML = '';
      const ol = document.createElement('ol');
      ol.className = 'order-list editable';
      myOrder.forEach((idx, pos) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${J.escapeHtml(items[idx])}</span>`;
        [['▲', -1], ['▼', 1]].forEach(([label, d]) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'small';
          b.textContent = label;
          b.disabled = pos + d < 0 || pos + d >= myOrder.length;
          b.addEventListener('click', () => {
            [myOrder[pos], myOrder[pos + d]] = [myOrder[pos + d], myOrder[pos]];
            orderSent = false;
            draw();
          });
          li.appendChild(b);
        });
        ol.appendChild(li);
      });
      const send = document.createElement('button');
      send.className = 'primary';
      send.id = 'orderSend';
      send.textContent = orderSent ? 'Abgegeben ✓ (ändern möglich)' : 'Reihenfolge abgeben';
      send.addEventListener('click', () => {
        if (!conn || !conn.open) return;
        conn.send({ type: 'order', order: [...myOrder] });
        orderSent = true;
        draw();
      });
      wrap.append(ol, send);
    };
    draw();
    return wrap;
  }

  function orderResult(ord, nameOf) {
    const wrap = document.createElement('div');
    wrap.className = 'order-result';
    const res = ord.results || {};
    const right = Object.keys(res).filter((id) => res[id]);
    wrap.innerHTML = `<div class="est-answer">Richtige Reihenfolge</div><ol class="order-list solved">${(ord.correct || []).map((t) => `<li><span>${J.escapeHtml(t)}</span></li>`).join('')}</ol>` +
      `<div class="order-winners">${right.length ? '🏆 ' + right.map((id) => J.escapeHtml(nameOf(id))).join(', ') : 'Niemand hatte alles richtig'}</div>`;
    return wrap;
  }

  // ---------- Joker ----------
  const hints = {};      // Tipp-Muster je Frage (kommt nur an dieses Gerät)
  let jokerArmed = null; // erster Tipp auf einen Joker: „nochmal tippen zum Einsetzen“
  let armTimer = null;
  let passOpen = false;  // Zielauswahl fürs Weitergeben offen
  let lastJokerKey = null;
  let prevJokers = { double: [], hint: [], pass: null };

  function sendJoker(kind, target) {
    if (!conn || !conn.open) return;
    conn.send({ type: 'joker', kind, target });
    jokerArmed = null;
    passOpen = false;
  }

  function renderJokers(clueKey) {
    const bar = $('jokerBar');
    const hintBox = $('hintBox');
    const cur = last && last.current;
    const mePlayer = myPlayer();
    if (clueKey !== lastJokerKey) { jokerArmed = null; passOpen = false; lastJokerKey = clueKey; }
    // Tipp anzeigen (nur auf dem eigenen Gerät)
    const myHint = cur && mePlayer && (cur.jokers.hint || []).includes(me) && hints[clueKey];
    hintBox.hidden = !myHint;
    if (myHint) hintBox.innerHTML = `<span class="hint-label">💡 Tipp</span><span class="hint-text">${J.escapeHtml(myHint)}</span>`;
    if (!cur || !mePlayer || cur.revealed || (cur.kind && cur.kind !== 'normal')) { bar.hidden = true; return; }
    const ctx = { cur, players: last.players, turn: last.turn, pid: me };
    const double = (cur.jokers.double || []).includes(me);
    bar.hidden = false;
    bar.innerHTML = '';
    if (double) {
      const b = document.createElement('div');
      b.className = 'joker-active';
      b.textContent = '🎲 Doppelt oder nichts ist aktiv';
      bar.appendChild(b);
    }
    const row = document.createElement('div');
    row.className = 'joker-row';
    J.JOKERS.forEach((j) => {
      const used = (mePlayer.usedJokers || []).includes(j.id);
      const block = J.jokerBlock(j.id, ctx);
      const btn = document.createElement('button');
      btn.className = 'joker' + (used ? ' used' : '') + (jokerArmed === j.id || (j.id === 'pass' && passOpen) ? ' armed' : '');
      btn.dataset.kind = j.id;
      btn.disabled = !!block;
      btn.title = block || j.desc;
      btn.innerHTML = `<span class="joker-icon">${j.icon}</span><span class="joker-name">${jokerArmed === j.id ? 'Nochmal tippen' : j.name}</span>`;
      btn.addEventListener('click', () => {
        if (j.id === 'pass') { passOpen = !passOpen; renderJokers(clueKey); return; }
        if (jokerArmed === j.id) { sendJoker(j.id); renderJokers(clueKey); return; }
        jokerArmed = j.id;
        clearTimeout(armTimer);
        armTimer = setTimeout(() => { jokerArmed = null; renderJokers(lastJokerKey); }, 3000);
        renderJokers(clueKey);
      });
      row.appendChild(btn);
    });
    bar.appendChild(row);
    // Weitergeben: an wen?
    if (passOpen && !J.jokerBlock('pass', ctx)) {
      const pick = document.createElement('div');
      pick.className = 'joker-targets';
      pick.innerHTML = '<span>Weitergeben an:</span>';
      last.players.filter((p) => p.id !== me).forEach((p) => {
        const t = document.createElement('button');
        t.className = 'small';
        t.dataset.target = p.id;
        t.textContent = p.name;
        t.addEventListener('click', () => { sendJoker('pass', p.id); renderJokers(clueKey); });
        pick.appendChild(t);
      });
      bar.appendChild(pick);
    }
  }

  // TV-Ansicht: eingesetzte Joker groß ankündigen
  function jokerShow(cur, clueKey, s, opened) {
    const jk = cur.jokers || { double: [], hint: [], pass: null };
    const before = opened ? { double: [], hint: [], pass: null } : prevJokers;
    prevJokers = { double: [...(jk.double || [])], hint: [...(jk.hint || [])], pass: jk.pass };
    if (me !== 'tv') return;
    const nameOf = (id) => (s.players.find((p) => p.id === id) || {}).name || '?';
    let text = null;
    if (jk.pass && !before.pass) text = `👉 ${nameOf(jk.pass.from)} → ${nameOf(jk.pass.to)}`;
    ['double', 'hint'].forEach((k) => (jk[k] || []).forEach((id) => {
      if (!before[k].includes(id)) text = `${J.jokerInfo(k).icon} ${nameOf(id)}: ${J.jokerInfo(k).name}`;
    }));
    if (text) bigShow(text);
  }

  function bigShow(text) {
    const el = $('buzzShow');
    el.querySelector('.buzz-show-name').textContent = text;
    el.classList.remove('go');
    void el.offsetWidth;
    el.classList.add('go');
    clearTimeout(el.__t);
    el.__t = setTimeout(() => el.classList.remove('go'), 1700);
  }

  // TV-Ansicht: wer buzzert, erscheint kurz groß
  let lastBuzzShown = null;
  function buzzShow(cur, clueKey, s) {
    const buzz = cur.buzz || {};
    if (me !== 'tv' || !buzz.winner || (cur.judged || {})[buzz.winner]) return;
    const key = clueKey + ':' + (buzz.id || '') + ':' + buzz.winner;
    if (key === lastBuzzShown) return;
    lastBuzzShown = key;
    const p = s.players.find((x) => x.id === buzz.winner);
    const name = s.mode === 'team' && buzz.winnerName ? `${buzz.winnerName} (${p ? p.name : '?'})` : (p ? p.name : '?');
    bigShow('⚡ ' + name);
  }

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
    const special = cur.kind === 'estimate' || cur.kind === 'order';
    const eligible = isPlayer && !judged[me] && !solved && !special;
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
    } else if (cur.jokers && cur.jokers.pass && !Object.keys(judged).length && !solved) {
      const pn = (id) => (last.players.find((p) => p.id === id) || {}).name || '?';
      text = cur.jokers.pass.to === me
        ? `👉 ${pn(cur.jokers.pass.from)} gibt an dich weiter – du bist dran!`
        : `👉 ${pn(cur.jokers.pass.from)} gibt weiter an ${pn(cur.jokers.pass.to)}`;
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
    if (!t) {
      timerEnd = null;
      J.renderTimer($('timerBox'), null);
      if (J.timerMusicOn()) J.stopTimerMusic();
      return;
    }
    const end = Date.now() + t.remaining;
    // TV-Ansicht spielt den Timer-Sound; neu starten, wenn der Timer neu gestartet wurde
    const restarted = timerEnd == null || end > timerEnd + 1000;
    timerEnd = end;
    timerTotal = t.total;
    if (me === 'tv' && restarted && J.soundOn()) J.startTimerMusic(t.remaining);
  }
  setInterval(() => {
    if (timerEnd == null) return;
    const remaining = Math.max(0, timerEnd - Date.now());
    J.renderTimer($('timerBox'), remaining, timerTotal);
    const sec = Math.ceil(remaining / 1000);
    if (sec > 0 && sec <= 5 && sec !== lastTick && J.soundOn() && !J.timerMusicOn()) J.sfx('tick');
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
      else if (msg.type === 'hint' && typeof msg.key === 'string' && typeof msg.text === 'string') {
        hints[msg.key] = msg.text;
        renderJokers(lastJokerKey);
      }
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
