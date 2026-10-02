# Auftrag: Modellliste vom Anbieter im Dialog „Connect a Provider“ (Desktop/Web) und in `/auth`

**Stand:** 2026-10-02, geprüft gegen `qwen-code-fork` (upstream `a011f66944`) und die OpenRouter-API.
Ersetzt den Auftrag aus `qwen-code-personal`. Hintergrund: `2026-10-02-openrouter-katalog-todo.md` und
`2026-10-02-modellkatalog-im-auth-setup.md` (beide hier, Zeilenangaben dort teils veraltet).

## Ort

- Repo `<qwen-root>\qwen-code-fork`, neuer Branch **`feat/provider-model-discovery`** von `main`.
- Branch enthält nur PR-taugliche Änderungen, keine Dateien aus `stykker/`. Regeln: `QWEN.md`.
- Am Ende `git merge --no-ff` nach `skymain`. Commit nur nach Freigabe, Push und PR nur nach Freigabe.
- Skill `/feat-dev` (`.qwen/skills/feat-dev`) und `AGENTS.md` befolgen.

## Ziel

Im Schritt **4 Model IDs** des Dialogs „Connect a Provider“ (Desktop-App, Settings → Model) soll statt des
reinen Textfelds die Liste der Modelle erscheinen, die der eingegebene API-Key nutzen darf: durchsuchbar,
mit Mehrfachauswahl, Textfeld für eigene IDs bleibt. Generisch für jeden Anbieter mit
`supportsModelDiscovery` (heute Alibaba Coding/Token Plan, neu OpenRouter), nicht OpenRouter-spezifisch.

## Ist-Stand (geprüft)

- Terminal-`/auth` hat Discovery schon: `ProviderSetupSteps.tsx` → `DiscoveringModelIdsStep` →
  `discoverProviderModels` (`packages/core/src/providers/model-discovery.ts`), inkl. Suche
  (`modelSearchQuery`) und Mehrfachauswahl. Nicht neu bauen.
- Web/Desktop hat **keine** Discovery für irgendeinen Anbieter:
  - `packages/web-shell/client/components/messages/AuthMessage.tsx`: Schritt `models` = Textfeld (ab ca. Z. 834).
  - Daemon-Katalog `GET /workspace/auth/providers` (`packages/cli/src/serve/routes/workspace-auth.ts`,
    Descriptor in `serve/server/auth-provider-helpers.ts`) liefert kein `supportsModelDiscovery`.
  - Typ `DaemonAuthProviderDescriptor` in `packages/sdk-typescript/src/daemon/types.ts` hat das Feld nicht.
- OpenRouter-Preset (`packages/core/src/providers/presets/openrouter.ts`): `modelsEditable: true`, kein
  `supportsModelDiscovery`. Beide Preset-Modelle (`z-ai/glm-4.5-air:free`, `openai/gpt-oss-120b:free`)
  existieren im Katalog nicht mehr.
- Eine Extension kann das nicht liefern (`ALL_PROVIDERS` fest verdrahtet, Dialog-Union geschlossen).

## OpenRouter-Fakten

- `GET /api/v1/models`: öffentlich, 465 Modelle, 763 KB (mit `output_modalities=all` 961 KB).
  Discovery bricht über 1 MB ab (`DISCOVERY_MAX_BYTES`) und fällt dann still auf die Presets zurück.
- `GET /api/v1/models/user`: mit normalem API-Key, nach Key und Guardrails gefiltert (beim Nutzer 4 Modelle,
  vom Vorgänger-Agent gemessen). Das ist „was der Key nutzen darf“.
- Discovery-Aufrufe kosten kein Guthaben; nur echte Prompts kosten.

## Aufgaben

1. **Core:** `ProviderConfig` um optionales `modelListPath` erweitern (Default `/models`), in
   `discoverProviderModels` nutzen. OpenRouter: `supportsModelDiscovery: true`, `modelListPath: '/models/user'`;
   bei Fehler von `/models/user` kein Rückfall auf den ungefilterten Katalog (würde gesperrte Modelle zeigen),
   sondern Fallback wie heute (Presets + freie Eingabe).
2. **Core:** tote OpenRouter-Preset-Modelle durch existierende freie Modelle ersetzen (vorher per
   `GET /api/v1/models` prüfen).
3. **Daemon:** `supportsModelDiscovery` in den Descriptor aufnehmen; neue Route, z. B.
   `POST /workspace/auth/providers/:id/models` mit `{ baseUrl, apiKey }` → `discoverProviderModels`.
   Nur Anbieter mit `supportsModelDiscovery`, `baseUrl` muss zum Preset passen (kein offener Proxy),
   API-Key nie loggen oder zurückgeben. Bestehende Auth-/CSRF-Regeln der anderen Auth-Routen übernehmen.
4. **SDK:** Typ-Feld und `DaemonClient`-Methode in `packages/sdk-typescript` ergänzen.
5. **Web-Shell:** in `AuthMessage.tsx` Schritt `models` bei `supportsModelDiscovery`: Liste laden
   („Loading models…“), Suchfeld, Mehrfachauswahl, Textfeld für eigene IDs; bei Fehler heutiges Textfeld.
   Neue Texte in `i18n.tsx` (alle vorhandenen Sprachen).
6. **Optional, nur wenn klein:** `context_length` aus der Antwort als `contextWindowSize` übernehmen.

## Tests und Doku

- Unit-Tests: Core (Pfad, Fallback, Größengrenze), Daemon-Route (Key nicht im Log/Antwort, falscher
  Anbieter/baseUrl abgelehnt), Web-Shell (Liste, Suche, Fallback). Vorhandene Muster:
  `ProviderSetupSteps.test.tsx`, `web-shell.model-configuration.spec.ts`.
- E2E-Testplan unter `.qwen/e2e-tests/`; Design-Doc in `docs/design/` in EN und zh-CN (AGENTS.md).
- Self-Audit vor „fertig“.
- Smoke-Test: Desktop-Runtime mit `stykker\scripts\update-desktop.bat` bauen (nur nach Rückfrage,
  App und Sessions vorher zu), dann Dialog mit OpenRouter durchklicken. Kein Prompt nötig.

## Randbedingungen

- API-Key nie ausgeben; nur Statuscodes und Feldnamen loggen.
- `~/.qwen/settings.json` nicht verändern.
- Nicht in `qwen-code-personal` arbeiten.
