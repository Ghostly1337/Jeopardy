// Verbindungsschicht: WebRTC (PeerJS), HTTP-Relay (Vercel, api/relay) oder WebSocket-Relay
// (eigener Server, api/ws). Beide Relays funktionieren in jedem Netz, weil sie nur normales HTTPS
// brauchen – keine direkte Verbindung zwischen den Geräten. Das WebSocket-Relay hält die Verbindung
// offen und leitet sofort weiter (kein Long-Polling). Die Relay-Klassen bilden die von host.js und
// player.js genutzte PeerJS-Schnittstelle nach, damit die Spiellogik unverändert bleibt.
(function () {
  const API = 'api/relay';
  const HOST_TOKEN_KEY = 'jeopardy.hostToken';
  const HEARTBEAT_MS = 5000;     // Spieler melden sich regelmäßig beim Host
  const CONN_TIMEOUT_MS = 20000; // so lange ohne Lebenszeichen → Verbindung gilt als weg
  const WAIT_MS = 8000;          // Long-Poll-Dauer pro Anfrage
  const RETRY_MS = 1500;

  const randomId = (n = 16) => {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return [...a].map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
  };

  function hostToken() {
    let t = null;
    try { t = localStorage.getItem(HOST_TOKEN_KEY); } catch (e) {}
    if (!t) {
      t = randomId(24);
      try { localStorage.setItem(HOST_TOKEN_KEY, t); } catch (e) {}
    }
    return t;
  }

  // Verbindungs-ID = erste 32 Hex-Zeichen von SHA-256('jeopardy-conn:' + Schlüssel) – wie im Relay
  async function connIdFor(key) {
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('jeopardy-conn:' + key));
    return [...new Uint8Array(h)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const GAME_PW_KEY = 'jeopardy.gamePw';
  function gamePassword() {
    try { return sessionStorage.getItem(GAME_PW_KEY) || localStorage.getItem('jeopardy.hostPw') || ''; } catch (e) { return ''; }
  }
  function setGamePassword(pw) {
    try { if (pw) sessionStorage.setItem(GAME_PW_KEY, pw); else sessionStorage.removeItem(GAME_PW_KEY); } catch (e) {}
  }

  async function api(op, body, signal, extraHeaders) {
    const res = await fetch(`${API}?op=${op}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
      signal,
      cache: 'no-store',
      credentials: 'same-origin',
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.error || 'HTTP ' + res.status);
      err.status = res.status;
      err.retryAfter = Number(res.headers.get('retry-after')) || 0;
      throw err;
    }
    return json;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  class Emitter {
    constructor() { this._h = {}; }
    on(ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); return this; }
    emit(ev, ...args) { (this._h[ev] || []).slice().forEach((fn) => { try { fn(...args); } catch (e) { console.error(e); } }); }
  }

  const MAX_BATCH_CHARS = 2_400_000; // unter dem Relay-Limit (3 MB) mit Luft für den Umschlag
  const MAX_MSG_CHARS = 2_900_000;

  // Sendet Nachrichten der Reihe nach (immer nur eine Anfrage gleichzeitig) und bündelt,
  // was sich in der Zwischenzeit ansammelt.
  class Outbox {
    constructor(params) {
      this.params = params; // () => { room, as, token? }
      this.queue = [];
      this.busy = false;
      this.stopped = false;
    }
    push(msg) {
      if (this.stopped) return;
      this.queue.push(msg);
      if (!this.busy) this.flush();
    }
    async flush() {
      this.busy = true;
      while (this.queue.length && !this.stopped) {
        // Bündeln nach Anzahl UND Größe: Clips sind groß, das Relay nimmt höchstens ~3 MB pro Anfrage
        let size = 0;
        let n = 0;
        while (n < this.queue.length && n < 50) {
          const len = JSON.stringify(this.queue[n]).length;
          if (len > MAX_MSG_CHARS) { console.warn('Relay: Nachricht zu groß, verworfen'); this.queue.splice(n, 1); continue; }
          if (n && size + len > MAX_BATCH_CHARS) break;
          size += len;
          n++;
        }
        if (!n) continue;
        const batch = this.queue.splice(0, n);
        try {
          await api('send', { ...this.params(), msgs: batch });
        } catch (e) {
          if (e.status && e.status < 500 && e.status !== 429) continue; // abgelehnt: verwerfen
          this.queue.unshift(...batch);
          await sleep(RETRY_MS);
        }
      }
      this.busy = false;
    }
  }

  // ---------- Host-Seite ----------
  class HostConn extends Emitter {
    constructor(peer, id) {
      super();
      this.peer = peer;
      this.peerId = id;
      this.open = false;
      this.metadata = {};
      this.lastSeen = Date.now();
    }
    send(data) { if (this.open) this.peer._queueTo(this.peerId, { t: 'data', d: data }); }
    close() {
      if (!this.open) return;
      this.peer._queueTo(this.peerId, { t: 'close' });
      this._closed();
    }
    _closed() {
      if (!this.open) return;
      this.open = false;
      this.peer.conns.delete(this.peerId);
      this.emit('close');
    }
  }

  // Gemeinsame Host-Logik beider Relays: Verbindungen verwalten, Rundsendungen bündeln.
  // Unterklassen liefern nur den Transport (_push für ausgehende Nachrichten).
  class HostBase extends Emitter {
    constructor(room) {
      super();
      this.room = room;
      this.token = hostToken();
      this.conns = new Map();
      this.destroyed = false;
      this.disconnected = true;
      this.pending = [];
      this.sweep = setInterval(() => this._sweep(), HEARTBEAT_MS);
    }
    _online(ok) {
      if (ok === !this.disconnected) return;
      this.disconnected = !ok;
      this.emit(ok ? 'open' : 'disconnected');
    }
    _incoming(id, body) {
      if (!id || !body) return;
      let c = this.conns.get(id);
      if (body.t === 'open') {
        if (c) c._closed();
        c = new HostConn(this, id);
        this.conns.set(id, c);
        this.emit('connection', c);
        c.open = true;
        c.emit('open');
        return;
      }
      if (!c) {
        // Unbekanntes Gerät (z. B. nach Reload des Hosts): neu verbinden lassen
        if (body.t !== 'close') this._queueTo(id, { t: 'reopen' });
        return;
      }
      c.lastSeen = Date.now();
      if (body.t === 'data') c.emit('data', body.d);
      else if (body.t === 'close') c._closed();
    }
    _sweep() {
      const limit = Date.now() - CONN_TIMEOUT_MS;
      this.conns.forEach((c) => { if (c.lastSeen < limit) c._closed(); });
    }
    // Gleiche Nachricht an alle offenen Verbindungen → nur einmal als Rundsendung schicken
    _queueTo(id, body) {
      this.pending.push({ to: id, body });
      if (this.pending.length === 1) queueMicrotask(() => this._flushPending());
    }
    _flushPending() {
      const items = this.pending;
      this.pending = [];
      const groups = new Map();
      items.forEach((it) => {
        const key = JSON.stringify(it.body);
        if (!groups.has(key)) groups.set(key, { body: it.body, to: new Set() });
        groups.get(key).to.add(it.to);
      });
      const open = [...this.conns.keys()];
      const out = [];
      groups.forEach((g) => {
        const all = open.length > 1 && open.every((id) => g.to.has(id));
        if (all) {
          out.push({ to: null, body: g.body });
          g.to.forEach((id) => { if (!this.conns.has(id)) out.push({ to: id, body: g.body }); });
        } else {
          g.to.forEach((id) => out.push({ to: id, body: g.body }));
        }
      });
      this._push(out);
    }
    reconnect() {}
    disconnect() {}
  }

  class RelayHostPeer extends HostBase {
    constructor(room) {
      super(room);
      this.cursor = -1;
      this.outbox = new Outbox(() => ({ room, as: 'host', token: this.token }));
      this.abort = new AbortController();
      this._start();
    }
    _push(items) { items.forEach((it) => this.outbox.push(it)); }
    async _start() {
      try {
        // Spielleiter-Passwort (nur für diesen Tab gemerkt); ersatzweise das Host-Passwort aus dem Editor
        const pw = gamePassword();
        const res = await api('host', { room: this.room, token: this.token }, this.abort.signal, pw ? { 'x-game-password': pw } : undefined);
        this.cursor = res.seq;
      } catch (e) {
        if (this.destroyed) return;
        if (e.status === 401) return this.emit('error', { type: 'game-password' }); // wartet auf retry()
        if (e.status === 429) return this.emit('error', { type: 'game-password', lockedFor: e.retryAfter || 60 });
        if (e.status === 409) return this.emit('error', { type: 'unavailable-id' });
        this.emit('error', { type: 'network' });
        await sleep(RETRY_MS * 2);
        if (!this.destroyed) this._start();
        return;
      }
      this._online(true);
      this._loop();
    }
    // Nach Eingabe des Spielleiter-Passworts erneut anmelden
    retry() { if (!this.destroyed) this._start(); }
    async _loop() {
      while (!this.destroyed) {
        try {
          const res = await api('poll', { room: this.room, as: 'host', token: this.token, after: this.cursor, wait: WAIT_MS }, this.abort.signal);
          this.cursor = res.seq;
          this._online(true);
          res.msgs.forEach((m) => this._incoming(m.peer, m.body));
        } catch (e) {
          if (this.destroyed) return;
          if (e.status === 403) {
            // Raum wurde (nach langer Abwesenheit) übernommen → neu anmelden
            this._online(false);
            return this._start();
          }
          this._online(false);
          await sleep(RETRY_MS);
        }
      }
    }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      clearInterval(this.sweep);
      this.abort.abort();
      this.outbox.stopped = true;
    }
  }

  // ---------- Spieler-Seite ----------
  class PlayerConn extends Emitter {
    constructor(peer, room) {
      super();
      this.peer = peer;
      this.room = room;
      // Geheimer Schlüssel nur auf diesem Gerät; die ID ist sein Hash (das Relay prüft das).
      // So kann niemand mit unserer ID senden oder unsere privaten Nachrichten abholen.
      this.key = randomId(32);
      this.id = null;
      this.open = false;
      this.closed = false;
      this.cursor = -1;
      this.hostSeenAt = 0;
      this.abort = new AbortController();
      this.outbox = new Outbox(() => ({ room, as: this.id, key: this.key }));
      this._start();
    }
    async _start() {
      this.id = await connIdFor(this.key);
      let first = true;
      while (!this.closed) {
        try {
          const res = await api('poll', { room: this.room, as: this.id, key: this.key, after: this.cursor, wait: first ? 0 : WAIT_MS }, this.abort.signal);
          if (this.closed) return;
          this.cursor = res.seq;
          if (res.host) this.hostSeenAt = Date.now();
          if (first) {
            first = false;
            if (!res.host) {
              this._end();
              return this.peer.emit('error', { type: 'peer-unavailable' });
            }
            this.outbox.push({ body: { t: 'open' } });
            this.beat = setInterval(() => this.outbox.push({ body: { t: 'hb' } }), HEARTBEAT_MS);
            continue;
          }
          res.msgs.forEach((m) => this._incoming(m.body));
          if (Date.now() - this.hostSeenAt > CONN_TIMEOUT_MS) return this._end(true);
        } catch (e) {
          if (this.closed) return;
          if (first) {
            this._end();
            return this.peer.emit('error', { type: 'network' });
          }
          if (Date.now() - this.hostSeenAt > CONN_TIMEOUT_MS) return this._end(true);
          await sleep(RETRY_MS);
        }
      }
    }
    _incoming(body) {
      if (!body || this.closed) return;
      if (body.t === 'data') {
        if (!this.open) { this.open = true; this.emit('open'); }
        this.emit('data', body.d);
      } else if (body.t === 'close' || body.t === 'reopen') {
        this._end(true);
      }
    }
    send(data) { if (this.open) this.outbox.push({ body: { t: 'data', d: data } }); }
    close() {
      if (this.closed) return;
      this._sendClose();
      this._end(false);
    }
    _sendClose() {
      if (!this.id) return;
      const payload = JSON.stringify({ room: this.room, as: this.id, key: this.key, msgs: [{ body: { t: 'close' } }] });
      try {
        if (navigator.sendBeacon && navigator.sendBeacon(`${API}?op=send`, new Blob([payload], { type: 'application/json' }))) return;
      } catch (e) {}
      fetch(`${API}?op=send`, { method: 'POST', body: payload, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
    }
    _end(emitClose) {
      if (this.closed) return;
      this.closed = true;
      this.open = false;
      clearInterval(this.beat);
      this.abort.abort();
      this.outbox.stopped = true;
      this.peer.conns.delete(this);
      if (emitClose) this.emit('close');
    }
  }

  class RelayPlayerPeer extends Emitter {
    constructor() {
      super();
      this.conns = new Set();
      this.destroyed = false;
      this.disconnected = false;
      setTimeout(() => { if (!this.destroyed) this.emit('open', 'relay'); }, 0);
    }
    connect(peerId) {
      const room = String(peerId).slice(J.peerId('').length);
      const c = new PlayerConn(this, room);
      this.conns.add(c);
      return c;
    }
    reconnect() {}
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.conns.forEach((c) => c.close());
    }
  }

  // ---------- WebSocket-Relay (eigener Server) ----------
  // Eine offene Verbindung pro Gerät. Der Server antwortet auf die Anmeldung (host/join) mit 'ok',
  // leitet danach sofort weiter und schickt alle 10 s ein Lebenszeichen ('ka'). Bricht die Verbindung
  // ab (Funkloch, Handy im Hintergrund), baut sie sich von selbst neu auf – mit derselben Kennung,
  // so dass Host und Spieler davon kaum etwas merken.
  const KA_TIMEOUT_MS = 25000; // so lange ohne Lebenszeichen vom Server → Verbindung neu aufbauen
  const WS_QUEUE_MAX = 200;    // Nachrichten, die während eines Neuaufbaus warten dürfen
  function wsUrl() {
    const u = new URL('api/ws', location.href);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.search = '';
    return u.toString();
  }
  function wsSend(ws, obj) {
    const text = JSON.stringify(obj);
    if (text.length > MAX_MSG_CHARS) { console.warn('Relay: Nachricht zu groß, verworfen'); return true; }
    try { ws.send(text); return true; } catch (e) { return false; }
  }

  class WsHostPeer extends HostBase {
    constructor(room) {
      super(room);
      this.ws = null;
      this.ready = false;
      this.halted = false; // wartet auf Spielleiter-Passwort bzw. Raum belegt
      this.queue = [];
      this.lastFrame = Date.now();
      this._connect();
      this.watch = setInterval(() => {
        if (this.ws && this.ready && Date.now() - this.lastFrame > KA_TIMEOUT_MS) { try { this.ws.close(); } catch (e) {} }
      }, HEARTBEAT_MS);
    }
    _connect() {
      if (this.destroyed || this.halted) return;
      let ws;
      try { ws = new WebSocket(wsUrl()); } catch (e) { return this._down(null); }
      this.ws = ws;
      this.ready = false;
      ws.onopen = () => {
        const pw = gamePassword();
        wsSend(ws, { op: 'host', room: this.room, token: this.token, ...(pw ? { pw } : {}) });
      };
      ws.onmessage = (e) => {
        if (this.ws !== ws) return;
        this.lastFrame = Date.now();
        let m;
        try { m = JSON.parse(e.data); } catch (err) { return; }
        if (m.t === 'ok') {
          this.ready = true;
          this._online(true);
          this._drain();
        } else if (m.t === 'msgs' && Array.isArray(m.msgs)) {
          m.msgs.forEach((x) => this._incoming(x.peer, x.body));
        } else if (m.t === 'error') {
          if (m.status === 401) { this.halted = true; this.emit('error', { type: 'game-password' }); }
          else if (m.status === 429 && m.error === 'too many attempts') { this.halted = true; this.emit('error', { type: 'game-password', lockedFor: m.retryAfter || 60 }); }
          else if (m.status === 409) { this.halted = true; this.emit('error', { type: 'unavailable-id' }); }
        }
      };
      ws.onclose = () => this._down(ws);
      ws.onerror = () => {};
    }
    _down(ws) {
      if (ws && this.ws !== ws) return;
      this.ws = null;
      this.ready = false;
      this._online(false);
      if (this.destroyed || this.halted) return;
      setTimeout(() => this._connect(), RETRY_MS);
    }
    _push(items) {
      if (!items.length) return;
      this.queue.push(...items);
      if (this.queue.length > WS_QUEUE_MAX) this.queue.splice(0, this.queue.length - WS_QUEUE_MAX);
      if (this.ready) this._drain();
    }
    _drain() {
      while (this.queue.length && this.ready && this.ws) {
        // Bündeln nach Größe: der Server nimmt höchstens ~3,5 MB pro Nachricht
        let size = 0;
        let n = 0;
        while (n < this.queue.length && n < 50) {
          const len = JSON.stringify(this.queue[n]).length;
          if (n && size + len > MAX_BATCH_CHARS) break;
          size += len;
          n++;
        }
        const batch = this.queue.splice(0, n);
        if (!wsSend(this.ws, { op: 'send', msgs: batch })) { this.queue.unshift(...batch); return; }
      }
    }
    // Nach Eingabe des Spielleiter-Passworts erneut anmelden
    retry() {
      if (this.destroyed) return;
      this.halted = false;
      if (!this.ws) this._connect();
    }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      clearInterval(this.sweep);
      clearInterval(this.watch);
      if (this.ws) { try { this.ws.close(); } catch (e) {} }
      this.ws = null;
    }
  }

  class WsPlayerConn extends Emitter {
    constructor(peer, room) {
      super();
      this.peer = peer;
      this.room = room;
      this.key = randomId(32); // geheim, nur auf diesem Gerät; die ID ist sein Hash (prüft der Server)
      this.open = false;
      this.closed = false;
      this.joined = false;  // erste Anmeldung bestätigt?
      this.ws = null;
      this.ready = false;
      this.queue = [];
      this.hostOnline = false;
      this.hostSeenAt = Date.now();
      this.lastFrame = Date.now();
      this._connect();
      this.watch = setInterval(() => this._check(), HEARTBEAT_MS);
    }
    _connect() {
      if (this.closed) return;
      let ws;
      try { ws = new WebSocket(wsUrl()); } catch (e) { return this._down(null); }
      this.ws = ws;
      this.ready = false;
      ws.onopen = () => wsSend(ws, { op: 'join', room: this.room, key: this.key });
      ws.onmessage = (e) => {
        if (this.ws !== ws || this.closed) return;
        this.lastFrame = Date.now();
        let m;
        try { m = JSON.parse(e.data); } catch (err) { return; }
        if (m.t === 'ok') {
          this.ready = true;
          this._host(!!m.host);
          if (!this.joined) {
            this.joined = true;
            if (!m.host) {
              this._end(false);
              return this.peer.emit('error', { type: 'peer-unavailable' });
            }
            this._push({ body: { t: 'open' } });
            this.beat = setInterval(() => this._push({ body: { t: 'hb' } }), HEARTBEAT_MS);
          }
          this._drain();
        } else if (m.t === 'msgs' && Array.isArray(m.msgs)) {
          this._host(true);
          m.msgs.forEach((x) => this._incoming(x.body));
        } else if (m.t === 'host' || m.t === 'ka') {
          if ('host' in m || 'online' in m) this._host(m.t === 'host' ? !!m.online : !!m.host);
        }
      };
      ws.onclose = () => this._down(ws);
      ws.onerror = () => {};
    }
    _host(online) {
      if (online) this.hostSeenAt = Date.now();
      this.hostOnline = online;
    }
    _check() {
      if (this.closed) return;
      if (this.ws && this.ready && Date.now() - this.lastFrame > KA_TIMEOUT_MS) { try { this.ws.close(); } catch (e) {} }
      // Host zu lange weg → Verbindung gilt als beendet (player.js verbindet neu)
      if (this.joined && !this.hostOnline && Date.now() - this.hostSeenAt > CONN_TIMEOUT_MS) this._end(true);
    }
    _down(ws) {
      if (ws && this.ws !== ws) return;
      this.ws = null;
      this.ready = false;
      if (this.closed) return;
      if (!this.joined) {
        // Gar nicht erst verbunden: wie beim HTTP-Relay als Netzwerkfehler melden
        this._end(false);
        return this.peer.emit('error', { type: 'network' });
      }
      if (Date.now() - this.hostSeenAt > CONN_TIMEOUT_MS) return this._end(true);
      this.hostOnline = false;
      setTimeout(() => this._connect(), RETRY_MS);
    }
    _incoming(body) {
      if (!body || this.closed) return;
      if (body.t === 'data') {
        if (!this.open) { this.open = true; this.emit('open'); }
        this.emit('data', body.d);
      } else if (body.t === 'close' || body.t === 'reopen') {
        this._end(true);
      }
    }
    _push(msg) {
      this.queue.push(msg);
      if (this.queue.length > WS_QUEUE_MAX) this.queue.splice(0, this.queue.length - WS_QUEUE_MAX);
      this._drain();
    }
    _drain() {
      if (!this.ready || !this.ws || !this.queue.length) return;
      const batch = this.queue.splice(0, 50);
      if (!wsSend(this.ws, { op: 'send', msgs: batch })) this.queue.unshift(...batch);
      else if (this.queue.length) this._drain();
    }
    send(data) { if (this.open) this._push({ body: { t: 'data', d: data } }); }
    close() {
      if (this.closed) return;
      if (this.ws && this.ready) wsSend(this.ws, { op: 'send', msgs: [{ body: { t: 'close' } }] });
      this._end(false);
    }
    _end(emitClose) {
      if (this.closed) return;
      this.closed = true;
      this.open = false;
      clearInterval(this.beat);
      clearInterval(this.watch);
      const ws = this.ws;
      this.ws = null;
      if (ws) setTimeout(() => { try { ws.close(); } catch (e) {} }, 50); // close-Nachricht noch rausgehen lassen
      this.peer.conns.delete(this);
      if (emitClose) this.emit('close');
    }
  }

  class WsPlayerPeer extends Emitter {
    constructor() {
      super();
      this.conns = new Set();
      this.destroyed = false;
      this.disconnected = false;
      setTimeout(() => { if (!this.destroyed) this.emit('open', 'ws'); }, 0);
    }
    connect(peerId) {
      const room = String(peerId).slice(J.peerId('').length);
      const c = new WsPlayerConn(this, room);
      this.conns.add(c);
      return c;
    }
    reconnect() {}
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.conns.forEach((c) => c.close());
    }
  }

  // ---------- Auswahl ----------
  // Eigener Server (meldet ws) → WebSocket-Relay; Vercel → HTTP-Relay; ohne Server → WebRTC.
  let mode = null;
  const ready = (async () => {
    if (window.JEOP_TRANSPORT) return (mode = window.JEOP_TRANSPORT);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${API}?op=ping`, { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(t);
      const json = res.ok ? await res.json() : null;
      mode = json && json.ws && typeof WebSocket !== 'undefined' ? 'ws' : json && json.relay ? 'relay' : 'peer';
    } catch (e) {
      mode = 'peer';
    }
    return mode;
  })();

  J.net = {
    ready,
    setGamePassword,
    get mode() { return mode; },
    available: () => mode === 'relay' || mode === 'ws' || typeof Peer !== 'undefined',
    // PeerJS-kompatibel: mit ID = Host, ohne ID = Spieler.
    // options (z. B. ICE/TURN der Verbindungshilfe) gelten nur für WebRTC; das Relay braucht sie nicht.
    createPeer(id, options) {
      if (mode === 'ws') {
        const p = id ? new WsHostPeer(id.slice(J.peerId('').length)) : new WsPlayerPeer();
        if (window.JEOP_TEST && id) window.__peer = p; // Browser-Tests kappen die Verbindung gezielt
        return p;
      }
      if (mode === 'relay') return id ? new RelayHostPeer(id.slice(J.peerId('').length)) : new RelayPlayerPeer();
      return id ? new Peer(id, options) : new Peer(options);
    },
  };
})();
