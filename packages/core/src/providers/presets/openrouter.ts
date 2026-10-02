/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthType } from '../../core/contentGenerator.js';
import type { ProviderConfig } from '../types.js';

export const OPENROUTER_ENV_KEY = 'OPENROUTER_API_KEY';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export const openRouterProvider: ProviderConfig = {
  id: 'openrouter',
  label: 'OpenRouter',
  description:
    'Connect with an OpenRouter API key (get one from openrouter.ai/keys)',
  protocol: AuthType.USE_OPENAI,
  baseUrl: OPENROUTER_BASE_URL,
  envKey: OPENROUTER_ENV_KEY,
  models: [
    { id: 'qwen/qwen3.8-27b:free', contextWindowSize: 262144 },
    {
      id: 'nvidia/nemotron-3-super-120b-a12b:free',
      contextWindowSize: 262144,
    },
  ],
  modelsEditable: true,
  supportsModelDiscovery: true,
  // `/models` is the public catalog; `/models/user` applies the key's
  // provider and guardrail restrictions, so it lists only usable models.
  modelListPath: '/models/user',
  modelNamePrefix: 'OpenRouter',
  ownsModel: (model) => {
    if (model.envKey !== OPENROUTER_ENV_KEY) return false;
    try {
      const host = new URL(model.baseUrl ?? '').hostname;
      return host === 'openrouter.ai' || host.endsWith('.openrouter.ai');
    } catch {
      return false;
    }
  },
  customHeaders: {
    'HTTP-Referer': 'https://github.com/QwenLM/qwen-code.git',
    'X-OpenRouter-Title': 'Qwen Code',
  },
  documentationUrl: 'https://openrouter.ai/docs',
  uiGroup: 'third-party',
};
