// Fragenset-Bibliothek: mehrere Sets speichern und im Editor zwischen ihnen wechseln.
// Auf Vercel liegen die Sets in der Datenbank (api/sets, geschützt durch das Host-Passwort),
// sonst (GitHub Pages, lokal) im localStorage dieses Browsers.
// Das gerade aktive Set wird zusätzlich als Arbeitskopie unter J.SET_KEY abgelegt – daraus
// liest das Host-Pult wie bisher.
(function () {
  const API = 'api/sets';
  const PW_KEY = 'jeopardy.hostPw';
  const LIB_KEY = 'jeopardy.library';
  const ACTIVE_KEY = 'jeopardy.activeSet';

  const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const put = (k, v) => {
    try {
      if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v);
      return true;
    } catch (e) { return false; }
  };

  const randomId = () => {
    const a = new Uint8Array(12);
    crypto.getRandomValues(a);
    return [...a].map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
  };

  // ---------- Server ----------
  function serverLib(password) {
    async function call(op, { id, body } = {}) {
      const q = new URLSearchParams({ op });
      if (id) q.set('id', id);
      const res = await fetch(`${API}?${q}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json', 'x-host-password': password },
        body: body ? JSON.stringify(body) : undefined,
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
    return {
      kind: 'server',
      async list() { return (await call('list')).sets; },
      async get(id) { return call('get', { id }); },
      async save(id, name, data) { return (await call('save', { body: { id, name, data } })).id; },
      async rename(id, name) { await call('rename', { body: { id, name } }); },
      async remove(id) { await call('delete', { body: { id } }); },
    };
  }

  // ---------- Nur dieser Browser ----------
  function localLib() {
    const read = () => {
      try { return JSON.parse(get(LIB_KEY)) || {}; } catch (e) { return {}; }
    };
    const write = (lib) => {
      if (!put(LIB_KEY, JSON.stringify(lib))) throw new Error('Browserspeicher voll');
    };
    return {
      kind: 'local',
      async list() {
        return Object.entries(read()).map(([id, s]) => ({ id, name: s.name, updated: s.updated }))
          .sort((a, b) => a.name.localeCompare(b.name, 'de'));
      },
      async get(id) {
        const s = read()[id];
        if (!s) { const e = new Error('set not found'); e.status = 404; throw e; }
        return { id, name: s.name, updated: s.updated, data: s.data };
      },
      async save(id, name, data) {
        const lib = read();
        id = id || randomId();
        lib[id] = { name, data, updated: new Date().toISOString() };
        write(lib);
        return id;
      },
      async rename(id, name) {
        const lib = read();
        if (lib[id]) { lib[id].name = name; write(lib); }
      },
      async remove(id) {
        const lib = read();
        delete lib[id];
        write(lib);
      },
    };
  }

  /**
   * Welche Bibliothek gilt hier?
   * → { lib } oder { needsPassword: true, wrong: bool }
   * Ohne Server (404, kein JSON) oder ohne Konfiguration (503) → lokale Bibliothek.
 * Andere Serverfehler werfen, damit nicht versehentlich eine zweite, lokale Liste entsteht.
   */
  async function connect(password = get(PW_KEY) || '') {
    let res;
    try {
      res = await fetch(`${API}?op=check`, {
        headers: { 'x-host-password': password }, cache: 'no-store', credentials: 'same-origin',
      });
    } catch (e) {
      return { lib: localLib() };
    }
    if (res.ok) {
      put(PW_KEY, password);
      return { lib: serverLib(password) };
    }
    const json = await res.json().catch(() => null);
    if (res.status === 401 && json && json.error === 'wrong host password') {
      if (password) put(PW_KEY, null);
      return { needsPassword: true, wrong: !!password };
    }
    // Kein Server (404) oder Server ohne Datenbank/Host-Passwort (503) → lokal
    if (res.status === 404 || (res.status === 503 && json && json.error === 'sets not configured') || !json) {
      return { lib: localLib() };
    }
    const err = new Error((json && json.error) || 'HTTP ' + res.status);
    err.status = res.status;
    throw err;
  }

  const activeId = () => get(ACTIVE_KEY);
  const setActiveId = (id) => put(ACTIVE_KEY, id);

  // Ist das Set noch die leere Vorlage? (dann lohnt es nicht, es als eigenes Set zu sichern)
  const isBlank = (set) => JSON.stringify(J.normalizeSet(set)) === JSON.stringify(J.defaultSet());

  J.sets = { connect, localLib, serverLib, activeId, setActiveId, isBlank, PW_KEY, LIB_KEY, ACTIVE_KEY };
})();
