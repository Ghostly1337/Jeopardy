# Jeopardy

**▶ Spielen: https://ghostly1337.github.io/Jeopardy/**

Browser-Jeopardy mit zwei Runden (je 6 Kategorien × 5 Felder; Runde 1: 100–500, Runde 2: 200–1000), eigenem Fragen-Editor, Host-Pult und Live-Spieleransicht – ohne Bildschirmübertragung. Einzelspieler- und Team-Modus.

## So funktioniert's

1. **Fragen bearbeiten** (`editor.html`): Kategorien, Fragen und Antworten eintragen, optional eine **Host-Notiz** (z. B. „auch richtig: …“ – sieht nur der Host, auch nach dem Aufdecken nicht die Spieler) und ein Bild pro Frage (Bild-Link oder 📁 hochladen; Uploads werden automatisch verkleinert). Speichert automatisch im Browser. Mit *Export* als `.json` sichern, mit *Import* wieder laden.
2. **Spiel hosten** (`host.html`): Raumcode und Beitrittslink werden angezeigt. Link an die Spieler schicken.
3. **Spieler** öffnen den Link (oder geben auf der Startseite den Code ein). Sie sehen Board, Fragen und Punktestand live – aber **nie die Antworten**, solange du sie nicht aufdeckst.

### Spielmodi
- **Einzelspieler**: Du legst Spieler an, jeder wählt am Handy seinen Namen. Ein Name gehört genau einem Gerät (vergebene Namen sind ausgegraut).
- **Teams**: Umschalter *Einzel / Teams* im Punkte-Panel. Du legst Teams an und stellst die **Teamgröße** ein (gilt für alle Teams). Spieler wählen am Handy ihr Team und geben ihren eigenen Namen ein; volle Teams sind ausgegraut. Punkte zählen nur fürs Team, jedes Mitglied kann fürs Team buzzern. Wer kein Handy hat, spielt einfach im Team mit.
- **📺 TV-Ansicht**: Für Laptop/Fernseher, auf den alle schauen. Großes Board ohne Bedienelemente, mit Vollbild und Sound. **👀 Nur zuschauen** gibt es auch.

### Im Host-Pult
- Feld anklicken → Frage öffnet sich bei allen; nur du siehst die Antwort.
- Pro Spieler/Team **✓ +Wert** (richtig) oder **✗ −halber Wert** (falsch). Jeder wird pro Frage nur einmal gewertet, nur einer kann richtig liegen. Fehler korrigierst du mit *Rückgängig*.
- **Buzzer zum Klauen**: Nach einem ✗ öffnet sich der Buzzer – nach einer **zufälligen Pause** (0,5–1,5 s) – für alle, die noch nicht gewertet wurden. **Geklaut bringt nur die halben Punkte.**
  - Der Buzzer ist während der Frage **immer sichtbar**, aber grau („Noch nicht“), solange er zu ist. Wer zu früh drückt, ist **1 Sekunde gesperrt** – Dauer-Hämmern sperrt sich also selbst aus.
  - Es zählt die **Reaktionszeit** auf dem eigenen Gerät, nicht wessen Signal zuerst ankommt: Eine langsame Internetleitung ist kein Nachteil. Reaktionen unter 0,1 s gelten als Frühstart.
  - Manuell öffnen/schließen geht auch.
- **🎯 Am Zug** geht **reihum** in der Reihenfolge der Punkte-Liste, jeweils wenn eine Frage mit *Fertig* abgeschlossen wird (*Abbrechen* lässt den Zug beim selben). Mit 🎯 setzt du ihn manuell.
- **⏱ 15-s-Timer**: per Button, läuft bei allen sichtbar runter, Signal bei 0.
- **✨ Runden-Intro**: Beim Rundenwechsel (oder per ✨) erscheint „Runde X“, dann werden die Kategorien einzeln aufgedeckt. Mit „Überspringen“ abkürzbar.
- **🏆 Siegerehrung**: Podium (Gleichstand teilt sich den Platz), Auszeichnungen (Buzzer-König, Meisterdieb, Treffsicher, Meiste Fehlversuche – im Team-Modus ist der Buzzer-König eine Person), Konfetti und Fanfare.
- **Live-Reaktionen**: Spieler tippen 😂 👏 😱 🔥 🤔, das Emoji fliegt mit Namen bei allen über den Bildschirm (am Handy hinter dem 😀-Knopf).
- **Sounds** bei allen, abschaltbar. Spieler tippen einmal auf „Ton aktivieren“ (Browser-Vorgabe).
- **Punkte-Animation**: „+500“ / „−250“ erscheint bei allen kurz über der Punktekachel.
- Punkte direkt eintippen oder ±100. **Rückgängig** (Strg+Z) macht jede Aktion schrittweise rückgängig.
- Grüner Punkt im Punkte-Panel = Gerät verbunden; Klick darauf trennt es.
- **Farbschema** (Graphit, Hell, Nacht, Wald, Klassisch) gilt sofort bei allen.

