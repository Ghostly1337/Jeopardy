// Fragenset-Bibliothek im Editor: anlegen, wechseln, umbenennen, importieren, löschen.
// Über das Relay (wie auf Vercel) liegen die Sets auf dem Server hinter dem Host-Passwort,
// sonst im Browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const { TRANSPORT, HOST_PASSWORD, startEnv } = require('./helpers');

const SERVER = TRANSPORT === 'relay';
let env;
test.before(async () => { env = await startEnv(); });
test.after(async () => { await env.stop(); });

const options = (page) => page.$$eval('#setSelect option', (els) => els.map((o) => (o.selected ? '*' : '') + o.textContent));
const firstCat = (page) => page.inputValue('.ed-cat input');

async function unlock(page) {
  if (!SERVER) return;
  await page.waitForSelector('#pwForm:not([hidden])');
  await page.fill('#hostPw', HOST_PASSWORD);
  await page.click('#pwForm button');
  await page.waitForSelector('#pwForm', { state: 'hidden' });
}

// Antwort auf prompt()/confirm() beim nächsten Klick
async function clickWithDialog(page, sel, answer) {
  page.nextDialog = answer;
  await page.click(sel);
}

// Wartet, bis die verzögerte Speicherung durch ist
const settle = (page) => page.waitForTimeout(1200);

test('Fragensets verwalten und wechseln', async (t) => {
  const ed = await env.page();
  await ed.goto(env.base + '/editor.html');
  await ed.evaluate(() => localStorage.clear());
  await ed.reload();

  if (SERVER) {
    await t.test('Server verlangt das Host-Passwort', async () => {
      await ed.waitForSelector('#pwForm:not([hidden])');
      assert.ok(await ed.locator('#setNew').isDisabled());
      await ed.fill('#hostPw', 'falsch');
      await ed.click('#pwForm button');
      await ed.waitForFunction(() => document.getElementById('pwError').textContent === 'Falsches Passwort.');
    });
  }

  await t.test('Erster Start legt „Mein Fragenset“ an', async () => {
    await unlock(ed);
    await ed.waitForFunction(() => !document.getElementById('setSelect').disabled);
    assert.deepEqual(await options(ed), ['*Mein Fragenset']);
    assert.equal(await ed.textContent('#setSource'), SERVER ? '☁ Auf dem Server gespeichert' : '💾 Nur in diesem Browser gespeichert');
    await ed.fill('.ed-cat input', 'Tiere');
    await settle(ed);
  });

  await t.test('Neues Set ist leer und wird aktiv', async () => {
    await clickWithDialog(ed, '#setNew', 'Anime');
    await ed.waitForFunction(() => document.getElementById('setSelect').selectedOptions[0]?.textContent === 'Anime');
    assert.deepEqual(await options(ed), ['*Anime', 'Mein Fragenset']);
    assert.equal(await firstCat(ed), 'Kategorie 1');
    await ed.fill('.ed-cat input', 'Naruto');
    await settle(ed);
  });

  await t.test('Wechsel lädt das Set, Host-Pult übernimmt es live', async () => {
    const host = await ed.context().newPage();
    await host.goto(env.base + '/host.html');
    await host.waitForSelector('.cell.cat:text-is("Naruto")');
    await ed.selectOption('#setSelect', { label: 'Mein Fragenset' });
    await ed.waitForFunction(() => document.querySelector('.ed-cat input').value === 'Tiere');
    await host.waitForSelector('.cell.cat:text-is("Tiere")');
    await host.close();
  });

  await t.test('Nach Neuladen bleibt das aktive Set, ohne erneutes Passwort', async () => {
    await ed.reload();
    await ed.waitForFunction(() => !document.getElementById('setSelect').disabled);
    assert.deepEqual(await options(ed), ['Anime', '*Mein Fragenset']);
    assert.equal(await firstCat(ed), 'Tiere');
    assert.ok(await ed.isHidden('#pwForm'));
  });

  await t.test('Umbenennen und Duplizieren', async () => {
    await clickWithDialog(ed, '#setRename', 'Tierquiz');
    await ed.waitForFunction(() => document.getElementById('setSelect').selectedOptions[0]?.textContent === 'Tierquiz');
    await clickWithDialog(ed, '#setDup', 'Tierquiz 2');
    await ed.waitForFunction(() => document.getElementById('setSelect').options.length === 3);
    assert.deepEqual(await options(ed), ['Anime', 'Tierquiz', '*Tierquiz 2']);
    assert.equal(await firstCat(ed), 'Tiere');
  });

  await t.test('Import legt ein neues Set an', async () => {
    const data = await ed.evaluate(() => { const s = J.defaultSet(); s.title = 'Filme'; s.rounds[0].categories[0].name = 'Marvel'; return JSON.stringify(s); });
    await ed.setInputFiles('#importFile', { name: 'filme.json', mimeType: 'application/json', buffer: Buffer.from(data) });
    await ed.waitForFunction(() => document.getElementById('setSelect').selectedOptions[0]?.textContent === 'Filme');
    assert.equal(await firstCat(ed), 'Marvel');
    assert.equal((await options(ed)).length, 4);
  });

  await t.test('Löschen wechselt zum nächsten Set', async () => {
    await clickWithDialog(ed, '#setDel');
    await ed.waitForFunction(() => document.getElementById('setSelect').options.length === 3);
    assert.deepEqual(await options(ed), ['*Anime', 'Tierquiz', 'Tierquiz 2']);
    assert.equal(await firstCat(ed), 'Naruto');
  });

  if (SERVER) {
    await t.test('Anderes Gerät sieht dieselben Sets nach Passworteingabe', async () => {
      const other = await env.page();
      await other.goto(env.base + '/editor.html');
      await unlock(other);
      await other.waitForFunction(() => document.getElementById('setSelect').options.length === 3);
      assert.deepEqual((await options(other)).map((o) => o.replace('*', '')), ['Anime', 'Tierquiz', 'Tierquiz 2']);
    });
  }

  assert.deepEqual(env.errors, []);
});
