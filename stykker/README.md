# stykker/ – fork-eigene Dateien

Alles, was nur in diesem Fork gebraucht wird und nie in einen PR an upstream gehört.
Regeln für Agenten: [`../QWEN.md`](../QWEN.md).

| Pfad                         | Inhalt                                                 |
| ---------------------------- | ------------------------------------------------------ |
| `plans/`                     | eigene Pläne und Notizen (Dateiname `JJJJ-MM-TT-…md`) |
| `scripts/update-desktop.bat` | Desktop-Runtime aus diesem Fork bauen und einsetzen    |

## Ordner unter `<qwen-root>`

| Ordner               | Zweck                                                                     |
| -------------------- | ------------------------------------------------------------------------- |
| `qwen-code-fork`     | dieser Fork, Arbeitsbranch `skymain`                                      |
| `qwen-code-desktop`  | installierte Desktop-App, Runtime unter `runtime\qwen-code`               |
| `qwen-code-personal` | alter privater Klon (Branch `personal`), Inhalt hierher übernommen        |
| `package`            | installierte CLI, kein Git                                                |

## Remotes

```
origin    https://github.com/CrimsonED1/qwen-code.git   (Fork)
upstream  https://github.com/QwenLM/qwen-code.git       (Original)
```

## Upstream einspielen

```bash
git fetch upstream
git switch main && git merge --ff-only upstream/main && git push origin main
git switch skymain && git merge main && git push origin skymain
```

Merge statt Rebase: `skymain` wird geteilt und behält die Merge-Commits der Fix-Branches.

## Neuer Fix / PR

```bash
git switch -c fix/<thema> main
# ändern, testen, committen (upstream-Stil)
git push -u origin fix/<thema>          # PR: CrimsonED1:fix/<thema> -> QwenLM:main
git switch skymain && git merge --no-ff fix/<thema>
```

Offene Fix-Branches:

- `fix/openrouter-tool-parameters`: Tools ohne Argumente bekommen bei OpenRouter wieder ein leeres
  `parameters`-Schema (sonst „JSON error injected into SSE stream“, z. B. `stealth/space-bunny-alpha`).

## Desktop aktualisieren

`stykker\scripts\update-desktop.bat`, **nur manuell, App und alle Qwen-Sessions vorher schließen.**
Baut den Runtime (Node 22 unter `<root>\node-v22.23.3-win-x64`, Netz nötig), sichert die alte Runtime nach
`runtime\qwen-code.bak-<Zeitstempel>` und kopiert die neue hinein. Bricht ab, wenn die App läuft.
