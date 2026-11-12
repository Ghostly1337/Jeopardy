// Verbindungsschicht: WebRTC (PeerJS) oder HTTP-Relay (Vercel, api/relay).
// Das Relay funktioniert in jedem Netz, weil es nur normales HTTPS braucht – keine direkte
// Verbindung zwischen den Geräten. RelayPeer/RelayConn bilden die von host.js und player.js
// genutzte PeerJS-Schnittstelle nach, damit die Spiellogik unverändert bleibt.
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

  async function api(op, body, signal) {
    const res = await fetch(`${API}?op=${op}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
      cache: 'no-store',
      credentials: 'same-origin',
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.error || 'HTTP ' + res.status);
      err.status = res.status;
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
        const batch = this.queue.splice(0, 50);
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

  class RelayHostPeer extends Emitter {
    constructor(room) {
      super();
      this.room = room;
      this.token = hostToken();
      this.conns = new Map();
      this.destroyed = false;
      this.disconnected = true;
      this.cursor = -1;
      this.pending = [];
      this.outbox = new Outbox(() => ({ room, as: 'host', token: this.token }));
      this.abort = new AbortController();
      this._start();
      this.sweep = setInterval(() => this._sweep(), HEARTBEAT_MS);
    }
    async _start() {
      try {
        const res = await api('host', { room: this.room, token: this.token }, this.abort.signal);
        this.cursor = res.seq;
      } catch (e) {
        if (this.destroyed) return;
        if (e.status === 409) return this.emit('error', { type: 'unavailable-id' });
        this.emit('error', { type: 'network' });
        await sleep(RETRY_MS * 2);
        if (!this.destroyed) this._start();
        return;
      }
      this._online(true);
      this._loop();
    }
    _online(ok) {
      if (ok === !this.disconnected) return;
      this.disconnected = !ok;
      this.emit(ok ? 'open' : 'disconnected');
    }
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
      groups.forEach((g) => {
        const all = open.length > 1 && open.every((id) => g.to.has(id));
        if (all) {
          this.outbox.push({ to: null, body: g.body });
          g.to.forEach((id) => { if (!this.conns.has(id)) this.outbox.push({ to: id, body: g.body }); });
        } else {
          g.to.forEach((id) => this.outbox.push({ to: id, body: g.body }));
        }
      });
    }
    reconnect() {}
    disconnect() {}
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
      this.id = randomId(16);
      this.open = false;
      this.closed = false;
      this.cursor = -1;
      this.hostSeenAt = 0;
      this.abort = new AbortController();
      this.outbox = new Outbox(() => ({ room, as: this.id }));
      this._start();
    }
    async _start() {
      let first = true;
      while (!this.closed) {
        try {
          const res = await api('poll', { room: this.room, as: this.id, after: this.cursor, wait: first ? 0 : WAIT_MS }, this.abort.signal);
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
      const payload = JSON.stringify({ room: this.room, as: this.id, msgs: [{ body: { t: 'close' } }] });
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

  // ---------- Auswahl ----------
  // Läuft die Seite mit Relay-Server (Vercel), wird das Relay genutzt, sonst WebRTC.
  let mode = null;
  const ready = (async () => {
    if (window.JEOP_TRANSPORT) return (mode = window.JEOP_TRANSPORT);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${API}?op=ping`, { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(t);
      const json = res.ok ? await res.json() : null;
      mode = json && json.relay ? 'relay' : 'peer';
    } catch (e) {
      mode = 'peer';
    }
    return mode;
  })();

  J.net = {
    ready,
    get mode() { return mode; },
    available: () => mode === 'relay' || typeof Peer !== 'undefined',
    // PeerJS-kompatibel: mit ID = Host, ohne ID = Spieler.
    // options (z. B. ICE/TURN der Verbindungshilfe) gelten nur für WebRTC; das Relay braucht sie nicht.
    createPeer(id, options) {
      if (mode === 'relay') return id ? new RelayHostPeer(id.slice(J.peerId('').length)) : new RelayPlayerPeer();
      return id ? new Peer(id, options) : new Peer(options);
    },
  };
})();
