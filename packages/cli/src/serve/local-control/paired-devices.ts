/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { Storage } from '@qwen-code/qwen-code-core/config/storage.js';
import type { CredentialStore } from './credentials.js';

/** Credential-store id prefix that marks a pairing entry as a device token. */
export const DEVICE_CREDENTIAL_PREFIX = 'device:';
const MAX_DEVICES = 32;
const LAST_SEEN_WRITE_INTERVAL_MS = 60_000;
const MAX_LABEL_LENGTH = 80;

export interface PairedDevice {
  id: string;
  /** Short human-checkable prefix of the token digest. Not the token. */
  fingerprint: string;
  label: string;
  address?: string;
  createdAt: string;
  lastSeenAt: string;
}

interface StoredDevice extends PairedDevice {
  /** sha256 of the device token, hex. The token itself is never stored. */
  tokenHash: string;
}

interface StoredState {
  rememberDevices: boolean;
  devices: StoredDevice[];
}

export function pairedDevicesPath(): string {
  return path.join(
    Storage.getGlobalQwenDir(),
    'daemon',
    'local-control-devices.json',
  );
}

/**
 * Devices that paired with Local Control, each holding its own token.
 *
 * The QR code carries one shared pairing secret. A phone that kept only that
 * secret could not be told apart from any other, and revoking one phone meant
 * revoking all of them. On its first authenticated request a scanning device
 * therefore trades the shared secret for a token of its own; the registry
 * keeps the digest, registers it with the credential store under
 * `device:<id>`, and persists the list so a paired phone survives a daemon
 * restart.
 *
 * `rememberDevices` is the operator's choice of how long a device keeps its
 * token: on, the Web Shell stores it for the browser profile; off, only for
 * the tab, which is the pre-existing behavior.
 */
export class PairedDeviceRegistry {
  readonly #credentials: CredentialStore;
  readonly #file: string | undefined;
  #state: StoredState = { rememberDevices: true, devices: [] };
  #lastSeenWrittenAt = 0;
  #write: Promise<void> = Promise.resolve();

  /**
   * `file` undefined keeps the list in memory only. The desktop app passes
   * the state path: it is the one deployment that restores Local Control on
   * launch, so it is the one where a paired phone should outlive the daemon.
   */
  constructor(credentials: CredentialStore, file?: string) {
    this.#credentials = credentials;
    this.#file = file;
    credentials.onPairingVerified = (pairingId) => {
      const id = deviceIdOf(pairingId);
      if (id) this.touch(id);
    };
    this.#load();
  }

  /**
   * Load the persisted list and re-register every device token digest.
   * Synchronous so the digests are in the credential store before the first
   * request can arrive — a phone's reconnect must not race a file read.
   */
  #load(): void {
    if (!this.#file) return;
    this.#state = readState(this.#file);
    for (const device of this.#state.devices) {
      this.#credentials.addPairingDigest(
        DEVICE_CREDENTIAL_PREFIX + device.id,
        Buffer.from(device.tokenHash, 'hex'),
      );
    }
  }

  get rememberDevices(): boolean {
    return this.#state.rememberDevices;
  }

  async setRememberDevices(value: boolean): Promise<void> {
    this.#state.rememberDevices = value;
    await this.#persist();
  }

  list(): PairedDevice[] {
    return this.#state.devices
      .map(({ tokenHash: _tokenHash, ...device }) => device)
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  /**
   * Mint a token for a newly scanned device. Returns `undefined` when the
   * list is full — the operator removes a device rather than the daemon
   * silently evicting one that may still be in use.
   */
  async add(input: {
    userAgent?: string;
    address?: string;
  }): Promise<{ device: PairedDevice; token: string } | undefined> {
    if (this.#state.devices.length >= MAX_DEVICES) return undefined;
    const token = randomBytes(32).toString('base64url');
    const digest = createHash('sha256').update(token, 'utf8').digest();
    const now = new Date().toISOString();
    const stored: StoredDevice = {
      id: randomUUID(),
      fingerprint: digest.toString('hex').slice(0, 8),
      label: describeUserAgent(input.userAgent),
      ...(input.address ? { address: input.address } : {}),
      createdAt: now,
      lastSeenAt: now,
      tokenHash: digest.toString('hex'),
    };
    this.#state.devices.push(stored);
    this.#credentials.addPairingDigest(
      DEVICE_CREDENTIAL_PREFIX + stored.id,
      digest,
    );
    await this.#persist();
    const { tokenHash: _tokenHash, ...device } = stored;
    return { device, token };
  }

  async remove(id: string): Promise<boolean> {
    const index = this.#state.devices.findIndex((device) => device.id === id);
    if (index === -1) return false;
    // Revoke before persisting: a failed write must not leave a token the
    // operator just deleted still able to authenticate.
    this.#credentials.revokePairingToken(DEVICE_CREDENTIAL_PREFIX + id);
    this.#state.devices.splice(index, 1);
    await this.#persist();
    return true;
  }

  /**
   * Record that a device was just seen. Called on every authenticated
   * request, so the write is throttled; the in-memory value is always fresh.
   */
  touch(id: string): void {
    const device = this.#state.devices.find((entry) => entry.id === id);
    if (!device) return;
    const now = Date.now();
    device.lastSeenAt = new Date(now).toISOString();
    if (now - this.#lastSeenWrittenAt < LAST_SEEN_WRITE_INTERVAL_MS) return;
    this.#lastSeenWrittenAt = now;
    void this.#persist().catch(() => {
      // Best-effort: last-seen is informational and the next touch retries.
    });
  }

  #persist(): Promise<void> {
    const file = this.#file;
    if (!file) return Promise.resolve();
    const snapshot = JSON.stringify(this.#state);
    this.#write = this.#write
      .catch(() => {})
      .then(() => writeState(file, snapshot));
    return this.#write;
  }
}

