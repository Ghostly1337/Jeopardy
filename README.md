# Jeopardy

**▶ Spielen: https://ghostly1337.github.io/Jeopardy/**

Browser-Jeopardy mit zwei Runden (je 6 Kategorien × 5 Felder; Runde 1: 100–500, Runde 2: 200–1000), eigenem Fragen-Editor, Host-Pult und Live-Spieleransicht – ohne Bildschirmübertragung.

## So funktioniert's

1. **Fragen bearbeiten** (`editor.html`): Kategorien, Fragen und Antworten eintragen. Speichert automatisch im Browser. Mit *Export* als `.json` sichern, mit *Import* wieder laden.
2. **Spiel hosten** (`host.html`): Raumcode und Beitrittslink werden angezeigt. Link an die Spieler schicken.
3. **Spieler** öffnen den Link (oder geben auf der Startseite den Code ein). Sie sehen Board, Fragen und Punktestand live – aber **nie die Antworten**, solange du sie nicht aufdeckst.

### Im Host-Pult
- Feld anklicken → Frage öffnet sich bei allen; nur du siehst die Antwort.
- Pro Spieler **✓ +Wert** (richtig, deckt Antwort auf, Feld wird verbraucht) oder **✗ −halber Wert** (falsch).
- Jeder Spieler wird pro Frage nur einmal gewertet, und nur einer kann richtig liegen. Fehler korrigierst du mit *Rückgängig*.
- **Sounds** beim Öffnen, Aufdecken, Richtig und Falsch – bei dir und bei allen Spielern. Abschaltbar im Host-Pult; Spieler tippen einmal auf „Ton aktivieren“ (Browser-Vorgabe).
- *Antwort aufdecken*, *Fertig → zurück zum Board*, *Abbrechen (Feld bleibt frei)*.
- Punkte direkt ins Zahlenfeld tippen oder ±100. Namen anklicken zum Umbenennen.
- **Rückgängig** (oder Strg+Z) macht jede Aktion schrittweise rückgängig, inkl. Punkte und Felder.
- Bereits gespieltes Feld anklicken → wieder freigeben.
- Fragen im Editor-Tab ändern → wird sofort übernommen.
- **Farbschema** wählen (Graphit, Hell, Nacht, Wald, Klassisch) – gilt auch sofort bei allen Spielern.

Spielstand und Fragen liegen im `localStorage` deines Browsers. Ein Reload verliert nichts, Spieler verbinden sich automatisch neu.

## Technik
Reines HTML/CSS/JS ohne Build. Live-Sync per WebRTC über [PeerJS](https://peerjs.com/) und dessen kostenlosen öffentlichen Vermittlungsserver. Dein Browser ist die einzige Datenquelle; die Spieler bekommen nur einen gefilterten Stand ohne Antworten.

Einschränkung: In stark abgeschotteten Netzen (manche Firmen-/Schul-WLANs) kann WebRTC blockiert sein.

## Veröffentlichen (GitHub Pages)
Repo → *Settings* → *Pages* → *Source: GitHub Actions*. Der Workflow `.github/workflows/pages.yml` deployt danach bei jedem Push auf den Default-Branch.

Lokal testen: `python3 -m http.server` im Repo-Ordner, dann `http://localhost:8000` öffnen.
