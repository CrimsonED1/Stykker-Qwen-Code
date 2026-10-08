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
  desktopLanTlsPaths,
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

  it('round-trips a pinned port and pairing credential', async () => {
    await writeLocalControlState(
      {
        enabled: true,
        address: '192.168.1.100',
        port: 4171,
        pairingId: 'pinned-id',
        pairingSecret: 'pinned-secret',
      },
      file,
    );
    await expect(readLocalControlState(file)).resolves.toEqual({
      enabled: true,
      address: '192.168.1.100',
      port: 4171,
      pairingId: 'pinned-id',
      pairingSecret: 'pinned-secret',
    });
  });

  it('drops half a credential and a nonsensical port', async () => {
    // One half of the credential is not a credential: reuse would hand out an
    // id nobody holds. Degrade to "mint a fresh one" instead.
    await writeLocalControlState({ enabled: true, pairingId: 'only-id' }, file);
    await expect(readLocalControlState(file)).resolves.toEqual({
      enabled: true,
    });

    await writeLocalControlState({ enabled: true, port: 0 }, file);
    await writeFile(file, '{"enabled":true,"port":70000}');
    await expect(readLocalControlState(file)).resolves.toEqual({
      enabled: true,
    });
    await writeFile(file, '{"enabled":true,"port":"4171"}');
    await expect(readLocalControlState(file)).resolves.toEqual({
      enabled: true,
    });
  });
});

describe('desktop LAN TLS lookup', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'qwen-lan-tls-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('needs the desktop flag and both halves of the pair', async () => {
    const previous = process.env['QWEN_CODE_DESKTOP'];
    try {
      delete process.env['QWEN_CODE_DESKTOP'];
      await writeFile(path.join(dir, 'cert.pem'), 'cert');
      await writeFile(path.join(dir, 'key.pem'), 'key');
      // Files alone are not enough: an ordinary CLI daemon keeps its own
      // --tls-cert/--tls-key contract.
      expect(desktopLanTlsPaths(dir)).toBeUndefined();

      process.env['QWEN_CODE_DESKTOP'] = '1';
      expect(desktopLanTlsPaths(dir)).toEqual({
        cert: path.join(dir, 'cert.pem'),
        key: path.join(dir, 'key.pem'),
      });

      // Half a pair leaves the listener on plain HTTP, not a broken TLS boot.
      await rm(path.join(dir, 'key.pem'));
      expect(desktopLanTlsPaths(dir)).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env['QWEN_CODE_DESKTOP'];
      else process.env['QWEN_CODE_DESKTOP'] = previous;
    }
  });
});
