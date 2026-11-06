# Schichtplaner

Webseite zum Erstellen von Monatsplänen für ein 24/7-Team. Der fertige Plan wird von Hand in Bioman eingetippt. Bioman selbst wird nicht ersetzt, trotz des Ordnernamens `bioman_abloesung`.

## Starten
`index.html` im Browser öffnen. Es braucht keine Installation und keinen Server.

Personen, Ferien und Pläne liegen nur im Browser (`localStorage`), nicht in diesem Repository. Mit **Daten sichern** entsteht eine Sicherungsdatei. Diese enthält Personendaten und gehört nicht ins Repository.

## Bedienung
1. Unter **Personen und Ferien** Namen, Pensum und Jahrgang erfassen und die Ferien eintragen.
2. Unter **Plan** den Monat wählen und **Plan erzeugen** klicken.
3. Einzelne Tage durch Anklicken ändern. Von Hand gesetzte Einträge sind fixiert und bleiben beim nächsten Erzeugen erhalten.
4. Die Prüfung unter dem Plan zeigt Regelverstösse sofort an. Das **Jahreskonto** zeigt die Kontingente und den Stundensaldo.

Monate am besten der Reihe nach planen, weil laufende Nachtblöcke und Kontingente aus dem Vormonat übernommen werden.

## Regeln
Umgesetzt in `src/rules.js`, Grundlage ist der GAV AOT vom 1. Januar 2025, Anhang 2, plus die betrieblichen Regeln:

- Jede Schicht (0530, 0730, 0930, 1400, 1600, N1, N2) ist jeden Tag von genau einer Person besetzt.
- Nachtblock immer als 1600, N1, N2, Leave, danach R-Tag oder Ferien. Leave zählt nicht zu den R-Tagen.
- 11 h Ruhe vor jeder Schicht und 24 h pro R-Tag plus 11 h bei arbeitsfreien Tagen.
- Höchstens 7 Arbeitstage in Folge, ein freier Tag pro Kalenderwoche, mindestens 8 R-Tage pro Monat und 117 pro Jahr.
- Höchstens 14 Nachtarbeiten in 28 Tagen, 30 freie Sonntage pro Jahr, ein freier Sonntag pro 28 Tage.
- Eine Instruktion pro Person und Monat, an einem der ersten drei Mittwoche. Bürotage nur von Montag bis Freitag.

Der Planer in `src/solver.js` rechnet viele Varianten durch und behält die beste. Er findet einen guten, aber nicht beweisbar optimalen Plan. Verkürzte Ruhezeiten nutzt er nur, wenn es nicht anders geht.

Massgebend bleibt der GAV. Die Prüfung ersetzt keine rechtliche Kontrolle.

## Tests
```
node tests/run.js
```
Prüft jede Regel einzeln und plant ein ganzes Beispieljahr mit 24 Personen durch.
