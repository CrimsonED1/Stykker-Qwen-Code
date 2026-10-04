/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readLocalControlState,
  writeLocalControlState,
} from './persisted-state.js';

describe('persisted Local Control state', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'qwen-local-control-'));
    file = path.join(dir, 'daemon', 'local-control.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips the on/off choice and address', async () => {
    await writeLocalControlState(
      { enabled: true, address: '100.64.0.33' },
      file,
    );
    await expect(readLocalControlState(file)).resolves.toEqual({
      enabled: true,
      address: '100.64.0.33',
    });

    await writeLocalControlState({ enabled: false }, file);
    await expect(readLocalControlState(file)).resolves.toEqual({
      enabled: false,
    });
  });

  it('treats a missing or malformed file as no saved state', async () => {
    await expect(readLocalControlState(file)).resolves.toBeUndefined();
    await writeLocalControlState({ enabled: true }, file);
    await writeFile(file, '{"enabled":"yes"}');
    await expect(readLocalControlState(file)).resolves.toBeUndefined();
  });
});
