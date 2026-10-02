# QWEN.md – Fork CrimsonED1/qwen-code

Ergänzt [`AGENTS.md`](AGENTS.md) (upstream, gilt weiter vollständig). Diese Datei existiert nur im Fork.

## Branches

- `main`: reiner Spiegel von `upstream/main`. Nie direkt committen.
- `skymain`: Arbeitsstand = `main` + gemergte Fix-Branches + Ordner `stykker/` + diese Datei.
- Änderungen am Qwen-Code selbst immer auf eigenem Branch von `main` (`fix/…`, `feat/…`),
  dann per `git merge --no-ff` nach `skymain`. So bleibt jeder Branch als PR an upstream nutzbar.
- PRs nie von `skymain` aus; dort liegen fork-eigene Dateien.

## Fork-eigene Dateien

- Nur `QWEN.md` (diese Datei) und eine Verweiszeile in `CLAUDE.md` liegen im Root.
- Alles andere (Doku, Pläne, Skripte) unter [`stykker/`](stykker/README.md), nicht in `docs/`.
- Fix-Branches enthalten keine Dateien aus `stykker/`.

## Kommunikation

Mit dem Nutzer Deutsch. Code, Commits und PR-Texte im upstream-Stil (Englisch, Conventional Commits).
