/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { fetchWithPolicy } from '../utils/fetch.js';
import type { ModelSpec } from './types.js';

const DISCOVERY_TIMEOUT_MS = 5000;
const DISCOVERY_MAX_BYTES = 1024 * 1024;
const MAX_MODEL_ID_LENGTH = 256;
// The wizard joins ids with commas and renders them raw, so a served id with
// a comma or a code point in the Unicode C (other) category would split into
// bogus models or poison the TUI.
const UNSAFE_MODEL_ID_CHARS = /[,\p{C}\p{Zl}\p{Zp}]/u;

interface DiscoverProviderModelsOptions {
  baseUrl: string;
  apiKey: string;
  staticModels: readonly ModelSpec[];
  /** Catalog path below the base URL; defaults to `/models`. */
  modelListPath?: string;
  signal?: AbortSignal;
}

interface DiscoveredModel {
  id: string;
  created?: number;
  contextLength?: number;
}

function readModels(value: unknown): DiscoveredModel[] | null {
  if (!value || typeof value !== 'object' || !('data' in value)) {
    return null;
  }
  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return null;
  }

  const models: DiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const item of data) {
    if (!item || typeof item !== 'object' || !('id' in item)) {
      return null;
    }
    const id = (item as { id?: unknown }).id;
    if (typeof id !== 'string') {
      return null;
    }
    const trimmedId = id.trim();
    if (
      trimmedId &&
      trimmedId.length <= MAX_MODEL_ID_LENGTH &&
      !UNSAFE_MODEL_ID_CHARS.test(trimmedId) &&
      !seen.has(trimmedId)
    ) {
      seen.add(trimmedId);
      const created = (item as { created?: unknown }).created;
      const creationTime =
        typeof created === 'number' && Number.isFinite(created) && created >= 0
          ? created
          : undefined;
      // OpenRouter-style catalogs report the window as `context_length`.
      const contextLength = (item as { context_length?: unknown })
        .context_length;
      models.push({
        id: trimmedId,
        ...(creationTime === undefined ? {} : { created: creationTime }),
        ...(typeof contextLength === 'number' &&
        Number.isSafeInteger(contextLength) &&
        contextLength > 0
          ? { contextLength }
          : {}),
      });
    }
  }
  return models.length > 0 ? models : null;
}

function mergeModelSpecs(
  discoveredModels: DiscoveredModel[],
  staticModels: readonly ModelSpec[],
): ModelSpec[] {
  const staticModelsById = new Map(
    staticModels.map((model) => [model.id, model]),
  );
  const orderedModels = [...discoveredModels];
  if (orderedModels.every((model) => model.created !== undefined)) {
    orderedModels.sort(
      (left, right) => (right.created ?? 0) - (left.created ?? 0),
    );
  }
  return orderedModels.map(
    ({ id, contextLength }) =>
      staticModelsById.get(id) ??
      (contextLength === undefined
        ? { id }
        : { id, contextWindowSize: contextLength }),
  );
}

export async function discoverProviderModels({
  baseUrl,
  apiKey,
  staticModels,
  modelListPath = '/models',
  signal,
}: DiscoverProviderModelsOptions): Promise<ModelSpec[] | null> {
  const normalizedBaseUrl = baseUrl.trim();
  const normalizedApiKey = apiKey.trim();
  if (!normalizedBaseUrl || !normalizedApiKey) {
    return null;
  }

  try {
    const modelsUrl = `${normalizedBaseUrl.replace(/\/+$/, '')}/${modelListPath.replace(/^\/+/, '')}`;
    const result = await fetchWithPolicy(modelsUrl, {
      timeoutMs: DISCOVERY_TIMEOUT_MS,
      maxBytes: DISCOVERY_MAX_BYTES,
      maxRedirects: 2,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${normalizedApiKey}`,
      },
      signal,
    });
    if (
      result.kind !== 'response' ||
      result.status < 200 ||
      result.status >= 300
    ) {
      return null;
    }

    const models = readModels(JSON.parse(result.body.toString('utf8')));
    return models ? mergeModelSpecs(models, staticModels) : null;
  } catch {
    return null;
  }
}
