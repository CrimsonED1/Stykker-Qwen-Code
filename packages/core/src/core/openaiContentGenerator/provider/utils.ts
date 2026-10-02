/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import type OpenAI from 'openai';
import type { ExtendedChatCompletionAssistantMessageParam } from '../converter.js';

// Some thinking-mode OpenAI-compatible APIs require `reasoning_content` to be
// replayed on every prior assistant turn, even when the model returned no
// visible reasoning text for that turn.
export function ensureReasoningContentOnAssistantMessage(
  message: OpenAI.Chat.ChatCompletionMessageParam,
): OpenAI.Chat.ChatCompletionMessageParam {
  if (message.role !== 'assistant') {
    return message;
  }

  const assistant = message as ExtendedChatCompletionAssistantMessageParam;
  if (typeof assistant.reasoning_content === 'string') {
    return message;
  }

  return {
    ...assistant,
    reasoning_content: '',
  } as OpenAI.Chat.ChatCompletionMessageParam;
}

// Gates that require a function tool to always carry a schema reject a
// parameterless tool outright (MiniMax `400 invalid params, function
// parameters is empty (2013)`, #11834; OpenRouter `JSON error injected into
// SSE stream`). converter.ts deliberately omits `parameters` for a declared
// empty argument list (#11431) because the endpoints #10080 was written for
// (llama.cpp, LM Studio, vLLM) reject the empty-object shape, so restore it
// here at the wire boundary instead. The predicate tests the value, not key
// presence: a converter-shaped tool carries `parameters: undefined` present.
export function ensureToolParameters(
  tools: OpenAI.Chat.ChatCompletionTool[],
): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((tool) =>
    tool.function.parameters === undefined
      ? {
          ...tool,
          function: {
            ...tool.function,
            parameters: { type: 'object', properties: {} },
          },
        }
      : tool,
  );
}

// Some strict OpenAI-compatible endpoints (Mistral, Cerebras) reject the
// non-standard `reasoning_content` field on input with HTTP 400. Shared
// conversation history must stay intact for providers that require the
// replay; remove the field only at the outbound request boundary.
export function stripReasoningContent(
  message: OpenAI.Chat.ChatCompletionMessageParam,
): OpenAI.Chat.ChatCompletionMessageParam {
  if (!('reasoning_content' in message)) {
    return message;
  }

  const next = { ...(message as unknown as Record<string, unknown>) };
  delete next['reasoning_content'];
  return next as unknown as OpenAI.Chat.ChatCompletionMessageParam;
}
