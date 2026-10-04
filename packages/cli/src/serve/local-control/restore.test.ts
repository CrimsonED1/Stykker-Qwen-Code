/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { restoreLocalControl } from './restore.js';

function handleWith(enable: ReturnType<typeof vi.fn>) {
  return {
    webShellMounted: true,
    runtimeReady: Promise.resolve(),
    getLocalControl: () => ({ enable }),
  } as unknown as Parameters<typeof restoreLocalControl>[0];
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
    await restoreLocalControl(handleWith(enable), async () => ({
      enabled: true,
      address: '100.64.0.33',
    }));
    expect(enable).toHaveBeenCalledWith({ address: '100.64.0.33' });
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