Spielstand und Fragen liegen im `localStorage` deines Browsers. Ein Reload verliert nichts, Spieler verbinden sich automatisch neu. Das Host-Pult prüft regelmäßig, ob es für neue Spieler erreichbar ist, und meldet sich sonst neu an (wichtig, wenn du am Handy hostest und kurz die App wechselst).

## Technik
Reines HTML/CSS/JS ohne Build. Live-Sync per WebRTC über [PeerJS](https://peerjs.com/) und dessen kostenlosen öffentlichen Vermittlungsserver. Dein Browser ist die einzige Datenquelle; die Spieler bekommen nur einen gefilterten Stand ohne Antworten.

### Verbindungshilfe (Uni-/Firmen-WLAN)
Bleiben Spieler bei „Verbinde mit dem Spiel…“ hängen, blockiert das Netz direkte Verbindungen – typisch, wenn alle im selben Uni-WLAN sind. Die Spielerseite zeigt das nach einigen Sekunden an. Lösung: Im Host-Pult unter **🛜 Verbindungshilfe** einen TURN-Zugang eintragen (z. B. kostenlos von [Metered](https://www.metered.ca/stun-turn): Adressen, Benutzername, Passwort; am besten mit `turns:…:443`, das kommt durch fast jede Firewall). Der Zugang wird nur im Browser des Hosts gespeichert und im `#`-Teil des Beitrittslinks an die Spieler weitergegeben – er landet nicht im Code und nicht auf einem Server. Danach den Link neu verschicken.

## Tests

```bash
npm ci
npx playwright install chromium   # einmalig
npm test                          # Unit- und Browser-Tests
npm run test:unit                 # nur Spiellogik (Sekunden, kein Browser)
npm run test:e2e                  # nur Browser-Tests
```

- **Unit-Tests** (`tests/unit/`, `node:test`): Spielregeln aus `js/common.js` – Punkte, halbe Punkte beim Klauen, Reihenfolge, Frühstart-Regeln, Buzzer-Auswertung, Teamgröße, Rangliste, Auszeichnungen, und dass der öffentliche Spielstand **nie Antworten** enthält.
- **Browser-Tests** (`tests/e2e/`, Playwright): Host und mehrere Spieler in echten Browsern, verbunden über einen lokal gestarteten Vermittlungsserver (kein Internet nötig). Abgedeckt: Spielablauf, Host-Notizen, Punkte-Animation, Buzzer inkl. Anti-Spam und fairer Reaktionszeit, Team-Modus, Namensvergabe, TV-Ansicht, Bilder, Siegerehrung, Runden-Intro, Handy-Layout (360/390 px) Wiederverbinden nach stillem Verbindungsabbruch und die Verbindungshilfe: Direkte Verbindungen werden verboten, ein lokaler TURN-Server (`node-turn`) muss übernehmen.
- Screenshots der Handy-Ansicht: `SHOTS=./shots npm run test:e2e`.

## CI und Veröffentlichung
`.github/workflows/ci.yml` führt bei jedem Push und Pull Request alle Tests aus. **Nur wenn alle grün sind**, wird der Default-Branch auf GitHub Pages veröffentlicht (Repo → *Settings* → *Pages* → *Source: GitHub Actions*).

Lokal ansehen: `python3 -m http.server` im Repo-Ordner, dann `http://localhost:8000` öffnen.
