# TODO: OpenRouter Modellkatalog im /auth-Setup

**Stand:** 2026-10-02. Plan: `stykker/plans/2026-10-02-modellkatalog-im-auth-setup.md`.

**Ziel:** Beim Einrichten von OpenRouter über `/auth` alle Modelle anzeigen, die der API-Key tatsächlich benutzen darf — ohne manuelle Eingabe von Modell-IDs.

**Erste Erkenntnis:** Der kleinste Weg ist ein **Zwei-Zeilen-**Core-Patch. Der Plan ist für den ursprünglichen Wunsch überdimensioniert und kann gekürzt werden (siehe „Kürzung").

> **Hinweis zur Ablage:** Der Tracker lag zuerst als `todo_openrouter.md` in `<qwen-root>\qwen-code-repo`. Dieses Verzeichnis existiert nicht mehr; die Datei war nie committet. Der Inhalt liegt jetzt hier, im Personal-Fork, zusammen mit dem Plan.

---

## 1. Kürzung: was wirklich nötig ist

Die Fähigkeit existiert im Core bereits vollständig und ist nur für OpenRouter nicht freigeschaltet.

| Teil                                                                   | Wo                                                  | Aufwand               |
| ---------------------------------------------------------------------- | --------------------------------------------------- | --------------------- |
| Katalog für OpenRouter freischalten                                    | `packages/core/src/providers/presets/openrouter.ts` | **2 Zeilen**          |
| `modelListPath: '/models/user'` für den Guardrail-gefilterten Katalog  | Preset + `model-discovery.ts`                       | ~10 Zeilen            |
| Metadaten-Mapping (`context_length`, Tools, Vision, free, `reasoning`) | `model-discovery.ts`                                | ~40 Zeilen            |
| Suchfeld oben, „Gewählt"-Bereich, breitere Label-Spalte                | `packages/cli/src/ui/auth/ProviderSetupSteps.tsx`   | ~100 Zeilen, optional |

Das Vorbild ist `presets/alibaba-token-plan.ts:238-239`:

```ts
modelsEditable: true,
supportsModelDiscovery: true,
```

OpenRouter hat `modelsEditable: true` bereits (`presets/openrouter.ts:25`), nur das Discovery-Flag fehlt. Mit dem Flag rendert `ProviderSetupSteps.tsx:953-957` automatisch `DiscoveringModelIdsStep`, das `discoverProviderModels` aufruft und **bereits** eine Suchfeld-Checkbox-Liste rendert (`:284-478`, Fenster `MAX_MODELS_TO_SHOW = 8` bei `:190`).

**Empfehlung:** Erst die 2 Zeilen + `modelListPath`, `/auth` testen, dann entscheiden, ob die UI-Überarbeitung den Aufwand wert ist.

## 2. Extension oder Main-Code?

**Antwort: Main-Code. Eine Extension kann davon keinen Teil liefern.** Alle vier tragenden Aussagen wurden am 2026-10-02 gegen den Code geprüft:

| Blockierender Punkt                                                                                                                                                                                                      | Beleg                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Kein Provider-Beitragspunkt: `ProviderConfig` ist ein Interface, kein Union-Typ; `ALL_PROVIDERS` ist ein hartkodiertes Array; `registerProvider`/`providerRegistry`/`contributes` kommen im ganzen Repo nicht vor        | `packages/core/src/providers/all-providers.ts:55-69`, `packages/core/src/providers/types.ts:45`                        |
| Kein Settings-Schreibpfad: Extensions schreiben nur ihre eigene `.env`; `modelProviders`, `model.name`, `providerMetadata` sind ausschließlich über `applyProviderInstallPlan` schreibbar                                | `packages/core/src/extension/settings.ts:23`, `:100-107`; `packages/core/src/providers/install.ts:167`, `:428`, `:612` |
| Kein UI-Hook: Extension-Commands geben nur `submit_prompt` oder `confirm_shell_commands` zurück; `dialog:` ist eine geschlossene Literal-Union                                                                           | `packages/cli/src/services/command-factory.ts:146`, `:160`, `:168`; `packages/cli/src/ui/commands/types.ts:227-262`    |
| Selbst ein Datei-Hack bleibt wirkungslos: Die Runtime-Refresh-Kette lädt MCP, LSP, Skills, Agents, Hooks — aber keine Modelle. `/auth` ruft zusätzlich `reloadModelProvidersConfig`, `syncModelSelection`, `refreshAuth` | `packages/core/src/extension/extension-runtime-refresh.ts:34-92`; `packages/cli/src/ui/auth/useAuth.ts:192-198`        |

Die Doku sagt es explizit: `docs/design/external-context-provider-extensions.md:51-60` — „A provider registry in Qwen Core" und neue Fälle in der `ProviderConfig`-Union sind bewusst nicht eingeführt. `AGENTS.md` führt `packages/*/src/providers/**` als Maintainer-only; kleine `feat`-Änderungen sind davon nicht blockiert.

**Was eine Extension höchstens leisten könnte:** ein MCP-Tool `list_openrouter_models` plus ein Command, der die IDs als Prompt-Text ausgibt. Der Nutzer müsste sie dann in `/auth` → Custom Provider tippen — also genau die Handarbeit, die wegfallen soll.

## 3. Problem

- Der OpenRouter-Preset listet zwei Modelle fest ein (`presets/openrouter.ts:21-24`).
- **Beide existieren nicht mehr**: `z-ai/glm-4.5-air:free` und `openai/gpt-oss-120b:free` sind weder in `/api/v1/models` noch als Aliase vorhanden. Nur noch `z-ai/glm-4.5-air` und `openai/gpt-oss-120b` ohne `:free`.
- Der UI-Schritt erwartet heute getippte IDs (`ProviderSetupSteps.tsx:454-474`), keine Auswahl.

## 4. Verifizierte API-Fakten

Geprüft am 2026-10-02 ohne Modell-Credits. Der API-Key wurde nur als Header gesendet, nie ausgegeben.

| Endpunkt                            | Ergebnis                                                                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/models`                | 200, **465 Modelle** — identisch mit und ohne Key, der Endpoint ignoriert die Authentifizierung                                     |
| `GET /api/v1/models/user`           | 200, **4 Modelle**, `total_count: 4`, `links.next: null`                                                                            |
| `GET /api/v1/key`                   | 200, **keine Modell-Allowlist** (Credits, `workspace_id`, `organization_id`, `allowed_data_regions`, `is_management_key`, `usage*`) |
| `GET /api/v1/models/{id}/endpoints` | 200, Detail-Ansicht pro Modell                                                                                                      |

`/api/v1/models/user` ist der einzige Weg zu „was darf dieser Key":

- Doku: `https://openrouter.ai/docs/api/api-reference/models/list-models-filtered-by-user-provider-preferences-privacy-settings-and-guardrails` — „List models filtered by user provider preferences, privacy settings, and guardrails".
- Funktioniert mit einem **normalen API-Key**. Der 403 „Only management keys can perform this operation" in der OpenAPI-Definition ist das generische Beispiel dieses Endpoints, nicht seine Regel — mit dem Test-Key kam 200.
- Parameter: `offset` (Default 0), `limit` (Default 500, max 1000), `output_modalities` (Default `text`; `all` lieferte dieselben 4 Modelle).
- Antwort: `{ data, total_count, links.next }`, dieselben Modellobjekte wie `/models`, zusätzlich `reasoning` (`mandatory`, `supported_efforts`, `default_enabled`, `supports_max_tokens`) und optional `benchmarks` / `alias_target` (bei diesen vier Modellen nicht belegt).
- Regionale Hosts (`eu.openrouter.ai`) filtern zusätzlich auf In-Region-Routing.

Die vier key-gefilterten Modelle:

| ID                             | Name                          | Kontext   | Tools | Vision | Preis              | Reasoning    |
| ------------------------------ | ----------------------------- | --------- | ----- | ------ | ------------------ | ------------ |
| `stealth/space-bunny-alpha`    | Space Bunny Alpha             | 1 000 000 | ja    | ja     | free               | pflicht      |
| `xiaomi/mimo-v2.6-flash`       | Xiaomi: MiMo-V2.6-Flash       | 1 050 000 | ja    | ja     | $0,12/$0,28 pro 1M | –            |
| `deepseek/deepseek-v4.1-flash` | DeepSeek: DeepSeek V4.1 Flash | 1 048 576 | ja    | ja     | $0,02/$0,60 pro 1M | max/high/low |
| `z-ai/glm-5.3-flash`           | Z.ai: GLM 5.3 Flash           | 1 048 576 | ja    | ja     | $0,03/$0,93 pro 1M | pflicht      |

## 5. Was nicht geht

- `/api/v1/models` ist key-ignorerend, dort gibt es keine Allowlist-Information.
- `/api/v1/key` enthält keine Modellfreigaben.
- Ein blockiertes Modell fällt erst beim echten Request auf: Allowlist-Verstöße liefern **HTTP 403**.
- Die Management-API (`GET /api/v1/guardrails`, Management-Key) könnte die Allowlist rekonstruieren, aber mit Schnittmenge über Konto-, Member- und Key-Regeln — serverseitige Logik, die man nicht clientseitig nachbauen sollte.
- Für die lokalen Gateways (127.0.0.1:8080 usw.) gibt es keinen key-spezifischen Katalog. Dort bleibt `/models` die Quelle, und die Capability-Metadaten sind der Ersatz für die fehlende Allowlist.

## 6. Umsetzung

### 6.1 Minimalpfad (Empfehlung, zuerst)

- [ ] `presets/openrouter.ts`: `supportsModelDiscovery: true` ergänzen. Vorher `qwen -p test` mit einem der beiden toten Preset-Modelle als Baseline festhalten (erwartet: Fehler).
- [ ] `providers/types.ts`: Preset-Feld `modelListPath?: string`, Default `/models`. Kein Host-Sondercase in core.
- [ ] `presets/openrouter.ts`: `modelListPath: '/models/user'`.
- [ ] `model-discovery.ts`: URL aus `modelListPath` bauen; `output_modalities=text` fest setzen statt den API-Default anzunehmen (`all` zieht Bild-/Video-/Audio-Modelle in eine Chat-Auswahl).
- [ ] Test: `packages/core/src/providers/presets/` nach dem Muster von `alibaba-coding-plan.test.ts:38`.

### 6.2 Metadaten (damit die Auswahl informativ ist)

- [ ] `DISCOVERY_MAX_BYTES` (`model-discovery.ts:11`) von 1 MiB auf 4 MiB: die öffentliche Antwort ist heute 763 KB unkomprimiert.
- [ ] `readModels` (`:30-69`) von All-or-Nothing auf „defekte Einzelelemente überspringen" umstellen; `null` nur noch bei kaputter Top-Level-Form oder leerem Ergebnis. `model-discovery.test.ts:131-142` pinnt 7 Nicht-Standard-Shapes auf `null` und muss nachgezogen werden.
- [ ] `mergeModelSpecs` (`:71-85`) darf angereicherte Specs nicht auf `{id}` reduzieren.
- [ ] Mapping: `name` → Anzeigename, `context_length` → `contextWindowSize`, `architecture.input_modalities` → `capabilities.vision` / `modalities`, `supported_parameters` enthält `tools` → Tool-Marker, `pricing` bzw. `:free`-Suffix → free-Marker.
- [ ] `reasoning.mandatory` → `thinkingMandatory`, `supported_efforts` → `enableThinking`. Nicht kosmetisch: `pipeline.ts:1286` und `:1321` lassen `reasoning: {enabled: false}` bei thinking-pflichtigen Modellen bewusst weg — heute eine hartkodierte Modellliste im Code.
- [ ] ID-Härtung (`:12-16`) unverändert lassen: sie filtert NUL und Kommas und schützt den Komma-join im Wizard sowie die ACP-Routen-IDs.

### 6.3 UI (optional, erst nach 6.1 getestet)

- [ ] Suchfeld dauerhaft fokussiert nach oben, Freitext-Eingabe aus der Hauptansicht (`:454-474`, `:498-516`).
- [ ] `formatModelOptionLabel` (`:200-214`) zeigt Name, Kontext, Tool-/Vision-Marker, free-Marker.
- [ ] `MODEL_DESCRIPTION_COLUMN` (`:186`) von 28 auf 36: 115 der 465 öffentlichen IDs sind länger als 28 Zeichen, 12 länger als 36. Bei schmalen Terminals fällt die Namensspalte weg, nie die ID.
- [ ] `MAX_MODELS_TO_SHOW` (`:190`) von 8 auf 12.
- [ ] `modelOptionSearchText` (`:216`) um `name` erweitern.
- [ ] „Gewählt"-Bereich unter der Liste, nummeriert — das erste Modell wird beim Einrichten das Startmodell (`mergeModelIds`, `:237-239`).
- [ ] Vorbelegung: bei key-spezifischem Katalog alles vorselektiert (die Guardrail ist bereits die Kuratierung), sonst nur Preset-IDs (`getRecommendedSelections`, `:262-272`).
- [ ] Nachrangig und erst bei großem Katalog aus dem echten Betrieb: Filter-Umschaltung, „alle sichtbaren auswählen". Bei 4 Modellen sind sie reines Beiwerk.

### 6.4 Persistenz (nur nötig, wenn 6.3 Metadaten anzeigen will)

- [ ] Beim Submit `prebuiltModels` mitgeben (`:366-370` → `useProviderSetupFlow.ts:426` → `provider-config.ts:337`).
- [ ] Mit bestehenden installierten Modellen mergen, nicht überschreiben — Vorgehen wie `useProviderUpdates.ts:272-293`, sonst gehen `wireApi`, `generationConfig` und Aux-Pins verloren.
- [ ] `computeModelListVersion` (`provider-config.ts:589`) nicht über den Katalog laufen lassen: sonst feuert jeder Katalogwechsel einen Update-Prompt. Hash über `config.models` (statisch) bilden.

### 6.5 Tests und Doku

- [ ] `providers/__tests__/model-discovery.test.ts`: `modelListPath`, `output_modalities=text`, neues Größenlimit, Metadaten-Mapping, Teilfehler statt All-or-Nothing.
- [ ] `packages/cli/src/ui/auth/ProviderSetupSteps.test.tsx`: Suchfeld oben, Label-Inhalte, `prebuiltModels` im Submit-Payload, Vorbelegung je Katalog-Typ.
- [ ] `providers/__tests__/provider-config.test.ts`: Merge bestehender Modelle mit `prebuiltModels`.
- [ ] E2E-Testplan in `.qwen/e2e-tests/`.
- [ ] `docs/design/openrouter-auth-and-models.md:78-91` („Current Boundary") aktualisieren: das Doc sagt, Browsen und Filter seien nach `/manage-models` verschoben — genau das kommt hier in `/auth`. AGENTS-Regel: Design-Docs brauchen EN **und** ZH-CN plus reziproke Sprachlinks. Die ZH-Fassung fehlt bisher komplett.

## 7. Abnahmekriterien

- [ ] `/auth` → OpenRouter zeigt 4 Zeilen statt 2 toten IDs, alle mit Kontextangabe.
- [ ] Kein Modell muss getippt werden.
- [ ] Ein ausgewähltes Modell steht mit `contextWindowSize` in `modelProviders.openai` in `settings.json`, und `qwen -p test` antwortet damit.
- [ ] Provider ohne `/models`-Endpoint fallen per Fail-Soft auf die Preset-Liste zurück (`ProviderSetupSteps.tsx:626-629`).

## 8. Offene Fragen

- [ ] Soll `custom-provider.ts` Discovery bekommen? Mit Flag bekommen die lokalen Gateways den Katalog; bei 404 greift der Fail-Soft-Pfad. Empfehlung: ja.
- [ ] Manueller Weg für Modelle, die nicht im Katalog stehen (lokale Gateways): Taste hinter der Liste behalten oder ganz raus? Empfehlung: behalten, aber nicht als sichtbares Eingabefeld.
- [ ] UI-Überarbeitung aus 6.3 machen oder erst 6.1 ausliefern und mit dem echten 4-Zeilen-Bild entscheiden?

## 9. Anmerkungen

- `limit_remaining` des Test-Keys lag bei 2,70 USD — vor größeren Testläufen Guthaben prüfen.
- Beim Aktivieren aller 465 Modelle wären das ~90 KB in `settings.json`. Bei einem Guardrail-Katalog ist das kein Thema.
- Ablage im Fork: eigene Pläne liegen unter `stykker/plans/`, nicht in upstreams `docs/plans/` (hält PRs sauber).
