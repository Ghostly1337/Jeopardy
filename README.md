# Jeopardy

**▶ Spielen: https://jeopardy.prächtigames.de** (eigener Server mit WebSocket-Relay – klappt in jedem Netz, auch im Uni-WLAN; Passwort nötig)

Browser-Jeopardy mit zwei Runden (je 6 Kategorien × 5 Felder; Runde 1: 100–500, Runde 2: 200–1000), eigenem Fragen-Editor, Host-Pult und Live-Spieleransicht – ohne Bildschirmübertragung. Einzelspieler- und Team-Modus.

## So funktioniert's

1. **Fragen bearbeiten** (`editor.html`): Kategorien, Fragen und Antworten eintragen, optional eine **Host-Notiz** (z. B. „auch richtig: …“ – sieht nur der Host, auch nach dem Aufdecken nicht die Spieler) und ein Bild pro Frage (Bild-Link oder 📁 hochladen; Uploads werden automatisch verkleinert). Mit dem Häkchen **Verpixeln** startet das Bild grob verpixelt; im Host-Pult machst du es mit **🔍 Schärfer** in vier Stufen deutlicher, beim Aufdecken ist es klar. Bei verpixelten Bildern gilt **Buzzer-Rennen**: Der Buzzer öffnet sofort für alle, wer das Bild zuerst erkennt, darf antworten (volle Punkte; nach einem Fehler wie gewohnt Klauen für die halben). Sonst könnte der Spieler am Zug einfach warten, bis das Bild scharf ist. Die Spieler bekommen bis dahin nur ein Mini-Bild aus wenigen Pixeln – das Original lässt sich also nicht heimlich öffnen. Verlinkte Bilder klappen nur, wenn die Seite das erlaubt (z. B. Wikimedia); sonst das Bild hochladen. Speichert automatisch. Mit *Export* als `.json` sichern, mit *Import* als neues Fragenset laden.
   - **Mehrere Fragensets**: Oben im Editor zwischen Sets wechseln, neue anlegen, duplizieren, umbenennen, löschen. Das gewählte Set spielt das Host-Pult (auch live, wenn es im anderen Tab offen ist). Mit Server liegen die Sets dort in der Datenbank, geschützt durch ein eigenes **Host-Passwort** (Spieler kennen nur das Seitenpasswort und kommen so nicht an die Antworten); ohne Server nur im eigenen Browser.
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
- **Besondere Fragearten** (im Editor pro Feld einstellbar):
  - 🔍 **Zoom-Bild** (Häkchen „Zoom“ beim Bild): startet als kleiner Ausschnitt (ein Zwölftel der Bildbreite) und zoomt mit 🔍 in vier Stufen heraus; Buzzer-Rennen wie bei verpixelten Bildern. Spieler bekommen nur den Ausschnitt. Der Startpunkt ist die Bildmitte (in der JSON per `"zoomAt": {"x": 0.3, "y": 0.6}` änderbar).
  - 🔢 **Schätzfrage** (Antwort = Zahl): Alle tippen gleichzeitig am Handy eine Zahl, die Tipps bleiben bis zum Auflösen geheim. Wer am nächsten dran ist (bei Gleichstand alle), bekommt die Punkte – kein Abzug für die anderen. Ergebnisliste auf allen Bildschirmen.
  - ↕️ **Reihenfolge** (Antwort = `A | B | C | D` in richtiger Reihenfolge): Alle sehen die Begriffe gemischt und sortieren sie am Handy mit ▲▼. Wer komplett richtig liegt, bekommt die Punkte; wer falsch oder gar nicht abgibt, verliert den halben Wert.
  - 🅰️ **Multiple Choice** (Antwort = `Richtig | Falsch | Falsch | Falsch`, die richtige zuerst): Alle wählen am Handy, die Optionen erscheinen gemischt. Nach dem Auflösen sieht man, wer was gewählt hat; alle Richtigen bekommen die Punkte; falsch oder gar nicht abgeben kostet den halben Wert (Enthalten gibt es nicht).
  Im Team-Modus sind alle Handys eines Teams dabei wie ein gemeinsames Gerät: Verschieben, Tippen und Wählen erscheinen sofort bei allen im Team (auch nach Neuladen), das andere Team sieht nichts.
  Bei Schätzfrage, Reihenfolge und Multiple Choice gibt es keinen Buzzer und keine Joker; du drückst „Auflösen & Punkte vergeben“ (Rückgängig möglich).
