(function () {
  let set = J.loadSet();
  let round = 0;
  const grid = document.getElementById('grid');
  const titleEl = document.getElementById('title');
  const savedEl = document.getElementById('saved');
  let savedTimer;

  function persist() {
    J.saveSet(set);
    savedEl.textContent = 'Gespeichert ✓';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (savedEl.textContent = ''), 1200);
  }

  function render() {
    titleEl.value = set.title;
    document.querySelectorAll('.tabs button').forEach((b) =>
      b.classList.toggle('gold', Number(b.dataset.round) === round)
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
        box.append(q, a);
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
      set = J.normalizeSet(data);
      persist();
      render();
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
})();
