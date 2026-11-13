(function () {
  let set = J.loadSet();
  let round = 0;
  const grid = document.getElementById('grid');
  const titleEl = document.getElementById('title');
  const savedEl = document.getElementById('saved');
  let savedTimer;

  // ---------- Fragenset-Bibliothek ----------
  const $ = (id) => document.getElementById(id);
  const selectEl = $('setSelect');
  const sourceEl = $('setSource');
  let lib = null;        // Server- oder lokale Bibliothek, null bis entsperrt
  let sets = [];         // [{id, name}]
  let active = null;     // id des aktiven Sets
  let syncTimer = null;
  let dirty = false;     // ungespeicherte Änderungen am aktiven Set
  let syncing = Promise.resolve();

  function showSaved(text, error) {
    savedEl.textContent = text;
    savedEl.classList.toggle('error', !!error);
    clearTimeout(savedTimer);
    if (!error) savedTimer = setTimeout(() => (savedEl.textContent = ''), 1500);
  }

  const activeName = () => (sets.find((s) => s.id === active) || {}).name || set.title || 'Fragenset';

  // Aktives Set in die Bibliothek schreiben (verzögert, damit nicht jeder Tastendruck eine Anfrage ist)
  function scheduleSync() {
    dirty = true;
    if (!lib || !active) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 700);
  }
  function syncNow() {
    clearTimeout(syncTimer);
    syncTimer = null;
    if (!lib || !active || !dirty) return syncing;
    dirty = false;
    const id = active;
    const data = JSON.parse(JSON.stringify(set));
    syncing = syncing.then(() => lib.save(id, activeName(), data)).then(() => {
      if (lib.kind === 'server') showSaved('Auf dem Server gespeichert ✓');
    }).catch((e) => {
      dirty = true;
      showSaved(e.status === 401 ? 'Nicht gespeichert – Host-Passwort ungültig' : 'Server-Speichern fehlgeschlagen: ' + e.message, true);
      if (e.status === 401) lock(true);
    });
    return syncing;
  }

  function persist() {
    const ok = J.saveSet(set);
    if (!ok) showSaved('Speichern fehlgeschlagen – Speicher voll?', true);
    else if (!lib || lib.kind === 'local') showSaved('Gespeichert ✓');
    scheduleSync();
    return ok;
  }

  function renderSetBar() {
    const ready = !!lib;
    selectEl.innerHTML = '';
    if (!ready) {
      selectEl.add(new Option('— gesperrt —', ''));
    } else {
      sets.forEach((s) => selectEl.add(new Option(s.name, s.id, false, s.id === active)));
    }
    selectEl.disabled = !ready;
    ['setNew', 'setDup', 'setRename', 'setDel'].forEach((id) => ($(id).disabled = !ready));
    sourceEl.classList.remove('error');
    sourceEl.textContent = !ready ? '🔒 Gespeicherte Sets gesperrt'
      : lib.kind === 'server' ? '☁ Auf dem Server gespeichert' : '💾 Nur in diesem Browser gespeichert';
  }

  function lock(wrong) {
    lib = null;
    $('pwForm').hidden = false;
    $('pwError').textContent = wrong ? 'Falsches Passwort.' : '';
    renderSetBar();
  }

  async function refreshList() {
    sets = (await lib.list()).map(({ id, name }) => ({ id, name }));
  }

  // Set in den Editor (und als Arbeitskopie fürs Host-Pult) laden
  async function openSet(id) {
    await syncNow();
    const s = await lib.get(id);
    set = J.normalizeSet(s.data);
    active = id;
    dirty = false;
    J.sets.setActiveId(id);
    J.saveSet(set);
    round = 0;
    render();
    renderSetBar();
  }

  async function createSet(name, data) {
    await syncNow();
    const id = await lib.save(null, name, data);
    await refreshList();
    await openSet(id);
  }

  function askName(text, value) {
    const n = prompt(text, value);
    return n && n.trim() ? n.trim().slice(0, 60) : null;
  }

  async function connect(password) {
    sourceEl.textContent = 'Verbinde…';
    const res = await J.sets.connect(password);
    if (res.needsPassword) return lock(res.wrong);
    lib = res.lib;
    $('pwForm').hidden = true;
    await refreshList();
    active = J.sets.activeId();
    if (sets.some((s) => s.id === active)) {
      // Bibliothek ist maßgeblich (z. B. wenn das Set auf einem anderen Gerät bearbeitet wurde)
      await openSet(active);
    } else if (!sets.length || !J.sets.isBlank(set)) {
      // Erster Start bzw. eigene Fragen in diesem Browser → als Set übernehmen
      const name = J.sets.isBlank(set) ? 'Mein Fragenset' : (set.title || 'Mein Fragenset');
      await createSet(name, set);
    } else {
      await openSet(sets[0].id);
    }
  }

  async function guard(fn) {
    try {
      await fn();
    } catch (e) {
      if (e.status === 401) return lock(true);
      sourceEl.textContent = 'Fehler: ' + e.message;
      sourceEl.classList.add('error');
    }
  }

  selectEl.addEventListener('change', () => guard(() => openSet(selectEl.value)));
  $('setNew').addEventListener('click', () => guard(async () => {
    const name = askName('Name des neuen Fragensets:', 'Neues Fragenset');
    if (name) await createSet(name, J.defaultSet());
  }));
  $('setDup').addEventListener('click', () => guard(async () => {
    const name = askName('Name der Kopie:', activeName() + ' (Kopie)');
    if (name) await createSet(name, JSON.parse(JSON.stringify(set)));
  }));
  $('setRename').addEventListener('click', () => guard(async () => {
    const name = askName('Neuer Name:', activeName());
    if (!name) return;
    await syncNow();
    await lib.rename(active, name);
    await refreshList();
    renderSetBar();
  }));
  $('setDel').addEventListener('click', () => guard(async () => {
    if (!confirm(`Fragenset „${activeName()}“ endgültig löschen?`)) return;
    clearTimeout(syncTimer);
    await syncing;
    await lib.remove(active);
    active = null; // nicht beim Wechsel wieder speichern
    dirty = false;
    await refreshList();
    if (sets.length) await openSet(sets[0].id);
    else await createSet('Neues Fragenset', J.defaultSet());
  }));
  $('pwForm').addEventListener('submit', (e) => {
    e.preventDefault();
    guard(() => connect($('hostPw').value));
  });
  // Vor dem Verlassen ausstehende Änderungen noch senden
  window.addEventListener('pagehide', () => { if (syncTimer) syncNow(); });

  // Bild-Zeile pro Frage: Vorschau mit ✕, oder Link-Feld + Upload
  function imageControls(clue) {
    const wrap = document.createElement('div');
    wrap.className = 'ed-img';
    function draw() {
      wrap.innerHTML = '';
      if (clue.img) {
        const thumb = document.createElement('img');
        thumb.src = clue.img;
        thumb.alt = '';
        const del = document.createElement('button');
        del.className = 'small ghost';
        del.textContent = '✕ Entfernen';
        del.addEventListener('click', () => { clue.img = ''; delete clue.pixel; delete clue.zoom; delete clue.zoomAt; persist(); draw(); });
        // Verpixeln: Bild startet grob und wird im Spiel per Knopf schärfer
        const px = document.createElement('label');
        px.className = 'ed-pixel';
        px.title = 'Bild startet verpixelt, du machst es im Spiel schrittweise schärfer. Verlinkte Bilder lieber hochladen.';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = !!clue.pixel;
        box.addEventListener('change', () => {
          if (box.checked) { clue.pixel = true; delete clue.zoom; } else delete clue.pixel;
          persist();
          draw();
        });
        thumb.classList.toggle('pixel-preview', !!clue.pixel);
        px.append(box, ' Verpixeln');
        // Zoom: Bild startet stark herangezoomt (Bildmitte) und zoomt im Spiel stufenweise heraus
        const zm = document.createElement('label');
        zm.className = 'ed-zoom';
        zm.title = 'Bild startet als kleiner Ausschnitt (Bildmitte) und zoomt im Spiel stufenweise heraus.';
        const zbox = document.createElement('input');
        zbox.type = 'checkbox';
        zbox.checked = !!clue.zoom;
        zbox.addEventListener('change', () => {
          if (zbox.checked) { clue.zoom = true; delete clue.pixel; } else { delete clue.zoom; delete clue.zoomAt; }
          persist();
          draw();
        });
        zm.append(zbox, ' Zoom');
        wrap.append(thumb, del, px, zm);
        return;
      }
      const url = document.createElement('input');
      url.placeholder = 'Bild-Link (optional)';
      url.addEventListener('change', () => {
        const v = J.safeImg(url.value);
        if (url.value.trim() && !v) {
          url.classList.add('invalid');
          url.title = 'Link muss mit http:// oder https:// beginnen';
          return;
        }
        clue.img = v;
        persist();
        draw();
      });
      const file = document.createElement('input');
      file.type = 'file';
      file.accept = 'image/*';
      file.hidden = true;
      const up = document.createElement('button');
      up.className = 'small';
      up.textContent = '📁';
      up.title = 'Bild hochladen';
      up.addEventListener('click', () => file.click());
      file.addEventListener('change', async () => {
        const f = file.files[0];
        if (!f) return;
        up.textContent = '…';
        try {
          clue.img = await J.compressImage(f);
          if (!persist()) {
            clue.img = '';
            persist();
            alert('Das Bild passt nicht mehr in den Browserspeicher. Nutze lieber einen Bild-Link oder entferne andere hochgeladene Bilder.');
          }
        } catch (e) {
          alert(e.message);
        }
        draw();
      });
      wrap.append(url, up, file);
    }
    draw();
    return wrap;
  }

  function render() {
    titleEl.value = set.title;
    document.querySelectorAll('.tabs button').forEach((b) =>
      b.classList.toggle('primary', Number(b.dataset.round) === round)
    );
    grid.innerHTML = '';
    set.rounds[round].categories.forEach((cat, c) => {
      const col = document.createElement('div');
      col.className = 'ed-cat';
      const name = document.createElement('input');
      name.value = cat.name;
      name.placeholder = 'Kategorie';
      name.addEventListener('input', () => { cat.name = name.value; persist(); });
      col.appendChild(name);
      cat.clues.forEach((clue, row) => {
        const box = document.createElement('div');
        box.className = 'ed-clue';
        box.innerHTML = `<div class="pts">${J.pointsFor(round, row)}</div>`;
        const q = document.createElement('textarea');
        q.value = clue.q;
        q.placeholder = 'Frage / Hinweis';
        q.addEventListener('input', () => { clue.q = q.value; persist(); });
        const a = document.createElement('input');
        a.value = clue.a;
        a.placeholder = 'Antwort (nur Host)';
        a.addEventListener('input', () => { clue.a = a.value; persist(); });
        const note = document.createElement('input');
        note.className = 'note-field';
        note.value = clue.note || '';
        note.placeholder = 'Host-Notiz (optional, nur für dich)';
        note.addEventListener('input', () => { clue.note = note.value; persist(); });
        // Fragenart: normal, Schätzfrage (alle tippen eine Zahl) oder Reihenfolge (alle sortieren)
        const kind = document.createElement('select');
        kind.className = 'ed-kind';
        kind.innerHTML = '<option value="">Normale Frage</option><option value="estimate">🔢 Schätzfrage</option><option value="order">↕️ Reihenfolge</option><option value="choice">🅰️ Multiple Choice</option>';
        kind.value = clue.kind || '';
        const hintFor = () => {
          a.placeholder = clue.kind === 'estimate' ? 'Richtige Zahl, z. B. 330'
            : clue.kind === 'order' ? 'Richtige Reihenfolge: A | B | C | D'
              : clue.kind === 'choice' ? 'Richtige zuerst: Richtig | Falsch | Falsch | Falsch' : 'Antwort (nur Host)';
        };
        kind.addEventListener('change', () => {
          if (kind.value) clue.kind = kind.value; else delete clue.kind;
          hintFor();
          persist();
        });
        hintFor();
        box.append(q, a, note, kind, imageControls(clue));
        col.appendChild(box);
      });
      grid.appendChild(col);
    });
  }

  titleEl.addEventListener('input', () => { set.title = titleEl.value; persist(); });

  document.querySelectorAll('.tabs button').forEach((b) =>
    b.addEventListener('click', () => { round = Number(b.dataset.round); render(); })
  );

  document.getElementById('export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(set, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safe = (set.title || 'jeopardy').replace(/[^\w\-äöüÄÖÜß ]+/g, '').trim() || 'jeopardy';
    a.href = url;
    a.download = safe + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  const fileInput = document.getElementById('importFile');
  document.getElementById('importBtn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.rounds)) throw new Error('Kein gültiges Fragenset');
      // Unbekannte Fragearten (Datei ist neuer als diese Seite) nicht still verwerfen
      const unknown = data.rounds.flatMap((r) => (r && r.categories) || []).flatMap((c) => (c && c.clues) || [])
        .some((cl) => cl && cl.kind && !J.CLUE_KINDS.includes(cl.kind));
      if (unknown) throw new Error('Das Set nutzt Fragearten, die diese Seite noch nicht kennt. Bitte die Seite neu laden (Strg+Shift+R) und nochmal importieren.');
      const imported = J.normalizeSet(data);
      if (lib) {
        // Import legt ein neues Set an, statt das aktive zu überschreiben
        const base = file.name.replace(/\.json$/i, '');
        await createSet((imported.title && imported.title !== 'Jeopardy' ? imported.title : base).slice(0, 60), imported);
      } else {
        set = imported;
        persist();
        render();
      }
    } catch (e) {
      alert('Import fehlgeschlagen: ' + e.message);
    }
    fileInput.value = '';
  });

  document.getElementById('reset').addEventListener('click', () => {
    if (!confirm('Alle Kategorien, Fragen und Antworten löschen?')) return;
    set = J.defaultSet();
    persist();
    render();
  });

  render();
  renderSetBar();
  guard(() => connect());
})();