- **🎵 Audio-/Video-Clips** (Editor: Link oder 🎵 Upload pro Frage): Der Clip läuft auf allen Geräten – Host, Handys, Laptops, TV –, der Host steuert ▶/⏸/↺ für alle, jeder kann bei sich stumm schalten. Blockiert ein Browser das automatische Abspielen, erscheint „▶ Tippen zum Abspielen“. Erlaubt sind `https://`-Links oder Uploads (Audio bis 1,5 MB, Video bis 2 MB); Links sind besser, weil Uploads an jedes Gerät übertragen werden und das Set größer machen. Externe Links laden die Geräte der Spieler direkt vom fremden Server.
- **🎯 Punkteverteilung** (Host-Pult unter „Spiel“): Wer am Zug ist, bekommt volle Punkte; alle anderen, die richtig liegen, nur einen Anteil (100 / 75 / 50 / 25 / 0 %, Standard 50 %). Gilt für Multiple Choice, Reihenfolge, Schätzfrage und das Ziel von „Weitergeben“. Klauen (halb), Abzüge und „Doppelt oder nichts“ bleiben gleich; ist niemand am Zug, gibt es für alle volle Punkte. Nach dem ersten Feld gesperrt, „Spielstand zurücksetzen“ gibt sie frei.
- **🃏 Joker** (jeder Spieler bzw. jedes Team hat jeden Joker einmal pro Spiel – über beide Runden; eingesetzt am Handy per Doppeltipp):
  - Einsetzen darf nur, **wer gerade dran ist**: wer am Zug ist (vor der ersten Antwort), wer gebuzzert hat oder wem die Frage weitergegeben wurde. Pro Frage höchstens **ein Joker pro Person/Team**.
  - 🎲 **Doppelt oder nichts**: richtig = doppelte Punkte, falsch = voller Abzug statt halber.
  - 💡 **Tipp**: erscheint nur auf dem eigenen Handy. Was er zeigt, stellst du im Editor pro Frage ein: Anfangsbuchstaben + Länge („M _ _ _   L _ _ _“, Standard), nur die Länge, nur der erste Buchstabe, erster und letzter Buchstabe, Anzahl der Wörter, ein eigener Tipp-Text oder „Kein Tipp möglich“ (dann ist der Joker für diese Frage gesperrt). Die Vorschau unter der Auswahl zeigt, was der Spieler sieht. Ziffern werden nie verraten.
  - 👉 **Weitergeben**: Wer am Zug ist, gibt die Frage vor der ersten Antwort an jemand anderen weiter; der muss antworten.
  Die TV-Ansicht kündigt eingesetzte Joker groß an, das Host-Pult zeigt sie bei der Frage, Rückgängig gibt den Joker zurück.
- **🎯 Am Zug** geht **reihum** in der Reihenfolge der Punkte-Liste, jeweils wenn eine Frage mit *Fertig* abgeschlossen wird (*Abbrechen* lässt den Zug beim selben). Mit 🎯 setzt du ihn manuell.
- **⏱ 15-s-Timer**: per Button, läuft bei allen sichtbar runter, Signal bei 0.
- **✨ Runden-Intro**: Beim Rundenwechsel (oder per ✨) erscheint „Runde X“, dann werden die Kategorien einzeln aufgedeckt. Mit „Überspringen“ abkürzbar.
- **📱 QR-Code zum Beitreten**: im Host-Pult neben dem Link (antippen vergrößert), in der TV-Ansicht groß bis zum Spielstart (QR-Taste blendet ihn wieder ein). Offline erzeugt, kein externer Dienst sieht den Link.
- **🏆 Siegerehrung**: Podium (Gleichstand teilt sich den Platz), Auszeichnungen (Buzzer-König, Meisterdieb, Treffsicher, Meiste Fehlversuche – im Team-Modus ist der Buzzer-König eine Person), Konfetti und Fanfare.
- **Live-Reaktionen**: Spieler tippen 😂 👏 😱 🔥 🤔, das Emoji fliegt mit Namen bei allen über den Bildschirm (am Handy hinter dem 😀-Knopf).
- **Animationen**: Die Frage wächst aus dem angeklickten Feld heraus, richtig leuchtet grün, falsch wackelt rot, Punktestände zählen hoch. Auf der TV-Ansicht erscheint, wer gebuzzert hat, kurz groß mit Blitz.
- **Musik** (nur TV-Ansicht und Host-Pult, damit die Handys nicht durcheinander spielen): beim 15-s-Timer Uhr-Ticken mit Herzschlag und Piepsern bei 3-2-1.
- **Sounds** bei allen, abschaltbar. Spieler tippen einmal auf „Ton aktivieren“ (Browser-Vorgabe).
- **Punkte-Animation**: „+500“ / „−250“ erscheint bei allen kurz über der Punktekachel.
- Punkte direkt eintippen oder ±100. **Rückgängig** (Strg+Z) macht jede Aktion schrittweise rückgängig.
- Grüner Punkt im Punkte-Panel = Gerät verbunden; Klick darauf trennt es.
- **Farbschema** (Graphit, Hell, Nacht, Wald, Klassisch) gilt sofort bei allen.

