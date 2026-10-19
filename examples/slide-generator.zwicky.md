---
zwicky: 2
title: Slide-Generator (intern)
scale: 1-5
---

# Problem
> Welchen internen Slide-Generator brauchen wir, damit Slides schneller und in unserem Styling entstehen?

# Box

## Hosting
- Swiss Residency {fixed}
  > Vorgabe Informationssicherheit: Daten bleiben in der Schweiz.

## Präsentations-Art
- Native PPTX {fixed}
  > Kunden und Team arbeiten in PowerPoint weiter.

## Umfang
> Was soll der Generator erzeugen?
- Einzelne Slides {O1}
- Slide-Sequenz zu einem bestimmten Thema
- Vollständige Präsentation {O2}
- Überarbeitung einer bestehenden Präsentation
- Erweiterung einer bestehenden Präsentation

## Slide-Typen
> Welche Art von Slides sollen erstellt werden können?
- Mit Einschränkung › Strukturelle Slides {O1 O2}
  > Nur Slides, für die vorgängig ein Template definiert wird: Cover, Agenda, Kapiteltrenner, Abschlussfolie.
- Mit Einschränkung › Offerten-Slides {O2}
  > Team, Kostenschätzung, Arbeitspakete, Zeitplan …
- Mit Einschränkung › Consulting-Slides {O2}
  > Empfehlungen, Entscheidungsfolien, Problem Statements, Ausgangslage & Zielsetzung …
- Mit Einschränkung › Architektur-Slides
  > Zielarchitektur …
- Ohne Einschränkung
  > Es sollen alle möglichen Slides generiert werden können.

## Styling
> Welches Styling soll für die Slides verwendet werden?
- Acrea Styling {O1 O2}
- Kunden-Styling {O2}
- Neutrales Styling

## Sprachen
> Welche Sprache soll der Text auf den Slides haben?
- Deutsch {O1 O2}
- Englisch {O1 O2}

## Quellen
> Welche Informationen soll der Slide-Generator nutzen, um die Slides zu erstellen?
- Prompt {O1 O2}
- Bestehende PPT {O1}
- Word {O2}
- PDF {O2}
- OneNote {out}
  > Bei uns kaum im Einsatz; keine Anbindung geplant.
- E-Mail
- SharePoint-Dokumente {O2}

## Umgang mit den Quellen
> Wie soll der Slide-Generator mit den Quellen umgehen?
- Zusammenfassen (keine Interpretation) {O1}
- Interpretieren {O2}
- Ergänzende Infos im Internet suchen und ergänzen {out}
  > Ausgeschlossen: Inhalte sollen nur aus freigegebenen Quellen stammen.

## Umgang mit Widersprüchen
> Wie soll der Slide-Generator damit umgehen, wenn er widersprüchliche Informationen findet?
- Auf dem Slide visuell hervorheben {O1}
- Kommentar in der PPT erfassen
  > Unklar, ob technisch möglich.
- Notiz in den Speaker Notes {O2}
  > Unklar, ob technisch möglich.

## Interaktions-Ort
> Wo soll mit dem Slide-Generator interagiert werden?
- Copilot direkt in PowerPoint {O1}
- Agent in der Copilot-App
- Web-Anwendung im Browser {O2}

## Interaktionsmodell
> Wie soll mit dem Slide-Generator interagiert werden?
- Prompt-basiert {O1}
  > Ein Prompt, alle relevanten Informationen werden darin mitgegeben.
- Geführter Assistant {O2}
  > Relevante Informationen werden schrittweise gemeinsam mit dem Assistant erarbeitet.

## Inhaltliche Aufgaben
> Welche inhaltlichen Aufgaben übernimmt der Slide-Generator?
- Storyline aus Quellen ableiten {O2}
- Kernaussage pro Slide formulieren {O1 O2}
- Argumentation auf Konsistenz prüfen {O2}

# Options

## O1 Copilot-Erweiterung für einzelne Slides
> Klein starten: einzelne Slides direkt in PowerPoint, aus Prompt und bestehender PPT.

## O2 Geführter Assistent im Browser
> Ganze Präsentationen aus mehreren Quellen, Schritt für Schritt mit dem Assistant.
