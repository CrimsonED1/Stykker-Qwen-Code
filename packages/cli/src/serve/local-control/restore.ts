/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RunHandle } from '../run-qwen-serve.js';
import { writeStderrLine } from '../../utils/stdioHelpers.js';
import {
  readLocalControlState,
  writeLocalControlState,
  type PersistedLocalControlState,
} from './persisted-state.js';
import type { LocalControlService, LocalControlStatus } from './service.js';

/**
 * Turn Local Control back on when the operator left it on before the desktop
 * app last quit. The address choice (LAN or tailnet) is kept, and so are the
 * pinned port and pairing credential when the operator has them — a phone that
 * paired once keeps the same link across launches. Without a pinned credential
 * (a state file written before this existed, or a plain CLI daemon) the
 * restored listener mints a fresh pairing token, so the paired device scans a
 * new QR; this launch then captures the port and credential it actually came
 * up with, so the link becomes permanent from the next launch on without a
 * re-pair. Best-effort: a missing network or address only logs.
 */
export async function restoreLocalControl(
  handle: Pick<
    RunHandle,
    'runtimeReady' | 'webShellMounted' | 'getLocalControl'
  >,
  readState: () => Promise<
    PersistedLocalControlState | undefined
  > = readLocalControlState,
  writeState: (
    state: PersistedLocalControlState,
  ) => Promise<void> = writeLocalControlState,
): Promise<void> {
  try {
    const state = await readState();
    if (!state?.enabled) return;
    await handle.runtimeReady;
    if (!handle.webShellMounted) return;
    const service = handle.getLocalControl();
    if (!service) return;
    const pinned =
      typeof state.port === 'number' &&
      state.pairingId !== undefined &&
      state.pairingSecret !== undefined;
    const status = await service.enable({
      ...(state.address ? { address: state.address } : {}),
      ...(typeof state.port === 'number' ? { port: state.port } : {}),
      ...(state.pairingId !== undefined && state.pairingSecret !== undefined
        ? { pairingToken: { id: state.pairingId, secret: state.pairingSecret } }
        : {}),
    });
    writeStderrLine(
      `qwen serve: Local Control restored on ${status.interfaceName ?? 'LAN'} (${status.address ?? 'unknown'}).`,
    );
    if (!pinned) await capturePin(state, status, service, writeState);
  } catch (err) {
    writeStderrLine(
      `qwen serve: Local Control was on before but could not be restored: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Record the port and credential this launch actually came up with.
 *
 * A state file written before the pin existed carries neither, so each launch
 * minted a fresh token on whatever port the daemon drew — and the phone's link
 * died at the next launch. Toggling Local Control off and on would capture the
 * same two values, but revokes the token on the way out and forces a re-pair;
 * the values in hand right now are the ones the paired phone is already using,
 * so capturing them here makes that link permanent instead of asking for a
 * re-pair the operator does not need.
 */
async function capturePin(
  state: PersistedLocalControlState,
  status: LocalControlStatus,
  service: LocalControlService,
  writeState: (state: PersistedLocalControlState) => Promise<void>,
): Promise<void> {
  const address = status.address ?? state.address;
  const credential = service.pairingCredential();
  try {
    await writeState({
      enabled: true,
      ...(address ? { address } : {}),
      ...(typeof status.port === 'number' ? { port: status.port } : {}),
      ...(credential
        ? { pairingId: credential.id, pairingSecret: credential.secret }
        : {}),
    });
  } catch (err) {
    writeStderrLine(
      `qwen serve: could not pin the Local Control pairing for the next launch: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
