# Hinweise für Claude

## Quizfragen schreiben

Wenn neue Fragen, Kategorien oder Fragensets gewünscht sind:

### Schwierigkeit fest einstufen – und quer über alle Kategorien vergleichen
Jede Frage bekommt vor dem Einsortieren eine Stufe. Danach jede **Zeile** (alle 100er, alle 200er, …) über alle Kategorien vergleichen, nicht nur jede Spalte für sich. Eine 300er muss in jeder Kategorie ungefähr gleich schwer sein.

| Stufe (Board 1 / Board 2) | Wer weiß es? |
|:-:|---|
| 100 / 200 | fast jeder, auch Kinder |
| 200 / 400 | die meisten Erwachsenen |
| 300 / 600 | Allgemeinbildung, kurz überlegen |
| 400 / 800 | nur wer sich etwas auskennt |
| 500 / 1000 | nur 1–2 Leute in der Runde, oder eine faire Falle |

Board 2 (200–1000) ist insgesamt schwerer als Board 1.

### Typische Fehler (aus echtem Spiel-Feedback)
- **„Standardwissen“ unterschätzt:** Die Eule als Tier, das den Kopf extrem weit drehen kann, war als 500 eingeplant – das weiß aber jeder (eher 100). Bei jeder Frage fragen: *Wie viele in einer Freundesrunde wüssten das sofort?*
- **Populäres ist leicht:** Gangnam Style, Matrix, Biene Maja, „I have a dream“ sind niedrige Stufen, egal wie „wichtig“ sie klingen.
- **Ratbarkeit:** Zahlen mit wenigen sinnvollen Möglichkeiten (z. B. ein Jahr nahe am Erscheinen) und offensichtliche Bezüge (Judo → Japan) sind leichter, als sie wirken.
- **Nischenwissen ist schwer:** Begriffe aus dem American Football, Fachbegriffe, Jahreszahlen ohne Bezug.
- **Umstrittene Antworten vermeiden** (z. B. längster Fluss: Nil oder Amazonas).

### Form
- Hinweis (`q`) und Antwort (`a`) kurz; zulässige Varianten und Fallen in die **Host-Notiz** (`note`) – die sehen Spieler nie.
- Fakten mit Quellen belegen; keine Songtexte abschreiben (Urheberrecht) – bei „Vervollständige den Songtext“ nur Song und Stelle nennen.
- Spielergruppe: Anfang 20, Gaming/Anime/Popkultur/Musik, deutschsprachig.

## Projekt
- Statische Seite (HTML/CSS/JS) + Vercel-Funktionen in `api/`, Logik für Tests in `lib/`.
- Tests: `npm test` (Unit + Browser über WebRTC), `npm run test:e2e:relay` (Browser über das Relay). CI führt beides aus.
- Quizfragen nie ins Repo committen (öffentlich, Spieler könnten Antworten finden).

## Geplant: Fragenpool mit Würfel-Modus (noch nicht gebaut)
Idee des Nutzers, umsetzen sobald genug Fragen da sind (Ziel: 3–4 Fragen pro Stufe in den Hauptkategorien).
- Pool-JSON (liegt beim Nutzer, nicht im Repo): `{ "type": "pool", "version": 1, "title", "levels", "categories": [{ "name", "clues": [{ "level": 1–5, "q", "a", "note", "img", "source" }] }] }`.
  Stufe statt Punktzahl: Stufe 1 = Board 1 100 / Board 2 200 … Stufe 5 = 500 / 1000 (Tabelle oben).
- Erster Pool (Nov 2026): 145 Fragen, 28 Kategorien aus Set 1–3; „Logo-Quiz“ + „Marken & Logos“ → „Logos & Marken“. Set 1 und 3 sind schon gespielt. Mythologie/Mathe 1000 dort noch alte Version – Nutzer hat eigene im Browser.
- Umsetzung: Pool als Set-Art in der Bibliothek; „🎲 Board würfeln“ im Editor wählt 6 Kategorien und je eine Frage pro Stufe, Ergebnis ist ein normales Set (Host-Pult unverändert); 🎲 pro Feld zum Neuwürfeln; gespielte Fragen markieren und beim Würfeln überspringen; Listenansicht statt 6×5-Raster; Bilder lieber als Links (4 MB pro Set).
