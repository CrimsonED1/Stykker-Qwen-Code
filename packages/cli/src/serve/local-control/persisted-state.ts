/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { Storage } from '@qwen-code/qwen-code-core/config/storage.js';

/**
 * Whether the operator last left Local Control on, on which address, and —
 * for the desktop app — the port and pairing credential a restart must
 * reproduce.
 *
 * Only the desktop app restores it: the app restarts its daemon on every
 * launch, and without this a phone paired over the LAN or tailnet loses
 * access on each restart until someone at the machine re-enables it.
 *
 * A plain CLI daemon keeps only the on/off choice and the address, and mints
 * a fresh pairing token on restore. The desktop app additionally pins the
 * port and the pairing credential, so an already-paired phone keeps the same
 * link across launches instead of re-scanning a QR every time.
 */
export interface PersistedLocalControlState {
  enabled: boolean;
  address?: string;
  /**
   * Port for the LAN listener. Absent keeps the daemon's own port, which is
   * what the CLI has always done; the desktop app pins it so the paired
   * phone's saved address survives a restart.
   */
  port?: number;
  /**
   * A pinned pairing credential, stored as its two halves. Both must be
   * present to be reused; one without the other is treated as absent, so a
   * half-written file degrades to "mint a fresh credential" rather than to a
   * credential nobody holds.
   */
  pairingId?: string;
  pairingSecret?: string;
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
      port?: unknown;
      pairingId?: unknown;
      pairingSecret?: unknown;
    };
    if (typeof parsed.enabled !== 'boolean') return undefined;
    const pairingId =
      typeof parsed.pairingId === 'string' && parsed.pairingId
        ? parsed.pairingId
        : undefined;
    const pairingSecret =
      typeof parsed.pairingSecret === 'string' && parsed.pairingSecret
        ? parsed.pairingSecret
        : undefined;
    return {
      enabled: parsed.enabled,
      ...(typeof parsed.address === 'string' && parsed.address
        ? { address: parsed.address }
        : {}),
      ...(typeof parsed.port === 'number' &&
      Number.isInteger(parsed.port) &&
      parsed.port > 0 &&
      parsed.port <= 65535
        ? { port: parsed.port }
        : {}),
      ...(pairingId !== undefined && pairingSecret !== undefined
        ? { pairingId, pairingSecret }
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

export function desktopLanTlsDirectory(): string {
  return path.join(Storage.getGlobalQwenDir(), 'daemon', 'tls');
}

/**
 * Certificates the desktop app may drop in for its phone-facing LAN listener.
 *
 * The desktop daemon always binds loopback over plain HTTP — its own window
 * must keep loading `http://127.0.0.1`, and the Tauri shell builds that URL
 * from the runtime's own listening line — so it never passes
 * `--tls-cert`/`--tls-key`. The LAN listener is the surface that needs a
 * secure context (service worker, microphone), so it reads its certificate
 * from a well-known directory instead. Both halves must be present; anything
 * else leaves the listener on plain HTTP rather than failing the app.
 */
export function desktopLanTlsPaths(
  dir = desktopLanTlsDirectory(),
): { cert: string; key: string } | undefined {
  if (process.env['QWEN_CODE_DESKTOP'] !== '1') return undefined;
  const cert = path.join(dir, 'cert.pem');
  const key = path.join(dir, 'key.pem');
  try {
    return existsSync(cert) && existsSync(key) ? { cert, key } : undefined;
  } catch {
    return undefined;
  }
}