Spielstand und Fragen liegen im `localStorage` deines Browsers. Ein Reload verliert nichts, Spieler verbinden sich automatisch neu. Das Host-Pult prüft regelmäßig, ob es für neue Spieler erreichbar ist, und meldet sich sonst neu an (wichtig, wenn du am Handy hostest und kurz die App wechselst).

## Technik
Reines HTML/CSS/JS ohne Build. Live-Sync per WebRTC über [PeerJS](https://peerjs.com/) und dessen kostenlosen öffentlichen Vermittlungsserver. Dein Browser ist die einzige Datenquelle; die Spieler bekommen nur einen gefilterten Stand ohne Antworten.

Einschränkung: In stark abgeschotteten Netzen (z. B. alle im selben Uni-WLAN) kommt keine direkte WebRTC-Verbindung zustande. Dafür gibt es zwei Lösungen: den **eigenen Server** (WebSocket-Relay, so läuft das Spiel) oder – nur bei WebRTC, z. B. lokal – die **Verbindungshilfe** (TURN).

## Eigener Server (Coolify) – schnelles WebSocket-Relay
`server.mjs` ersetzt Vercel: Passwort-Sperre (derselbe Code wie `middleware.js`), Login, Fragensets und dazu ein **WebSocket-Relay** unter `/api/ws` (`lib/ws-hub.mjs`). Statt Long-Polling bleibt die Verbindung offen; Nachrichten brauchen lokal 1–3 ms statt 70–130 ms (`npm run test:load`, 30 Spieler). Das HTTP-Relay bleibt als Notlösung erreichbar. Die Seite erkennt den eigenen Server selbst (`ping` meldet `ws: true`).

- Start: `npm start` (Port 3000) oder das `Dockerfile` (läuft als unprivilegierter Benutzer, nur Laufzeitdateien).
- Umgebungsvariablen: `JEOPARDY_PASSWORD` (Pflicht), `JEOPARDY_HOST_PASSWORD`, `JEOPARDY_GAME_PASSWORD`, `DATABASE_URL` (Postgres für Fragensets und Passwortsperre; ohne: keine Server-Sets, Sperre im Speicher), `TRUST_PROXY=1` **nur** hinter Coolify/Traefik (sonst zählt die echte Verbindungs-IP, gefälschte `X-Forwarded-For` werden ignoriert).
- Coolify: Application aus GitHub, Build Pack **Dockerfile**, Port 3000, Domain eintragen. Variablen als Runtime-Variablen (keine Build-Variablen nötig).
- Schutz: WebSocket nur mit gültigem Login-Cookie und nur von der eigenen Seite (Origin-Prüfung); Spieler-Nachrichten max. 32 KB und 600/min, max. 60 Verbindungen pro IP, Spielleiter-Passwort mit Sperre pro IP, Verbindungs-ID nur mit passendem Schlüssel – wie beim HTTP-Relay.

## Früher: Hosting auf Vercel (HTTP-Relay)
Bis November 2026 lief das Spiel auf Vercel. Der Code dafür ist noch da und funktioniert weiter (z. B. als Notlösung); gespielt wird aber auf dem eigenen Server (Abschnitt oben).

Auf Vercel läuft die Verbindung nicht per WebRTC, sondern über ein kleines **HTTP-Relay** (`api/relay.mjs`): Host und Spieler schicken ihre Nachrichten per HTTPS an eine Vercel Function, die sie in einer Postgres-Datenbank (Neon, Region Frankfurt) zwischenlagert und per Long-Polling ausliefert. Das funktioniert in jedem Netz, in dem normale Webseiten gehen. Die Seite erkennt das Relay selbst (`api/relay?op=ping`); lokal (ohne Relay) bleibt es bei WebRTC.

- **Passwort**: `middleware.js` sperrt die ganze Seite. Die Login-Seite schickt das Passwort an `api/login.mjs`; dort wird es mit Sperre pro IP geprüft (5 Versuche pro Minute, danach 1 Minute gesperrt, jede weitere Sperre doppelt so lang bis 15 Minuten; gespeichert wird nur ein Hash der IP) und ein **signiertes Cookie** gesetzt (30 Tage gültig, verrät nichts über das Passwort). Passwort ändern = alle müssen es neu eingeben. Die Middleware hat bewusst **keine Importe** (Vercel kompiliert sie zu CommonJS).
- **Datenbank**: Neon-Integration im Vercel-Marketplace (`vercel integration add neon`); sie setzt `DATABASE_URL`. Die Tabellen `jeop_rooms`/`jeop_msgs` legt das Relay selbst an. Nachrichten werden nach 10 Minuten gelöscht, Räume nach 2 Tagen ohne Host.
- **Spielleiter-Passwort** (optional, `JEOPARDY_GAME_PASSWORD`): Ist es gesetzt, vergibt das Relay einen Raum nur mit diesem Passwort (oder dem Host-Passwort). Spieler mit dem Seitenpasswort können dann weder selbst hosten noch einen Raum übernehmen, dessen Host kurz weg ist. Das Host-Pult fragt einmal danach und merkt es sich nur für den Tab. Wer nur das Spielleiter-Passwort kennt, kommt nicht an die gespeicherten Sets.
- **Fragensets** (`api/sets.mjs`): Liegen in der Tabelle `jeop_sets` derselben Datenbank. Jede Anfrage braucht das Host-Passwort aus `JEOPARDY_HOST_PASSWORD` (Header `x-host-password`). Ist es nicht gesetzt, speichert der Editor nur im Browser.
- **Fairer Buzzer**: Übers Relay sammelt der Host nach dem ersten Buzz 0,9 s statt 0,4 s, weil HTTP-Nachrichten ungleichmäßiger ankommen. Es zählt weiterhin die Reaktionszeit auf dem Gerät.

Einrichten (einmalig, mit [Vercel CLI](https://vercel.com/docs/cli)):

```bash
vercel link
vercel integration add neon --meta region=fra1
vercel env add JEOPARDY_PASSWORD production
vercel env add JEOPARDY_HOST_PASSWORD production
vercel env add JEOPARDY_GAME_PASSWORD production   # optional: nur wer es kennt, darf hosten
vercel deploy --prod
```

### Verbindungshilfe (nur WebRTC, z. B. lokal)
Bleiben Spieler bei „Verbinde mit dem Spiel…“ hängen, blockiert das Netz direkte Verbindungen – typisch, wenn alle im selben Uni-WLAN sind. Die Spielerseite zeigt das nach einigen Sekunden an. Lösung: Im Host-Pult unter **🛜 Verbindungshilfe** einen TURN-Zugang eintragen (z. B. kostenlos von [Metered](https://www.metered.ca/stun-turn): Adressen, Benutzername, Passwort; am besten mit `turns:…:443`, das kommt durch fast jede Firewall). Der Zugang wird nur im Browser des Hosts gespeichert und im `#`-Teil des Beitrittslinks an die Spieler weitergegeben – er landet nicht im Code und nicht auf einem Server. Danach den Link neu verschicken.

## Sicherheit
- **Alles von außen ist Text:** Fragen, Namen, Tipps und alles, was übers Netz kommt, wird vor der Anzeige escaped; Farben, Zahlen und Bild-Adressen werden geprüft (`safeColor`, `safeNum`, `safeImg`). Bilder nur über `https://` oder als Bilddaten (kein SVG, kein `javascript:`).
- **Content-Security-Policy** auf allen Seiten (als `<meta>` in jeder Seite): nur eigene Skripte, keine Inline-Skripte, keine Plugins. Selbst eine übersehene Lücke könnte so keinen fremden Code ausführen.
- **Clips:** nur `https://`-Links oder `data:audio/…`/`data:video/…` (base64) in erlaubter Größe – geprüft im Editor, beim Import und noch einmal auf jedem Spielergerät; nie über `innerHTML`. Das Relay bündelt nach Größe und begrenzt Antworten, damit große Clips nicht an den Vercel-Limits scheitern.
- **Keine fremden Skripte:** PeerJS und der QR-Generator liegen in `vendor/` (bytegleich mit den npm-Paketen, per Test geprüft), kein CDN.
- **Buzzer fälschungssicher:** Die Reaktionszeit vom Handy ist nur eine Angabe. Der Host misst selbst die Zeit seit dem Öffnen und per Ping die Netzwerk-Verzögerung jedes Geräts; eine Angabe deutlich unter „Messung minus Netz“ wird hochgesetzt (Spielraum gedeckelt: WebRTC 300 ms, Relay 900 ms). Wer per Entwicklertools „101 ms“ schickt, gewinnt so nicht mehr.
- **Host prüft jede Spieler-Nachricht** (Form, Länge, Typ) und drosselt Fluten (40 Nachrichten pro Sekunde und Gerät, Emojis eigene Sperre).
- **Vercel:** Middleware liefert nur Laufzeitdateien aus (Tests, `lib/`, `node_modules/`, Konfiguration und Doku → 404). Seiten-, Host- und Spielleiter-Passwort: Sperre pro IP nach 5 Fehlversuchen (wachsend bis 15 Minuten, `lib/throttle.mjs`, Datenbank-Tabelle `jeop_throttle`), Vergleich in konstanter Zeit, signiertes Login-Cookie.
- **Relay:** Spieler beweisen den Besitz ihrer Verbindungs-ID (ID = Hash eines geheimen Schlüssels, der nur auf dem Gerät liegt) – niemand kann mit fremder ID senden oder fremde Tipps mitlesen. Limits: Spieler-Anfragen höchstens 32 KB, 600 Nachrichten pro Minute und Verbindung, 3000 pro IP, 30 neue Räume pro Stunde und IP, höchstens 1000 gespeicherte Nachrichten pro Raum; der Host nimmt höchstens 60 Geräte an. Header: CSP `frame-ancestors 'none'`, `X-Frame-Options`, HSTS, `Permissions-Policy`, `nosniff`.
- **Keine GitHub-Pages-Variante mehr:** Sie lief ohne Passwort, und wer den Raumcode kannte, konnte einen offline gegangenen Host ersetzen. Gespielt wird nur noch über den eigenen Server.
- **Zufall** für Raumcodes und das Mischen der Antworten kommt aus Web Crypto.
- Die CI bricht bei bekannten Lücken in Laufzeit-Abhängigkeiten ab (`npm audit --omit=dev`).

## Tests

```bash
npm ci
npx playwright install chromium   # einmalig
npm test                          # Unit- und Browser-Tests
npm run test:unit                 # nur Spiellogik (Sekunden, kein Browser)
npm run test:e2e                  # nur Browser-Tests (WebRTC)
npm run test:e2e:relay            # Browser-Tests über das HTTP-Relay (wie auf Vercel)
npm run test:e2e:ws               # Browser-Tests über das WebSocket-Relay (eigener Server)
npm run test:load                 # Lasttest: 1 Host + 30 Spieler, WebSocket gegen HTTP-Relay
```

- **Unit-Tests** (`tests/unit/`, `node:test`): Spielregeln aus `js/common.js` – Punkte, halbe Punkte beim Klauen, Reihenfolge, Frühstart-Regeln, Buzzer-Auswertung, Teamgröße, Rangliste, Auszeichnungen, und dass der öffentliche Spielstand **nie Antworten** enthält. Außerdem Relay, Passwortsperre und Fragenset-Speicher (Host-Passwort, Speichern/Laden/Löschen, Eingabeprüfung).
- **Browser-Tests** (`tests/e2e/`, Playwright): Host und mehrere Spieler in echten Browsern, verbunden über einen lokal gestarteten Vermittlungsserver (kein Internet nötig). Abgedeckt: Spielablauf, Host-Notizen, Punkte-Animation, Buzzer inkl. Anti-Spam und fairer Reaktionszeit, Team-Modus, Namensvergabe, TV-Ansicht, Bilder, verpixelte Bilder, Siegerehrung, Runden-Intro, Handy-Layout (360/390 px) Fragenset-Bibliothek (anlegen, wechseln, Import, Löschen; übers Relay mit Host-Passwort und zweitem Gerät), Wiederverbinden nach stillem Verbindungsabbruch und die Verbindungshilfe: Direkte Verbindungen werden verboten, ein lokaler TURN-Server (`node-turn`) muss übernehmen.
- Screenshots der Handy-Ansicht: `SHOTS=./shots npm run test:e2e`.

## CI und Veröffentlichung
`.github/workflows/ci.yml` führt bei jedem Push und Pull Request alle Tests aus (WebRTC, HTTP-Relay und WebSocket-Relay) und prüft die Laufzeit-Abhängigkeiten auf bekannte Lücken. Veröffentlicht wird über Coolify auf dem eigenen Server, das jeden Push auf `main` selbst baut und startet.

Lokal ansehen: `python3 -m http.server` im Repo-Ordner, dann `http://localhost:8000` öffnen.
