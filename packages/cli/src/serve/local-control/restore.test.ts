/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { restoreLocalControl } from './restore.js';

function handleWith(
  enable: ReturnType<typeof vi.fn>,
  pairingCredential: () => { id: string; secret: string } | undefined = () =>
    undefined,
) {
  return {
    webShellMounted: true,
    runtimeReady: Promise.resolve(),
    getLocalControl: () => ({ enable, pairingCredential }),
  } as unknown as Parameters<typeof restoreLocalControl>[0];
}

function noopWrite() {
  return vi.fn(async () => {});
}

describe('restoreLocalControl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('re-enables Local Control on the saved address', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const enable = vi.fn().mockResolvedValue({
      active: true,
      interfaceName: 'Tailscale',
      address: '100.64.0.33',
    });
    await restoreLocalControl(
      handleWith(enable),
      async () => ({
        enabled: true,
        address: '100.64.0.33',
      }),
      noopWrite(),
    );
    expect(enable).toHaveBeenCalledWith({ address: '100.64.0.33' });
  });

  it('forwards the pinned port and pairing credential', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const enable = vi.fn().mockResolvedValue({ active: true });
    await restoreLocalControl(
      handleWith(enable),
      async () => ({
        enabled: true,
        address: '192.168.1.100',
        port: 4171,
        pairingId: 'pinned-id',
        pairingSecret: 'pinned-secret',
      }),
      noopWrite(),
    );
    expect(enable).toHaveBeenCalledWith({
      address: '192.168.1.100',
      port: 4171,
      pairingToken: { id: 'pinned-id', secret: 'pinned-secret' },
    });
  });

  it('captures the live port and credential when the saved state has none', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const enable = vi.fn().mockResolvedValue({
      active: true,
      interfaceName: 'Tailscale',
      address: '100.64.0.33',
      port: 63340,
    });
    const writeState = noopWrite();
    await restoreLocalControl(
      handleWith(enable, () => ({ id: 'live-id', secret: 'live-secret' })),
      async () => ({ enabled: true, address: '100.64.0.33' }),
      writeState,
    );
    expect(writeState).toHaveBeenCalledWith({
      enabled: true,
      address: '100.64.0.33',
      port: 63340,
      pairingId: 'live-id',
      pairingSecret: 'live-secret',
    });
  });

  it('does not rewrite a state that is already pinned', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const enable = vi.fn().mockResolvedValue({
      active: true,
      address: '192.168.1.100',
      port: 4171,
    });
    const writeState = noopWrite();
    await restoreLocalControl(
      handleWith(enable, () => ({ id: 'live-id', secret: 'live-secret' })),
      async () => ({
        enabled: true,
        address: '192.168.1.100',
        port: 4171,
        pairingId: 'pinned-id',
        pairingSecret: 'pinned-secret',
      }),
      writeState,
    );
    expect(writeState).not.toHaveBeenCalled();
  });

  it('only logs when the pin cannot be written', async () => {
    const stderr: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
    const enable = vi.fn().mockResolvedValue({ active: true, port: 4171 });
    await expect(
      restoreLocalControl(
        handleWith(enable, () => ({ id: 'live-id', secret: 'live-secret' })),
        async () => ({ enabled: true }),
        vi.fn(async () => {
          throw new Error('disk full');
        }),
      ),
    ).resolves.toBeUndefined();
    expect(stderr.join('')).toContain(
      'could not pin the Local Control pairing for the next launch: disk full',
    );
  });

  it('leaves Local Control off when it was off or never saved', async () => {
    const enable = vi.fn();
    await restoreLocalControl(handleWith(enable), async () => ({
      enabled: false,
    }));
    await restoreLocalControl(handleWith(enable), async () => undefined);
    expect(enable).not.toHaveBeenCalled();
  });

  it('only logs when the saved address is gone', async () => {
    const stderr: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
    const enable = vi.fn().mockRejectedValue(new Error('address gone'));
    await expect(
      restoreLocalControl(handleWith(enable), async () => ({
        enabled: true,
        address: '10.0.0.9',
      })),
    ).resolves.toBeUndefined();
    expect(stderr.join('')).toContain('could not be restored: address gone');
  });
});
