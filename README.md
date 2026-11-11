# Jeopardy

**▶ Spielen: https://ghostly1337.github.io/Jeopardy/**

Browser-Jeopardy mit zwei Runden (je 6 Kategorien × 5 Felder; Runde 1: 100–500, Runde 2: 200–1000), eigenem Fragen-Editor, Host-Pult und Live-Spieleransicht – ohne Bildschirmübertragung.

## So funktioniert's

1. **Fragen bearbeiten** (`editor.html`): Kategorien, Fragen und Antworten eintragen, optional ein Bild pro Frage (Bild-Link oder 📁 hochladen; Uploads werden automatisch verkleinert). Speichert automatisch im Browser. Mit *Export* als `.json` sichern, mit *Import* wieder laden.
2. **Spiel hosten** (`host.html`): Raumcode und Beitrittslink werden angezeigt. Link an die Spieler schicken.
3. **Spieler** öffnen den Link (oder geben auf der Startseite den Code ein). Sie sehen Board, Fragen und Punktestand live – aber **nie die Antworten**, solange du sie nicht aufdeckst.

### Im Host-Pult
- Feld anklicken → Frage öffnet sich bei allen; nur du siehst die Antwort.
- Pro Spieler **✓ +Wert** (richtig, deckt Antwort auf, Feld wird verbraucht) oder **✗ −halber Wert** (falsch).
- Jeder Spieler wird pro Frage nur einmal gewertet, und nur einer kann richtig liegen. Fehler korrigierst du mit *Rückgängig*.
- **⏱ 15-s-Timer**: per Button starten, läuft bei allen sichtbar runter, Signal bei 0.
- **Buzzer zum Klauen**: Wird ein Spieler mit ✗ gewertet, öffnet sich bei allen anderen ein BUZZ-Knopf. Es zählt die **Reaktionszeit** auf dem eigenen Gerät (ab dem Erscheinen des Knopfs), nicht wessen Signal zuerst ankommt – eine langsame Internetleitung ist also kein Nachteil. Der Host sammelt dafür nach dem ersten Buzz 0,4 s lang ein. Alle sehen die Zeiten (⚡ im Host-Pult). Bei erneutem ✗ öffnet er für die Übrigen. **Geklaut bringt nur die halben Punkte** (sobald bei einer Frage schon jemand falsch lag). Manuell öffnen/schließen geht auch.
- Spieler wählen beim Beitreten ihren Namen aus deiner Liste (oder „Nur zuschauen“). Jeder Name kann nur von einem Gerät belegt werden (vergebene Namen sind ausgegraut). Ein grüner Punkt im Punkte-Panel zeigt, wer ein Gerät verbunden hat; Klick darauf trennt das Gerät und gibt den Namen frei.
- **✨ Runden-Intro**: Beim Rundenwechsel (oder per ✨-Knopf) erscheint bei allen „Runde X“, dann werden die 6 Kategorien nacheinander groß aufgedeckt und die Punktefelder ausgeteilt. Mit „Überspringen“ abkürzbar.
- **🎯 Am Zug**: Wer richtig antwortet, wählt das nächste Feld – angezeigt als Banner über dem Board und markierte Punktekachel. Mit 🎯 im Punkte-Panel manuell setzen.
- **🏆 Siegerehrung**: Podium mit Platz 1–3 (Gleichstand teilt sich den Platz), restliche Plätze darunter, Auszeichnungen (Buzzer-König, Meisterdieb, Treffsicher, Meiste Fehlversuche), Konfetti und Fanfare bei allen. „Zurück zum Spiel“ oder Rückgängig schließt sie wieder.
- **Live-Reaktionen**: Spieler tippen 😂 👏 😱 🔥 🤔 am Rand, das Emoji fliegt mit Namen bei allen über den Bildschirm.
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
