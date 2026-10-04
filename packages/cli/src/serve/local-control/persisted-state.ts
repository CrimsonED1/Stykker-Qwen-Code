/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import path from 'node:path';
import { Storage } from '@qwen-code/qwen-code-core/config/storage.js';

/**
 * Whether the operator last left Local Control on, and on which address.
 *
 * Only the desktop app restores it: the app restarts its daemon on every
 * launch, and without this a phone paired over the LAN or tailnet loses
 * access on each restart until someone at the machine re-enables it. The
 * pairing token is never stored; a restored listener mints a fresh one.
 */
export interface PersistedLocalControlState {
  enabled: boolean;
  address?: string;
}

export function localControlStatePath(): string {
  return path.join(Storage.getGlobalQwenDir(), 'daemon', 'local-control.json');
}

export async function readLocalControlState(
  file = localControlStatePath(),
): Promise<PersistedLocalControlState | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as {
      enabled?: unknown;
      address?: unknown;
    };
    if (typeof parsed.enabled !== 'boolean') return undefined;
    return {
      enabled: parsed.enabled,
      ...(typeof parsed.address === 'string' && parsed.address
        ? { address: parsed.address }
        : {}),
    };
  } catch {
    return undefined;
  }
}

export async function writeLocalControlState(
  state: PersistedLocalControlState,
  file = localControlStatePath(),
): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(state)}\n`, 'utf8');
  await fs.rename(temp, file);
}
