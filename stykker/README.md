# stykker/ – fork-eigene Dateien

Alles, was nur in diesem Fork gebraucht wird und nie in einen PR an upstream gehört.
Regeln für Agenten: [`../QWEN.md`](../QWEN.md).

| Pfad                                 | Inhalt                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `plans/`                             | eigene Pläne und Notizen (Dateiname `JJJJ-MM-TT-…md`)                       |
| `scripts/update-desktop.bat`         | Desktop-Runtime aus diesem Fork bauen und einsetzen, mit Aktualitätsprüfung |
| `scripts/update-desktop-restart.bat` | Ein-Klick: Qwen beenden, aktualisieren, App wieder starten                  |

## Ordner unter `<qwen-root>`

| Ordner              | Zweck                                                       |
| ------------------- | ----------------------------------------------------------- |
| `qwen-code-fork`    | dieser Fork, Arbeitsbranch `skymain`                        |
| `qwen-code-desktop` | installierte Desktop-App, Runtime unter `runtime\qwen-code` |
| `package`           | installierte CLI, kein Git                                  |

(`qwen-code-personal` und `qwen-code-repo` gibt es nicht mehr; der Fork hat sie ersetzt.)

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

`git merge upstream/main` direkt in `skymain` ergibt denselben Baum; `main` bleibt dann aber auf dem
alten Stand.

**Vor dem Bauen die Abhängigkeiten nachziehen** — ein Merge kann neue Pakete mitbringen, `node_modules`
wird nicht mitgemergt:

```bash
corepack pnpm install --frozen-lockfile
```

Sonst bricht der Build ab. Am 2026-10-06 scheiterte er in `packages/cli` mit
`hosted-glob-pattern.ts(8,23): error TS2305: Module '"minimatch"' has no exported member 'braceExpand'`,
weil der Merge `minimatch ^9.0.4` mitbrachte und im Wurzel-`node_modules` nur 3.1.5 lag. Nach dem
Install (9.0.9) lief derselbe Build ohne Codeänderung durch.

Merge statt Rebase: `skymain` wird geteilt und behält die Merge-Commits der Fix-Branches.

## Neuer Fix / PR

```bash
git switch -c fix/<thema> main
# ändern, testen, committen (upstream-Stil)
git push -u origin fix/<thema>          # PR: CrimsonED1:fix/<thema> -> QwenLM:main
git switch skymain && git merge --no-ff fix/<thema>
```

Offene Branches (in `skymain` gemergt, noch kein PR):

- `fix/openrouter-tool-parameters`: Tools ohne Argumente bekommen bei OpenRouter wieder ein leeres
  `parameters`-Schema (sonst „JSON error injected into SSE stream“, z. B. `stealth/space-bunny-alpha`).
- `feat/provider-model-discovery`: Modellliste mit Suche im Dialog „Connect a Provider“ (Desktop/Web),
  OpenRouter über `/models/user`.
- `feat/build-version-override`: `QWEN_CODE_BUILD_VERSION` stempelt eigene Builds.

## Desktop aktualisieren

`stykker\scripts\update-desktop.bat`, **nur manuell, App und alle Qwen-Sessions vorher schließen.**
Baut den Runtime (Node 22 unter `<root>\node-v22.23.3-win-x64`, Netz nötig), sichert die alte Runtime nach
`runtime\qwen-code.bak-<Zeitstempel>` und kopiert die neue hinein. Bricht ab, wenn die App läuft.

Vor dem Build prüft das Skript `runtime\qwen-code\manifest.json` gegen den Quellcode: **Commit,
Version und Node-Version müssen gleich sein** und der Arbeitsstand sauber. Dann meldet es
„Nichts zu tun“ und überspringt den Build komplett. `update-desktop.bat /F` erzwingt den Neubau,
etwa wenn eine besädigte Runtime noch ein passendes Manifest hat. Eine uncommittete Änderung
zählt als Abweichung — auch an dieser README oder am Skript selbst.

### Ein-Klick-Variante

`stykker\scripts\update-desktop-restart.bat` (angelegt 2026-10-06), Verknüpfung
`<qwen-root>\Qwen Desktop aktualisieren und starten.lnk`. Ablauf: `qwen-code-desktop.exe`
samt Kindprozessen beenden → warten, bis keine `node.exe` mehr aus dem Runtime-Ordner läuft →
`update-desktop.bat %*` (Argumente, z. B. `/F`, werden durchgereicht) → App per
`start "" /d "%DESKTOP%"` neu starten. Bei Exit-Code ≠ 0 bleibt die App **geschlossen**, damit der
Fehler sichtbar ist.

- **Nicht aus einer laufenden Qwen-Session heraus starten.** Die Session läuft als Kind der App und
  stirbt mit ihr; ungespeicherte Arbeit in allen Fenstern ist weg.
- **Das Skript zieht keine Abhängigkeiten nach.** Nach einem Merge mit neuen Paketen erst
  `corepack pnpm install --frozen-lockfile`, sonst bricht der Build ab, _nachdem_ Qwen schon beendet
  ist. Sicherer Weg bei Merges: erst im Fork `npm run build:runtime --workspaces=false` bauen
  (berührt die laufende App nicht), dann die Verknüpfung nutzen.

## Eigene Version erkennen

Das Skript stempelt den Build als `<version>+sky.<commit>`, mit `.dirty` bei uncommitteten Änderungen,
z. B. `0.25.0+sky.f17a509`. Sichtbar unten in der Seitenleiste der App und bei `qwen --version`.
Die offizielle Version zeigt nur `0.25.0`. Grundlage ist `QWEN_CODE_BUILD_VERSION` (Branch
`feat/build-version-override`); den Teil nach `+` ignoriert die Update-Prüfung.

## App-Hülle vs. Runtime

Der `+sky`-Build liegt **nur** in der Runtime. Die App-Hülle `qwen-code-desktop.exe` ist die offizielle
Tauri-App (Stand 2026-10-06: 0.24.7) und wird von `update-desktop.bat` nie angefasst.

Die Hülle prüft beim Start selbst
`https://github.com/QwenLM/qwen-code/releases/download/desktop-latest/desktop-latest.json` und
vergleicht mit ihrer eigenen Version. Da das Feed 0.25.0 meldete und die Hülle 0.24.7 ist, kam bei
jedem Start der Dialog „Qwen Code Desktop 0.25.0 is available. Install and restart now?".

- **„Install and restart" nicht anklicken:** das installiert die offizielle App **samt** Runtime und
  ersetzt damit den `+sky`-Build. Fehlt danach der Zusatz `+sky`, `update-desktop.bat` erneut ausführen.
- Abgeschaltet am 2026-10-06 über die Benutzer-Umgebungsvariable `QWEN_DESKTOP_DISABLE_UPDATES=1`
  (`setx`; der Schalter steckt schon im 0.24.7-Binary) — wirkt beim nächsten App-Start.
  Rückgängig: `reg delete HKCU\Environment /v QWEN_DESKTOP_DISABLE_UPDATES /f`.

## CI

Im Fork laufen **keine** GitHub Actions. Die API meldet 0 registrierte Workflows trotz der vorhandenen
Workflow-Dateien und 0 Läufe über alle Branches (geprüft 2026-10-06, auch nach Pushes auf `skymain`).
`ci.yml` hätte ohnehin nur `push` auf `main` und Pull Requests gegen `main`/`release/**`. Ein Push auf
`skymain` löst also nichts aus; es kommt auch kein Lauf nachträglich.
