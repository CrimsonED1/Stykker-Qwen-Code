/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RunHandle } from '../run-qwen-serve.js';
import { writeStderrLine } from '../../utils/stdioHelpers.js';
import {
  readLocalControlState,
  type PersistedLocalControlState,
} from './persisted-state.js';

/**
 * Turn Local Control back on when the operator left it on before the desktop
 * app last quit. The restored listener mints a fresh pairing token, so a
 * paired device scans the new QR; the address choice (LAN or tailnet) is kept.
 * Best-effort: a missing network or address only logs.
 */
export async function restoreLocalControl(
  handle: Pick<
    RunHandle,
    'runtimeReady' | 'webShellMounted' | 'getLocalControl'
  >,
  readState: () => Promise<
    PersistedLocalControlState | undefined
  > = readLocalControlState,
): Promise<void> {
  try {
    const state = await readState();
    if (!state?.enabled) return;
    await handle.runtimeReady;
    if (!handle.webShellMounted) return;
    const service = handle.getLocalControl();
    if (!service) return;
    const status = await service.enable(
      state.address ? { address: state.address } : {},
    );
    writeStderrLine(
      `qwen serve: Local Control restored on ${status.interfaceName ?? 'LAN'} (${status.address ?? 'unknown'}).`,
    );
  } catch (err) {
    writeStderrLine(
      `qwen serve: Local Control was on before but could not be restored: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
