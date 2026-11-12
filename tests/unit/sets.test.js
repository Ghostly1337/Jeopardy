// Fragenset-Speicher (lib/sets-core.mjs): Host-Passwort, Speichern, Laden, Umbenennen, Löschen
const test = require('node:test');
const assert = require('node:assert/strict');

let handleSets, memorySetStore, pgSetStore, LIMITS;
test.before(async () => {
  ({ handleSets, memorySetStore, pgSetStore, LIMITS } = await import('../../lib/sets-core.mjs'));
});

const PW = 'host-geheim';
const SET = { title: 'Test', rounds: [{ categories: [] }, { categories: [] }] };

function client(store, hostPassword = PW) {
  return async (op, { body, id, pw = PW, method } = {}) => {
    const query = new URLSearchParams({ op });
    if (id) query.set('id', id);
    const headers = new Headers(pw == null ? {} : { 'x-host-password': pw });
    return handleSets({
      method: method || (body ? 'POST' : 'GET'), query, headers,
      rawBody: body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body),
    }, store, hostPassword);
  };
}

test('Ohne Datenbank oder Host-Passwort: 503, Browser nutzt lokale Liste', async () => {
  assert.equal((await client(null)('check')).status, 503);
  assert.equal((await client(memorySetStore(), '')('check')).status, 503);
  const noPw = { ...memorySetStore() };
  assert.equal((await handleSets({ method: 'GET', query: new URLSearchParams({ op: 'check' }), headers: new Headers({ 'x-host-password': PW }), rawBody: '' }, noPw, undefined)).status, 503);
});

test('Falsches oder fehlendes Host-Passwort wird abgewiesen', async () => {
  const call = client(memorySetStore());
  assert.deepEqual(await call('check', { pw: 'falsch' }), { status: 401, json: { error: 'wrong host password' } });
  assert.equal((await call('list', { pw: null })).status, 401);
  assert.equal((await call('list', { pw: '' })).status, 401);
  assert.equal((await call('save', { pw: 'falsch', body: { name: 'x', data: SET } })).status, 401);
  assert.deepEqual(await call('check'), { status: 200, json: { ok: true } });
});

test('Speichern, Liste, Laden, Überschreiben', async () => {
  const call = client(memorySetStore());
  const a = await call('save', { body: { name: '  Set   Eins ', data: SET } });
  assert.equal(a.status, 200);
  assert.match(a.json.id, /^[a-z0-9]{12}$/);
  const b = await call('save', { body: { name: 'Anime', data: SET } });

  const list = (await call('list')).json.sets;
  assert.deepEqual(list.map((s) => s.name), ['Anime', 'Set Eins'], 'sortiert, Leerzeichen bereinigt');
  assert.ok(!('data' in list[0]), 'Liste enthält keine Fragen');

  const got = await call('get', { id: a.json.id });
  assert.equal(got.json.name, 'Set Eins');
  assert.deepEqual(got.json.data, SET);

  const changed = { ...SET, title: 'Neu' };
  assert.equal((await call('save', { body: { id: b.json.id, name: 'Anime', data: changed } })).json.id, b.json.id);
  assert.equal((await call('get', { id: b.json.id })).json.data.title, 'Neu');
  assert.equal((await call('list')).json.sets.length, 2);
});

test('Umbenennen und Löschen', async () => {
  const call = client(memorySetStore());
  const { id } = (await call('save', { body: { name: 'Alt', data: SET } })).json;
  assert.equal((await call('rename', { body: { id, name: 'Neu' } })).status, 200);
  assert.equal((await call('get', { id })).json.name, 'Neu');
  assert.equal((await call('rename', { body: { id: 'gibtesnicht1', name: 'x' } })).status, 404);
  assert.equal((await call('delete', { body: { id } })).status, 200);
  assert.equal((await call('get', { id })).status, 404);
  assert.deepEqual((await call('list')).json.sets, []);
});

test('Ungültige Eingaben', async () => {
  const call = client(memorySetStore());
  assert.equal((await call('save', { body: { name: '', data: SET } })).status, 400);
  assert.equal((await call('save', { body: { name: 'x', data: { rounds: 'nein' } } })).status, 400);
  assert.equal((await call('save', { body: { id: '../etc', name: 'x', data: SET } })).status, 400);
  assert.equal((await call('save', { body: '{kaputt' })).status, 400);
  assert.equal((await call('get', { id: 'X' })).status, 400);
  assert.equal((await call('save', { method: 'GET' })).status, 405);
  assert.equal((await call('quatsch', { body: {} })).status, 404);
  const big = 'x'.repeat(LIMITS.maxBodyBytes + 1);
  assert.equal((await call('save', { body: big })).status, 413);
  const long = (await call('save', { body: { name: 'a'.repeat(200), data: SET } })).json.id;
  assert.equal((await call('get', { id: long })).json.name.length, LIMITS.maxNameLength);
});

test('Höchstzahl an Sets', async () => {
  const store = memorySetStore();
  store.count = async () => LIMITS.maxSets;
  assert.equal((await client(store)('save', { body: { name: 'x', data: SET } })).status, 409);
});

test('Postgres-Speicher: legt Tabelle einmal an und nutzt Parameter', async () => {
  const calls = [];
  const store = pgSetStore(async (text, params) => {
    calls.push({ text, params });
    if (text.startsWith('SELECT id, name, body')) return [{ id: 'abcdefgh1234', name: 'N', body: '{"rounds":[]}', updated: new Date(0) }];
    if (text.includes('RETURNING updated')) return [{ updated: new Date(0) }];
    return [];
  });
  await store.save('abcdefgh1234', 'N', '{"rounds":[]}');
  const got = await store.get('abcdefgh1234');
  assert.deepEqual(got, { id: 'abcdefgh1234', name: 'N', updated: '1970-01-01T00:00:00.000Z', data: { rounds: [] } });
  assert.equal(calls.filter((c) => c.text.startsWith('CREATE TABLE')).length, 1);
  assert.ok(calls.every((c) => !c.text.includes('abcdefgh1234')), 'Werte nur als Parameter');
});
