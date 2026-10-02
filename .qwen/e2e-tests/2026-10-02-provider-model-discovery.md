# Provider model discovery in the Web Shell setup wizard

Design: `docs/design/2026-10-02-provider-model-discovery.md`.

Model listing (`GET .../models/user`) is free; no group below sends a prompt, so no
model credit is spent. Never print the API key; log only status codes and field names.

## Automated verification

```bash
cd packages/core
npx vitest run src/providers
cd ../cli
npx vitest run src/serve/server.test.ts -t "auth/provider"
npx vitest run src/ui/auth
cd ../web-shell
npx vitest run client/components/messages/AuthMessage.dom.test.tsx
```

Then `npm run build`, `npm run typecheck`, `npm run bundle`.

## Group A: daemon route (local build)

Session `e2e-discovery-a`, temp dir `$TMP/e2e-discovery-a` as workspace.

1. Start the daemon from the local build:
   `node dist/cli.js serve --port 4791 --token e2e-token --workspace "$TMP/e2e-discovery-a"`.
2. `GET /workspace/auth/providers` with `Authorization: Bearer e2e-token`.
   - Before: no provider has `supportsModelDiscovery`.
   - After: `openrouter`, `coding-plan`, and `token-plan` have `supportsModelDiscovery: true`;
     `custom-openai-compatible` does not.
3. `POST /workspace/auth/provider/models` with `{"providerId":"openrouter","apiKey":"$OPENROUTER_API_KEY"}`.
   - Before: `404`.
   - After: `200`, `v: 1`, `models` is a non-empty array of `{ id, contextWindowSize? }`; the
     response body does not contain the key.
4. Same request with `"apiKey":"invalid"`: `200` and `models: null`.
5. Same request with `"baseUrl":"https://attacker.example/v1"`: `400 invalid_base_url`.
6. `{"providerId":"custom-openai-compatible","apiKey":"x"}`: `400 unsupported_provider`.
7. Without the bearer token: rejected like `POST /workspace/auth/provider`.

## Group B: desktop wizard (manual, local runtime)

Requires the desktop runtime built from this branch (`stykker\scripts\update-desktop.bat` in the
fork, app and sessions closed first).

1. Settings → Model → Connect a Provider → Third-party → OpenRouter.
2. Enter a valid key, press next.
   - Before: step 4 shows only the comma field prefilled with the two dead preset IDs.
   - After: "Loading models from provider…", then "Models available to this key: N", a search
     field, and one checkbox per model; the comma field keeps only preset IDs the key can use.
3. Type in the search field: the list narrows; Enter does not leave the step.
4. Check two models: both appear in the comma field; uncheck one: it disappears.
5. Type an extra ID manually, then save: the installed models are exactly the comma list.
6. Repeat with an invalid key: the notice "Could not load models from the provider." appears and
   the comma field still works.

## Group C: terminal `/auth` regression

Session `e2e-discovery-c`, interactive tmux.

1. `node dist/cli.js`, run `/auth`, choose OpenRouter, enter a valid key.
   - After: the model step lists the key-scoped models (`/models/user`), not the public catalog.
2. Alibaba Token Plan still lists models from `/models` as before.

Groups A and C can run in parallel; Group B is manual.

## Baseline status

Dry-run against the released global `qwen` was not run in this environment. The baseline is
established by source and tests: the Web Shell model step is a text field for every provider,
`GET /workspace/auth/providers` carries no discovery flag, and the new route does not exist.

## Results (2026-10-02, local build of `feat/provider-model-discovery`)

- Automated: core `src/providers` 18 files / 272 tests pass; CLI `auth/provider` route tests and
  `src/ui/auth` pass; Web Shell `AuthMessage.dom.test.tsx` 24 tests pass; `npm run build`,
  `npm run typecheck`, `npm run bundle`, ESLint and Prettier clean.
- Group A: all steps pass with a real OpenRouter key. A2 flags `coding-plan`, `token-plan`,
  `openrouter`, not `custom-openai-compatible`. A3 returns 4 key-scoped models with
  `contextWindowSize`; the key is absent from the response body and the daemon log. A4 `models: null`,
  A5 `400 invalid_base_url`, A6 `400 unsupported_provider`, A7 `401`.
- Group B: run in the Web Shell served by the local daemon (same `AuthMessage` component as the
  desktop app) with a made-up key: step 4 shows the new preset IDs and the notice
  "Could not load models from the provider. Enter model IDs manually."; one listing request per
  entered key. The populated list (real key) was not entered in the browser; it is covered by the
  DOM tests and Group A. Save was not clicked.
- Group C: not run (interactive tmux not available on this Windows host).