/** The device id behind a credential-store pairing id, if it names a device. */
export function deviceIdOf(pairingId: string | undefined): string | undefined {
  return pairingId?.startsWith(DEVICE_CREDENTIAL_PREFIX)
    ? pairingId.slice(DEVICE_CREDENTIAL_PREFIX.length)
    : undefined;
}

/**
 * A short "Browser · OS" label from a User-Agent header. Deliberately coarse:
 * it only has to let the operator tell their phone from their tablet.
 */
export function describeUserAgent(userAgent: string | undefined): string {
  const ua = (userAgent ?? '').slice(0, 512);
  const browser = /\bEdg(?:A|iOS)?\//.test(ua)
    ? 'Edge'
    : /\bOPR\//.test(ua)
      ? 'Opera'
      : /\bSamsungBrowser\//.test(ua)
        ? 'Samsung Internet'
        : /\b(?:Firefox|FxiOS)\//.test(ua)
          ? 'Firefox'
          : /\b(?:Chrome|CriOS)\//.test(ua)
            ? 'Chrome'
            : /\bSafari\//.test(ua)
              ? 'Safari'
              : undefined;
  const os = /\bAndroid\b/.test(ua)
    ? 'Android'
    : /\biPhone\b/.test(ua)
      ? 'iPhone'
      : /\biPad\b/.test(ua)
        ? 'iPad'
        : /\bWindows\b/.test(ua)
          ? 'Windows'
          : /\bMac OS X\b/.test(ua)
            ? 'macOS'
            : /\bLinux\b/.test(ua)
              ? 'Linux'
              : undefined;
  const label = [browser, os].filter(Boolean).join(' · ');
  return (label || ua.trim() || 'Unknown device').slice(0, MAX_LABEL_LENGTH);
}

function readState(file: string): StoredState {
  const empty: StoredState = { rememberDevices: true, devices: [] };
  let parsed: { rememberDevices?: unknown; devices?: unknown };
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8')) as typeof parsed;
  } catch {
    return empty;
  }
  if (typeof parsed !== 'object' || parsed === null) return empty;
  const devices = Array.isArray(parsed.devices)
    ? parsed.devices.filter(isStoredDevice).slice(0, MAX_DEVICES)
    : [];
  return {
    rememberDevices: parsed.rememberDevices !== false,
    devices,
  };
}

function isStoredDevice(value: unknown): value is StoredDevice {
  if (typeof value !== 'object' || value === null) return false;
  const device = value as Record<string, unknown>;
  return (
    typeof device['id'] === 'string' &&
    typeof device['tokenHash'] === 'string' &&
    /^[0-9a-f]{64}$/.test(device['tokenHash']) &&
    typeof device['fingerprint'] === 'string' &&
    typeof device['label'] === 'string' &&
    typeof device['createdAt'] === 'string' &&
    typeof device['lastSeenAt'] === 'string' &&
    (device['address'] === undefined || typeof device['address'] === 'string')
  );
}

async function writeState(file: string, snapshot: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  // Digests only, but they are still credential material: owner-only.
  await fs.writeFile(temp, `${snapshot}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temp, file);
}
