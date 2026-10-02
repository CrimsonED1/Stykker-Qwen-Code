# Provider Model Discovery in the Web Shell Setup Wizard

[English](2026-10-02-provider-model-discovery.md) | [简体中文](2026-10-02-provider-model-discovery.zh-CN.md)

**Status:** implemented on `feat/provider-model-discovery`; unit-tested, E2E plan in
`.qwen/e2e-tests/2026-10-02-provider-model-discovery.md`.

## Problem statement

The "Connect a Provider" wizard in the Web Shell and the desktop app asks for model IDs as a
free-text comma list, even for providers whose catalog can be listed with the entered key. Users
must look up IDs elsewhere and can save models their key cannot use.

OpenRouter makes this worse: its preset suggests `z-ai/glm-4.5-air:free` and
`openai/gpt-oss-120b:free`, which no longer exist in the OpenRouter catalog, and keys can be
restricted by provider and guardrail settings, so most public models may be unusable for a given
key.

## Current state

- The terminal `/auth` flow already discovers models for providers with
  `supportsModelDiscovery` (Alibaba Coding Plan and Token Plan): `DiscoveringModelIdsStep` in
  `packages/cli/src/ui/auth/ProviderSetupSteps.tsx` calls `discoverProviderModels`
  (`packages/core/src/providers/model-discovery.ts`), which reads `GET <baseUrl>/models`.
- The Web Shell wizard (`packages/web-shell/client/components/messages/AuthMessage.tsx`) has no
  discovery for any provider. The daemon catalog `GET /workspace/auth/providers` does not tell the
  client which providers support it, and there is no daemon route that could run it.
- OpenRouter's public `GET /api/v1/models` returns about 465 models (about 763 KB, close to the
  1 MB discovery limit). `GET /api/v1/models/user` returns only the models the key may use after
  provider and guardrail filtering, with the same response shape.

## Goals

- Show the models an entered key may use in the Web Shell wizard's model step, searchable and
  multi-selectable, for every provider with `supportsModelDiscovery`.
- Enable discovery for OpenRouter using its key-scoped catalog.
- Keep manual entry working, and fall back to it whenever listing fails.

## Scope boundaries

- No new discovery for providers that do not opt in; the custom provider stays manual.
- No changes to how providers are installed or persisted.
- No capability tag: the client falls back to manual entry when the route is missing or fails.

## Proposed solution

### Core

- `ProviderConfig.modelListPath` (optional, default `/models`) selects the catalog path below the
  base URL; `discoverProviderModels` accepts it.
- Discovery maps a served positive integer `context_length` to `contextWindowSize` for models
  without a static preset spec.
- OpenRouter preset: `supportsModelDiscovery: true`, `modelListPath: '/models/user'`, and live free
  preset models (`qwen/qwen3.8-27b:free`, `nvidia/nemotron-3-super-120b-a12b:free`).
- The terminal `/auth` flow passes `modelListPath` through.

### Daemon

- The provider descriptor carries `supportsModelDiscovery: true` for opted-in providers.
- New route `POST /workspace/auth/provider/models`, request `{ providerId, baseUrl?, apiKey }`,
  response `{ v: 1, models: ServeAuthProviderModel[] | null }`. It is gated like the install route
  (`mutate({ strict: true })`).

### SDK

- `DaemonAuthProviderDescriptor.supportsModelDiscovery`, `DaemonAuthProviderModelsRequest`,
  `DaemonAuthProviderModelsResult`, and `DaemonClient.listAuthProviderModels`.

### Web Shell

- Workspace action `listAuthProviderModels`.
- In the model step, when the provider supports discovery and a key was entered, the wizard loads
  the listing once per provider, base URL, and key. It shows a count, a search field, and a
  checkbox per model (with its context window when known). Checking or unchecking edits the
  existing comma list, which stays the single source of the submitted IDs.
- When the listing arrives and the comma list still holds the untouched preset defaults, defaults
  the key cannot use are removed. Typed IDs are never removed.
- When listing fails, the wizard shows a short notice and the manual field works as before.

## Design decisions and rationale

| Decision                                                     | Rationale                                                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Discovery runs in the daemon, not the browser                | Provider endpoints do not allow browser CORS, and the daemon already owns provider requests.  |
| `baseUrl` must equal one of the provider's preset URLs       | The route forwards an API key; restricting the host removes any open-proxy or SSRF use.       |
| Failed listing returns `200 { models: null }`                | Matches the terminal flow, where a failed listing silently falls back to manual entry.        |
| OpenRouter uses `/models/user` without fallback to `/models` | The public catalog would offer models the key cannot use; manual entry is the safer fallback. |
| The comma field stays the source of truth                    | Keeps manual IDs, validation, review, and install unchanged.                                  |

## Constraints and risks

- The API key travels from the browser to the local daemon, as it already does for installation.
  The route never logs or echoes it.
- Large catalogs: discovery keeps the existing 1 MB and 5 s limits; `/models/user` is small.
- Rendering one checkbox per model is fine for key-scoped lists. For providers serving hundreds of
  models, the search field narrows the list.

## Files affected

- Core: `packages/core/src/providers/types.ts`, `model-discovery.ts`, `presets/openrouter.ts`, tests.
- CLI: `packages/cli/src/ui/auth/ProviderSetupSteps.tsx`; daemon
  `packages/cli/src/serve/types.ts`, `server/auth-provider-helpers.ts`, `routes/workspace-auth.ts`,
  `server.test.ts`.
- SDK: `packages/sdk-typescript/src/daemon/types.ts`, `index.ts`, `DaemonClient.ts`.
- Web Shell: `client/components/messages/AuthMessage.tsx`, `AuthMessage.module.css`,
  `AuthMessage.dom.test.tsx`, `client/daemon/workspace/actions.ts`, `types.ts`,
  `client/daemon/index.ts`, `client/daemon-react-sdk.ts`, `client/i18n.tsx`.

## Validation plan and acceptance criteria

- Unit: catalog path and `context_length` mapping; OpenRouter preset flags; route lists via the
  preset endpoint, reports failure as `null`, rejects missing fields, unsupported providers, and
  foreign base URLs without calling discovery, and never echoes the key; Web Shell lists, filters,
  toggles, drops unusable presets, saves the selection, and falls back on failure.
- E2E: see the test plan. Accepted when the desktop wizard shows OpenRouter's key-scoped models,
  saving the selection installs exactly those IDs, and an invalid key falls back to manual entry.

## Open questions

- Should the daemon REST reference document the provider setup routes (`GET /workspace/auth/providers`,
  `POST /workspace/auth/provider`, and the new route)? None of them are documented today.
