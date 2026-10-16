# stykker/ – fork-eigene Dateien

Alles, was nur in diesem Fork gebraucht wird und nie in einen PR an upstream gehört.
Regeln für Agenten: [`../QWEN.md`](../QWEN.md).

| Pfad                                 | Inhalt                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `plans/`                             | eigene Pläne und Notizen (Dateiname `JJJJ-MM-TT-…md`)                       |
| `scripts/update-desktop.bat`         | Desktop-Runtime aus diesem Fork bauen und einsetzen, mit Aktualitätsprüfung |
| `scripts/update-desktop-restart.bat` | Ein-Klick: Qwen beenden, aktualisieren, App wieder starten                  |
| `scripts/mxc-host-prep.bat`          | Windows einmalig für die Werkzeug-Sandbox (MXC) vorbereiten, mit UAC        |

## Ordner unter `<qwen-root>`

(Bis 2026-10 unter `<qwen-root>`. Die Skripte leiten ihre Pfade aus dem eigenen Ort ab und
hängen an keinem Laufwerksbuchstaben.)

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
Baut den Runtime (Node 22 unter `node-v22.23.3-win-x64` neben dem Ordner `qwen-code`, Netz nötig), sichert die alte Runtime nach
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

## Werkzeug-Sandbox (MXC) unter Windows — Installation

Stand 2026-10-16, Branch `feat/mxc-execution-sandbox` (noch nicht in `skymain`). Die Sandbox sperrt Befehle und
Dateischreiben der Werkzeuge auf den Projektordner; unter Windows macht das Microsofts MXC
(`@microsoft/mxc-sdk`, Prozess-Container auf AppContainer-Basis).

### Voraussetzungen

| Punkt                      | Wert                                                                          |
| -------------------------- | ----------------------------------------------------------------------------- |
| Windows                    | 11 24H2 ab Build 26100.9278 bzw. 25H2 ab 26200.9278 (`winver`)                |
| Node für den Runtime-Build | ≥ 24.21 (`.nvmrc` = 24); MXC braucht unter Windows 24.21 für die Ein-/Ausgabe |
| Admin-Rechte               | einmalig für Schritt 2                                                        |

### Schritte

1. **Runtime mit MXC bauen/einsetzen** wie unter „Desktop aktualisieren“. Die Runtime enthält das SDK unter
   `runtime\qwen-code\lib\node_modules\@microsoft\mxc-sdk` (nur win32-x64, ca. +40 MB).
2. **Windows vorbereiten (einmalig, Admin):** `stykker\scripts\mxc-host-prep.bat` doppelklicken und die UAC-Abfrage
   bestätigen. Weitere Projektordner mit `-Projects D:\Projekte,D:\Code`. Was fehlt, zeigt vorher und nachher
   `mxc-host-prep.bat -Check` (ohne Admin).
3. **Sandbox einschalten** in den User-Settings (`%USERPROFILE%\.qwen\settings.json`) oder, für Firmen, in den
   System-Settings (`C:\ProgramData\qwen-code\settings.json`):
   ```json
   {
     "tools": {
       "executionSandbox": {
         "backend": "mxc",
         "filesystem": "workspace-write",
         "network": "closed"
       }
     }
   }
   ```
   `"backend": "auto"` wählt unter Windows ebenfalls `mxc`. Wirkt nach Neustart von Qwen.
4. **Prüfen:** `qwen sandbox` zeigt `backend: mxc → mxc (full)`;
   `qwen sandbox -- cmd /c "echo x> ..\x.txt"` muss „Zugriff verweigert“ melden.

Hinweis: In der Desktop-App (ACP-Sitzungen) lehnt Qwen die Sandbox derzeit noch ab; das ist der nächste Schritt
(Plan außerhalb des Repos). In der Kommandozeile `qwen` funktioniert sie.

### Was Schritt 2 an Windows ändert

Immer dieselben zwei Einträge, nur `FILE_READ_ATTRIBUTES | FILE_READ_EA | READ_CONTROL | SYNCHRONIZE`, für
`ALL APPLICATION PACKAGES` (`S-1-15-2-1`) und `ALL RESTRICTED APPLICATION PACKAGES` (`S-1-15-2-2`):

| Wo                                                                                                 | Vererbung                   | Wie                                                         |
| -------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------- |
| Laufwerksstamm (`C:\`, `D:\`, …)                                                                   | keine                       | `wxc-host-prep.exe prepare-system-drive --target X:\` (MXC) |
| jeder Ordner auf dem Weg zu `%TEMP%` und zu den Projekt-Wurzeln (`C:\Users`, `C:\Users\<name>`, …) | keine                       | Skript                                                      |
| Projekt-Wurzeln (Qwen-Ordner, `Dokumente\Qwen`, `-Projects`)                                       | an Unterordner (nur Ordner) | Skript                                                      |

Kein Auflisten, kein Lesen von Dateiinhalten, kein Schreiben. Hintergrund: `node.exe` und `npm` prüfen beim Start jeden
Ordner im Pfad (`lstat`); Sandbox-Container dürfen unter Windows aber nicht einmal Attribute eines Ordners abfragen,
für den sie keinen Eintrag haben → `EPERM: lstat 'C:\Users'`. MXC selbst richtet nur die Laufwerksstämme ein
(Doku `docs/backends/process-container/host-prep.md`); die Zwischenordner ergänzt das Skript.

Was das Skript gesetzt hat, steht in `C:\ProgramData\qwen-code\mxc-host-prep.json`; `mxc-host-prep.bat -Undo`
entfernt genau das (und die Einträge an den Laufwerksstämmen). Ordner, die schon passen (z. B. `Program Files`),
bleiben unberührt. Firmen können dasselbe per Intune/GPO verteilen.

Vollständigkeit: Die Ordnerkette ist berechenbar (`-Check`). Was Werkzeuge darüber hinaus lesen (z. B. `.npmrc` im
Benutzerprofil), zeigt erst ein Probelauf in der Sandbox; MXCs eigene Protokollierung (`captureDenials`) wird auf
Windows 11 25H2 (Build 26200) nicht unterstützt.

### Bekannte Grenzen

- Nur der Projektordner ist beschreibbar (ein eigener Temp-Ordner der Sandbox ist geplant).
- Unter Windows lassen sich keine einzelnen Pfade im Projekt sperren (`maskedPaths` → „partial“).
- Win32k bleibt für Befehle an (sonst startet `node.exe` nicht); Zwischenablage und Eingabe-Injektion sind gesperrt.

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

Seit dem ersten `main`-Push nach Wochen listet die API **59 Workflow-Dateien als `active`** (Stand
2026-10-06; vorher meldete sie 0). Läufe gibt es trotzdem **keine**: 0 für `main`, 0 über alle Branches —
auch dieser Push hat nichts ausgelöst, obwohl `ci.yml` einen `push`-Trigger auf `main` hat.

Das ist nur die halbe Antwort: ob Actions im Repo an- oder abgeschaltet ist, gibt die API ohne Token
nicht preis (`/actions/permissions` → 401 Nicht autorisiert). Zum Nachsehen im Browser: Settings →
Actions → General. Falls dort jemand Actions einschaltet, feuert ein Push auf **`main`** (nicht auf
`skymain`); `main` wird nur als Spiegel von `upstream/main` gepusht.

Pushes auf `skymain` haben nichts ausgelöst, und es kommt auch kein Lauf nachträglich.
