# Modellkatalog im /auth-Setup (alle OpenAI-kompatiblen Provider)

> **Für die Umsetzung:** `/feat-dev` Skill (investigate → design → test plan → implement → verify → self-audit → review). Jede Aufgabe unten ist eine eigene PR-Einheit mit den genannten Verifikationskommandos.

**Ziel:** Beim Einrichten eines Providers über `/auth` den vollständigen Modellkatalog von `GET {baseUrl}/models` laden und zur Auswahl anbieten — inklusive Metadaten (Kontextfenster, Vision, Tool-Support, free) — statt der fest verdrahteten Preset-Liste. Gilt für **alle** OpenAI-kompatiblen Provider, nicht nur OpenRouter.

**Architektur:** Der bestehende Discovery-Pfad (`discoverProviderModels` + `DiscoveringModelIdsStep` + `ModelIdsStep`) wird von „nur Alibaba-Coding-/Token-Plan" auf alle `AuthType.USE_OPENAI`-Presets umgestellt und um Katalogmetadaten erweitert. Diese werden über das bereits existierende, bisher ungenutzte Feld `ProviderSetupInputs.prebuiltModels` bis in die installierten `ModelConfig`-Einträge durchgereicht. Der Katalog selbst wird **nicht** in `settings.json` geschrieben; dort landet nur die vom Nutzer gewählte Teilmenge (der „enabled set" aus `docs/design/openrouter-auth-and-models.md:41-52`).

**Tech Stack:** TypeScript, Vitest, Ink (`packages/cli`), OpenAI-kompatibles `/models`, bestehende `fetchWithPolicy`-Policy.

**Spec:** `docs/design/openrouter-auth-and-models.md` (Abschnitt „Current Boundary" :78-91 wird durch diesen Plan teilweise überholt — siehe Aufgabe 7)

---

## 0. Ausgangslage, live gemessen (2026-10-02)

`GET https://openrouter.ai/api/v1/models`, ohne API-Key abgerufen:

| Kennzahl                                              | Wert                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| Modelle gesamt                                        | **465**                                                                 |
| davon `supported_parameters` enthält `tools`          | 398 (67 ohne Tool-Support)                                              |
| davon `architecture.input_modalities` enthält `image` | 295                                                                     |
| `context_length` vorhanden                            | 465/465 (min 4095, max 2 000 000)                                       |
| Modelle mit `< 32k` Kontext                           | 16                                                                      |
| `:free`-Varianten                                     | 17                                                                      |
| doppelte IDs                                          | 0                                                                       |
| Antwortgröße unkomprimiert                            | 763 KB (0,73 MiB)                                                       |
| davon nur `id` + `name` + `context_length`            | 43 KB                                                                   |
| längste Modell-ID                                     | 56 Zeichen (`cognitivecomputations/dolphin-mistral-24b-venice-edition`) |
| IDs länger als 28 Zeichen                             | 115                                                                     |

Mit dem API-Key des Nutzers gegen OpenRouter geprüft (nur Statuscodes und Feldnamen abgefragt, der Key wurde nicht ausgegeben):

| Endpunkt                            | Ergebnis mit Key                                                                                                                                                                                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/models`                | 200, **465 Modelle** — identisch ohne Key, der Endpoint ignoriert die Authentifizierung                                                                                                                                                                         |
| `GET /api/v1/models/user`           | 200, **4 Modelle**, `total_count: 4`, `links.next: null`                                                                                                                                                                                                        |
| `GET /api/v1/key`                   | 200, Felder: `label`, `is_management_key`, `is_provisioning_key`, `workspace_id`, `organization_id`, `allowed_data_regions`, `limit_remaining`, `usage*`, `byok_usage*`, `is_free_tier`, `expires_at`, `free_model_daily_requests` — **keine Modell-Allowlist** |
| `GET /api/v1/models/{id}/endpoints` | 200, Detail-Ansicht pro Modell                                                                                                                                                                                                                                  |

Die vier key-gefilterten Modelle:

| ID                             | Name                          | Kontext   | Tools | Vision | Preis              | Reasoning    |
| ------------------------------ | ----------------------------- | --------- | ----- | ------ | ------------------ | ------------ |
| `stealth/space-bunny-alpha`    | Space Bunny Alpha             | 1 000 000 | ja    | ja     | free               | pflicht      |
| `xiaomi/mimo-v2.6-flash`       | Xiaomi: MiMo-V2.6-Flash       | 1 050 000 | ja    | ja     | $0,12/$0,28 pro 1M | –            |
| `deepseek/deepseek-v4.1-flash` | DeepSeek: DeepSeek V4.1 Flash | 1 048 576 | ja    | ja     | $0,02/$0,60 pro 1M | max/high/low |
| `z-ai/glm-5.3-flash`           | Z.ai: GLM 5.5 Flash           | 1 048 576 | ja    | ja     | $0,03/$0,93 pro 1M | pflicht      |

## 1. Korrektur der Aufgabenannahme

Die Formulierung „was der API-Key liefert" ist für OpenRouter **richtig** — nur eben nicht über `/api/v1/models`. Dieser Endpoint ist öffentlich (HTTP 200 ohne Key) und liefert immer den vollen Katalog; die Authentifizierung wird ignoriert. Der key-spezifische Katalog steht unter **`GET /api/v1/models/user`** („List models filtered by user provider preferences, privacy settings, and guardrails"):

- Arbeitet mit einem **normalen API-Key**, kein Management-Key nötig (der 403 „Only management keys can perform this operation" in der OpenAPI-Definition ist das generische Beispiel dieses Endpoints, nicht seine Regel — mit dem getesteten Key kam 200).
- Parameter: `offset` (Default 0), `limit` (Default 500, max 1000), `output_modalities` (Default `text`; `all` liefert bei dem getesteten Key dieselben 4 Modelle).
- Antwort: `{ data, total_count, links.next }` — dieselben Modellobjekte wie `/models`, zusätzlich `reasoning` (`mandatory`, `supported_efforts`, `default_enabled`, `supports_max_tokens`), optional `benchmarks` (Artificial-Analysis-Indizes, Design-Arena-ELO) und `alias_target`. Bei den vier Modellen des Test-Keys sind `benchmarks` und `alias_target` nicht belegt, `reasoning` schon.
- Bei einem regionalen Host (`eu.openrouter.ai`) wird zusätzlich auf In-Region-Routing gefiltert.

Damit sind die Guardrail-, Provider-Präferenz- und Privacy-Einstellungen **die Kuratierung** — der Entwurf `docs/design/openrouter-auth-and-models.md:54-57` („kleine, stabile, kuratierte Auswahl") wird für diesen Provider kostenlos erfüllt, statt im Code erzwungen werden zu müssen. Für Provider ohne key-spezifischen Katalog (alle lokalen Gateways, Aliyun, Nvidia, …) bleibt es beim öffentlichen `/models`, und die Capability-Metadaten sind dann der Ersatz für die fehlende Allowlist.

## 2. Bestandsaufnahme (verifizierte Anker)

| Baustein                 | Ort                                                                                                                                                                                                                                                              | Zustand                                                                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Preset-Flag              | `packages/core/src/providers/types.ts:77-78`                                                                                                                                                                                                                     | generisch, „Load the account's current model recommendations from `/models`"                                                                                             |
| Presets mit Flag         | `presets/alibaba-coding-plan.ts:119`, `presets/alibaba-token-plan.ts:239`                                                                                                                                                                                        | nur diese 2 von 13                                                                                                                                                       |
| Endpoint-Wahl pro Preset | fehlt                                                                                                                                                                                                                                                            | es gibt nur `${baseUrl}/models`; für den key-spezifischen Katalog braucht es ein Preset-Feld (z. B. `modelListPath`, Default `/models`, OpenRouter `/models/user`)       |
| Discovery-Fetch          | `packages/core/src/providers/model-discovery.ts:87-124`                                                                                                                                                                                                          | 5 s Timeout, 1 MiB Cap, ≤2 Redirects, `Authorization: Bearer`; parst **nur** `id` + `created`; All-or-Nothing; **kein Cache**; catch → `null` (`:121-123`)               |
| Einziger Aufrufer        | `packages/cli/src/ui/auth/ProviderSetupSteps.tsx:600-661` (Fetch), `:953-957` (Verdrahtung)                                                                                                                                                                      | Wizard-only; der `/model`-Picker lädt nie nach                                                                                                                           |
| Auswahl-UI               | `ProviderSetupSteps.tsx:284-478`                                                                                                                                                                                                                                 | Suche (`:326-335`), Space-Toggle (`:380-409`), Freitext, Fenster `MAX_MODELS_TO_SHOW = 8` (`:190`, Scrolloffset `:336-349`), Vorbelegung nur aus Preset-IDs (`:262-272`) |
| Label-Format             | `ProviderSetupSteps.tsx:186`, `:200-214`                                                                                                                                                                                                                         | feste Spalte `MODEL_DESCRIPTION_COLUMN = 28`; rendert Kontext/Thinking/Modalitäten                                                                                       |
| Metadaten-Verlust        | `packages/core/src/providers/provider-config.ts:200-225`                                                                                                                                                                                                         | Metadaten kommen ausschließlich aus dem Preset-`specMap`; Katalog-Metadaten fallen still weg                                                                             |
| Persistenz-Haken         | `packages/core/src/providers/types.ts:160-161` (`prebuiltModels`) → `provider-config.ts:337-338`                                                                                                                                                                 | Feld existiert und ist getestet (`provider-config.test.ts:493-501`), wird aber nur vom Update-Pfad genutzt (`useProviderUpdates.ts:272-299`)                             |
| Submit-Punkt             | `ProviderSetupSteps.tsx:366-370` → `useProviderSetupFlow.ts:426-439` → `buildInstallPlan`                                                                                                                                                                        | `submitModelIds(overrides?: Partial<ProviderSetupInputs>)` akzeptiert `prebuiltModels` bereits                                                                           |
| Persistenz               | `providers/install.ts:428`                                                                                                                                                                                                                                       | schreibt den Bucket komplett; `modelProviders` ist `MergeStrategy.REPLACE` (`cli/src/config/settingsSchema.ts:401`)                                                      |
| Drift-Hash               | `provider-config.ts:279-291`, `:589`                                                                                                                                                                                                                             | hasht das Modell-Array → Katalogwechsel = Update-Prompt                                                                                                                  |
| Registry                 | `models/modelRegistry.ts:329-335`                                                                                                                                                                                                                                | First-wins bei gleicher ID + gleichem baseUrl, Rest wird verworfen                                                                                                       |
| Tests, die brechen       | `providers/__tests__/model-discovery.test.ts:75-86` (1 MiB, Fetch-Parameter), `:131-142` (7 Nicht-Standard-Shapes auf `null`), `ui/auth/ProviderSetupSteps.test.tsx` (mockt `discoverProviderModels`), `__tests__/provider-config.test.ts:493-501`, Preset-Tests |                                                                                                                                                                          |

`baseUrl` im Wizard kommt aus `resolveBaseUrl(config)` (Preset) oder aus der Nutzereingabe (`useProviderSetupFlow.ts:180-185, 256`) — **nicht** aus `settings.modelProviders`. Der API-Key fließt also nur an einen Host, den der Nutzer im Schritt selbst bestätigt hat. Das ist der wichtigste Sicherheitsfakt und bleibt so.

## 3. Aufgaben

### Aufgabe 1 — Discovery robuster machen und Metadaten liefern

- [ ] `DISCOVERY_MAX_BYTES` (`model-discovery.ts:11`) von 1 MiB auf 4 MiB anheben (OpenRouter heute 763 KB unkomprimiert, Katalog wächst).
- [ ] `DiscoveredModel` (`:25-28`) um `name`, `contextWindowSize`, `capabilities`, `modalities`, `supportsTools`, `isFree` erweitern; Mapping aus OpenRouter-Feldern `name`, `context_length`, `architecture.input_modalities`, `supported_parameters`, `pricing` bzw. `:free`-Suffix. Fehlende Felder bleiben `undefined` — kein Raten, kein Default-Kontext.
- [ ] Aus dem Feld `reasoning` des Katalogs `enableThinking` und `thinkingMandatory` ableiten (`mandatory: true` → `thinkingMandatory`). Das ist kein Kosmetik: `pipeline.ts:1286` und `:1321` lassen `reasoning: {enabled: false}` bei thinking-pflichtigen Modellen bewusst weg, und `default.ts` behandelt sie gesondert — heute steht das als hartkodierte Modellliste im Code.
- [ ] Endpoint-Wahl als Preset-Feld `modelListPath?: string` (Default `/models`). OpenRouter-Preset: `/models/user`. Damit bleibt core frei von Host-Sonderfällen, und ein Provider, der heute schon `/models` ohne Key anbietet, verhält sich unverändert.
- [ ] `output_modalities=text` fest verdrahten, nicht den Default der API annehmen: `all` zieht Bild-, Video- und Audio-Modelle in eine Chat-Auswahl hinein.
- [ ] `readModels` (`:30-69`) von All-or-Nothing auf „defekte Einzelelemente überspringen" umstellen; `null` nur noch, wenn die Top-Level-Form falsch ist oder kein verwertbarer Eintrag übrig bleibt. Bei 465 Einträgen ist ein Katalogausfall sonst viel wahrscheinlicher.
- [ ] `mergeModelSpecs` (`:71-85`) so erweitern, dass angereicherte Specs erhalten bleiben (aktuell wird auf `{id}` bzw. den Preset-Spec reduziert) — Preset-Metadaten gewinnen bei Konflikten.
- [ ] Bestehende ID-Härtung (`:12-16`) unverändert lassen: sie filtert NUL und Kommas und schützt damit den Komma-join im Wizard und die ACP-Routen-IDs.
- [ ] `__tests__/model-discovery.test.ts` nachziehen: neues Cap, Metadaten-Mapping, Teilfehler-Verhalten, `:free`-Erkennung.
- **Verifizieren:** `cd packages/core && npx vitest run src/providers/__tests__/model-discovery.test.ts`

### Aufgabe 2 — Discovery für alle OpenAI-kompatiblen Presets aktivieren

- [ ] `supportsModelDiscovery: true` setzen für: `openrouter.ts`, `alibaba-standard.ts`, `deepseek.ts`, `grok.ts`, `idealab.ts`, `minimax.ts`, `modelscope.ts`, `moonshot.ts`, `requesty.ts`, `zai.ts`. `custom-provider.ts` gesondert entscheiden (siehe offene Frage 1).
- [ ] Für `openrouter.ts` zusätzlich `modelListPath: '/models/user'` setzen, damit der Guardrail-gefilterte Katalog statt der 465er-Liste ankommt.
- [ ] Preset-Tests nach dem Muster von `presets/alibaba-coding-plan.test.ts:38` ergänzen.
- [ ] Nebenwirkung akzeptieren und dokumentieren: Provider ohne `/models`-Endpunkt (z. B. DeepSeek) liefern 404/401 → der vorhandene Fail-soft-Pfad (`ProviderSetupSteps.tsx:627-629`) fällt auf die Preset-Liste zurück. Kostet einen Request und ein kurzes „Loading models from provider…"-Fenster.
- **Verifizieren:** `cd packages/core && npx vitest run src/providers`

### Aufgabe 3 — Auswahl-UX für große Kataloge

- [ ] `MAX_MODELS_TO_SHOW` (`:190`) von 8 auf 12 erhöhen; die Step-Höhe ist Unlike `/model` nicht hart verdrahtet, aber auf 24-zeiligen-Terminals prüfen.
- [ ] `MODEL_DESCRIPTION_COLUMN` (`:186`) von 28 auf 36 anheben (115 von 465 IDs sind länger als 28 Zeichen) und `free`, Preis und Tool-Marker ergänzen, damit `formatModelOptionLabel` (`:200-214`) die neuen Felder zeigt.
- [ ] `modelOptionSearchText` (`:216`) um `name` erweitern, damit die Suche auch den Anzeigenamen trifft, nicht nur die ID.
- [ ] Filter-Umschaltung ergänzen: `alle` / `nur Tool-fähige` / `Kontext ≥ 32k` / `nur free`. **Nachrangig**: Bei einem key-gefilterten Katalog wie dem getesteten (4 Modelle, alle tool-fähig) ist die Filterzeile reines Beiwerk. Sie lohnt sich erst für Provider ohne Guardrails, wo 465 Zeilen kommen — dort aber ohne Suchfeld unbrauchbar. Erst das Suchfeld, dann die Filter, wenn der Katalog in der Praxis groß ausfällt.
- [ ] „Alle sichtbaren auswählen" — ebenfalls nachrangig, aus demselben Grund.
- [ ] Vorbelegung: bei key-spezifischem Katalog **alle** Modelle des Katalogs vorselektiert liefern, weil die Guardrail des Nutzers bereits die Kuratierung ist (`docs/design/openrouter-auth-and-models.md:54-57`). Bei öffentlichem Katalog bleibt es bei der Preset-Auswahl (`getRecommendedSelections`, `:262-272`).
- [ ] `ProviderSetupSteps.test.tsx` um Filter, Bulk-Auswahl und Label-Inhalte erweitern.
- **Verifizieren:** `cd packages/cli && npx vitest run src/ui/auth/ProviderSetupSteps.test.tsx`

### Aufgabe 4 — Metadaten bis in die installierte Konfiguration durchreichen

- [ ] Beim Submit `prebuiltModels` mitgeben (`ProviderSetupSteps.tsx:366-370`): pro gewählter ID ein `ProviderModelConfig` mit `name`, `contextWindowSize`, `capabilities.vision`, `envKey`, `baseUrl`.
- [ ] **Mit bestehenden Einträgen mergen**, nicht überschreiben — Vorgehen wie `useProviderUpdates.ts:272-293`: `wireApi`, `generationConfig` und Aux-Pins (`fastOnly`, `visionOnly`, `imageOnly`, `realtimeOnly`) eines bereits installierten Modells erhalten. Sonst verliert der Nutzer beim Neu-Einrichten seine Einstellungen.
- [ ] `buildInstallPlan` (`:337-338`) ist bereits der richtige Haken; prüfen, ob der `preserveSavedApis`-Zweig (`:339-352`) mit den angereicherten Modellen korrekt umgeht.
- [ ] Drift-Hash absichern: `computeModelListVersion` (`:589`) darf nicht über den Katalog laufen, sonst feuert jeder Katalog-Wechsel einen Update-Prompt. `resolveMetadataKey` (`:258`) sagt „static models list" — der Hash soll über `config.models` (statisch) gebildet werden, nicht über die installierten Modelle. Verhaltensänderung → `install.test.ts` und `useProviderUpdates.test.ts` prüfen.
- [ ] Größenabschätzung im Hinterkopf behalten: 465 aktive Modelle ≈ 90 KB in `modelProviders.openai`. Das ist vertretbar, aber die Datei wird dann gelesen bei jedem Start — `REPLACE`-Semantik und Merge-Warnungen (`settings.ts:310-348`) im Hinterkopf behalten.
- **Verifizieren:** `cd packages/core && npx vitest run src/providers/__tests__/provider-config.test.ts src/providers/__tests__/install.test.ts`

### Aufgabe 5 — Sicherheits- und Policy-Gate für den Katalog-Fetch

- [ ] `Authorization`-Header nur bei `https` senden; Ausnahme Loopback/private Hosts für die lokalen Gateways (Helfer existiert: `utils/fetch.ts:131` `isPrivateIp`, `:145` `isPrivateHost`, `:174` `isPermittedRedirect`).
- [ ] Host aus dem Katalog-Request darf nicht stillschweigend von `baseUrl` abweichen: `fetchWithPolicy` (`:243`) verweigert bereits Cross-Host-Redirects, das genügt.
- [ ] Keine Storage-Erweiterung in diesem Plan — der Katalog ist eine flüchtige Anzeige; es gibt bewusst keinen Cache (siehe „Nicht-Ziele").
- **Verifizieren:** neuer Test in `model-discovery.test.ts` (http-URL ohne Key-Header; Loopback mit Key-Header).

### Aufgabe 6 — Debug-Logging für den Discovery-Pfad

- [ ] `model-discovery.ts` schluckt jeden Fehler (`:121-123`). `createDebugLogger('MODEL_REGISTRY')`-Muster (`models/modelRegistry.ts:22`) auch hier nutzen: Status, Antwortgröße, Anzahl übernommener/verworfener Einträge, Abbruchgrund. **Kein** Telemetrie-Event — der Katalog enthält keine Nutzerdaten, aber der Abruf schon (Key-Identität, Host).
- **Verifizieren:** Test auf den Logger-Aufruf bei Fehlerfall.

### Aufgabe 7 — Tests, Doku, Plan

- [ ] E2E-Testplan in `.qwen/e2e-tests/` (AGENTS-Regel für verhaltensändernde Features): `/auth` → OpenRouter → Katalog erscheint → Filter → Auswahl → `~/.qwen/settings.json` enthält `modelProviders.openai` mit `contextWindowSize` → `qwen -p test` mit einem aus der Liste gewählten Modell.
- [ ] `docs/design/openrouter-auth-and-models.md:78-91` aktualisieren: der „Current Boundary"-Abschnitt sagt, Browsen/Filter sei nach `/manage-models` verschoben. Dieser Plan liefert genau diesen Teil in `/auth`. Der `/manage-models`-Einstiegspunkt bleibt offen.
- [ ] Achtung AGENTS-Regel: Design-Docs brauchen EN **und** ZH-CN. `openrouter-auth-and-models.md` hat bisher keine ZH-Fassung; wenn das Doc angefasst wird, gehört die Übersetzung mit in denselben Change (plus reziproke Sprachlinks).
- [ ] `npm run build && npm run typecheck && npm run lint` und die Unit-Tests der berührten Pakete.

## 4. Bewusst nicht in diesem Plan

- **`/model`-Picker live nachladen.** Der Nutzer hat den Umfang auf „nur /auth" begrenzt. Der Picker liest weiterhin ausschließlich `config.getAllConfiguredModels()` (`ModelDialog.tsx:348`); ohne Suchfeld und mit `MAX_MODEL_ITEMS_TO_SHOW = 10` (`:135`) wäre ein 465-zeiliges Listing dort auch nicht bedienbar. Eigener Plan mit Ink- und OpenTUI-Parität (`opentui/dialog-data.ts:118-213`).
- **Cache des Katalogs auf Platte.** Der Wizard lädt genau einmal pro Schrittbesuch; ein Cache bräuchte einen Key aus `baseUrl` + Key-Hash und brächte TTL- und Invalidierungsfragen mit. Bei 5 s Timeout vertretbar wegzulassen — neu bewerten, wenn Nutzer über 465 Modellen hinaus Provider mit langsamer `/models`-Antwort nutzen.
- **Persistieren des vollen Katalogs in `settings.json`.** Bleibt verboten (Design-Doc :43-46). Die Auswahl ist der `enabled set`.
- **Per-Key-Liste.** Es gibt keinen OpenRouter-Endpunkt, der die Modellfreigaben eines Keys liefert. Die Capability-Metadaten sind der Ersatz.
- **Daemon-Route / Web Shell / ACP-Änderungen.** `GET /workspace/models` (`cli/src/serve/routes/workspace-models.ts:163`) serviert settings-basierte Konfiguration; eine Discovery-Variante dort wäre eine eigene Sicherheitsgrenze (Bearer-Token im Daemon) und ein eigener Plan.

## 5. Risiken

| Risiko                                                                 | Wirkung                                                               | Gegenmaßnahme                                                                                                                                     |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider ohne `/models` (DeepSeek u. a.)                               | nutzloser Request, kurze Ladeanzeige                                  | Fail-soft ist bereits da (`ProviderSetupSteps.tsx:627-629`), kein Code-Fehler                                                                     |
| 465 Modelle im Auswahlfeld                                             | unbedienbar ohne Filter                                               | Aufgabe 3 (Filter + Bulk-Auswahl)                                                                                                                 |
| `providerMetadata.<id>.version` kippt bei jedem Katalogwechsel         | Update-Dialog-Flut                                                    | Aufgabe 4, Hash über statische Preset-Modelle                                                                                                     |
| 465 aktive Modelle in `settings.json` (~90 KB)                         | Settings-Datei wächst, Merge wird relevant                            | im Plan als bewusste Grenze dokumentiert                                                                                                          |
| Response-Cap (763 KB heute)                                            | Discovery fällt bei Katalogwachstum still auf die Preset-Liste zurück | Aufgabe 1 (4 MiB) + Logging aus Aufgabe 6                                                                                                         |
| All-or-Nothing-Parsing                                                 | ein defekter Eintrag killt 464 gute                                   | Aufgabe 1                                                                                                                                         |
| Registry-Kollision (ID + gleicher baseUrl)                             | Modell wird still verworfen (`modelRegistry.ts:329-335`)              | nicht neu: IDs aus dem Katalog sind eindeutig (0 Duplikate gemessen)                                                                              |
| ACP-Routen-Name werft bei Kollision (`utils/acpModelUtils.ts:118-121`) | Session-Erstellung schlägt hart fehl                                  | ID-Härtung in Aufgabe 1 schließt NUL/Kommas aus; bei einer Kollision ist ein Fehler die richtige Reaktion — im E2E-Plan mit 50+ Modellen abdecken |

## 6. Offene Entscheidungen (vor Umsetzung klären)

1. **`custom-provider.ts`:** Flag setzen oder nicht? Mit Flag bekommt ein frei konfigurierter Gateway den Katalog (nützlich, passt zu den lokalen Gateways) — aber bei einem 404 verliert der Nutzer die ohnehin reine Freitext-Eingabe nur eine Ladeanzeige. Empfehlung: Flag setzen, weil der Fail-Soft-Pfad greift.
2. **Manueller Weg:** der Mockup-Vorschlag sah `+` als Escape-Hatch vor. Bei einem key-gefilterten Katalog ist die Frage wichtiger als zuvor: Ein lokales Gateway kann ein Modell fahren, das nicht in `/models` steht. Bleibt der Weg, aber nur als Taste hinter der Liste, nicht als sichtbares Eingabefeld.
3. **Sprache des Design-Doc-Updates:** EN + ZH-CN (AGENTS-Regel) oder nur EN, da es ein persönlicher Fork-Zweig ist.

## 7. Verifikation in einem Durchlauf

```bash
cd packages/core && npx vitest run src/providers
cd packages/cli  && npx vitest run src/ui/auth
cd packages/core && npm run typecheck && npm run lint
```

Manuell: `/auth` → OpenRouter, Katalog laden lassen (465 Zeilen erwartet), nach `glm` suchen, auf „free" filtern, ein Modell mit Vision wählen, absenden, `~/.qwen/settings.json` kontrollieren (dort darf **kein** Key und kein Katalog liegen, nur die gewählten Einträge inklusive `contextWindowSize`), dann `qwen -p test` mit dem gewählten Modell.

Kostenpflichtige API-Aufrufe sparsam halten: E2E-Durchlauf mit einem einzigen Test-Prompt, danach nur noch gezielte Einzelprüfungen.
