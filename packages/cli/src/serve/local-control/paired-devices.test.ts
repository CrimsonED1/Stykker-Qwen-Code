/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CredentialStore } from './credentials.js';
import {
  DEVICE_CREDENTIAL_PREFIX,
  PairedDeviceRegistry,
  describeUserAgent,
  deviceIdOf,
} from './paired-devices.js';

const LAN = {
  kind: 'local-control',
  authority: '192.168.1.5:4170',
  origin: 'http://192.168.1.5:4170',
} as const;
const PRIMARY = { kind: 'primary' } as const;

const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

describe('PairedDeviceRegistry', () => {
  const dirs: string[] = [];
  const stateFile = () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'qwen-paired-devices-'));
    dirs.push(dir);
    return path.join(dir, 'daemon', 'local-control-devices.json');
  };

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('mints a device token that authenticates on the LAN listener only', async () => {
    const credentials = new CredentialStore('runtime-token');
    const registry = new PairedDeviceRegistry(credentials);

    const added = await registry.add({
      userAgent: ANDROID_CHROME,
      address: '192.168.1.20',
    });

    expect(added?.device.label).toBe('Chrome · Android');
    expect(added?.device.address).toBe('192.168.1.20');
    expect(credentials.verify(added!.token, LAN)).toBe(true);
    expect(credentials.verify(added!.token, PRIMARY)).toBe(false);
    expect(deviceIdOf(credentials.pairingIdOf(added!.token))).toBe(
      added!.device.id,
    );
  });

  it('revokes exactly the removed device', async () => {
    const credentials = new CredentialStore('runtime-token');
    const registry = new PairedDeviceRegistry(credentials);
    const phone = await registry.add({ userAgent: ANDROID_CHROME });
    const tablet = await registry.add({ userAgent: IPHONE_SAFARI });

    expect(await registry.remove(phone!.device.id)).toBe(true);

    expect(credentials.verify(phone!.token, LAN)).toBe(false);
    expect(credentials.verify(tablet!.token, LAN)).toBe(true);
    expect(registry.list().map((device) => device.id)).toEqual([
      tablet!.device.id,
    ]);
    expect(await registry.remove(phone!.device.id)).toBe(false);
  });

  it('persists digests, never tokens, and restores them after a restart', async () => {
    const file = stateFile();
    const first = new PairedDeviceRegistry(new CredentialStore('t'), file);
    const added = await first.add({ userAgent: IPHONE_SAFARI });
    await first.setRememberDevices(false);

    const onDisk = readFileSync(file, 'utf8');
    expect(onDisk).not.toContain(added!.token);
    expect(onDisk).toContain(added!.device.fingerprint);

    const credentials = new CredentialStore('t');
    const restored = new PairedDeviceRegistry(credentials, file);

    expect(restored.rememberDevices).toBe(false);
    expect(restored.list()).toHaveLength(1);
    expect(restored.list()[0]).not.toHaveProperty('tokenHash');
    expect(credentials.verify(added!.token, LAN)).toBe(true);
  });

  it('remembers devices by default and survives an unreadable state file', () => {
    const registry = new PairedDeviceRegistry(
      new CredentialStore('t'),
      path.join(tmpdir(), 'qwen-paired-devices-missing', 'none.json'),
    );

    expect(registry.rememberDevices).toBe(true);
    expect(registry.list()).toEqual([]);
  });

  it('updates last-seen when a device token authenticates', async () => {
    const credentials = new CredentialStore('t');
    const registry = new PairedDeviceRegistry(credentials);
    const added = await registry.add({ userAgent: ANDROID_CHROME });
    const before = registry.list()[0]!.lastSeenAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    credentials.verify(added!.token, LAN);

    expect(registry.list()[0]!.lastSeenAt > before).toBe(true);
  });

  it('refuses a device beyond the limit instead of evicting one', async () => {
    const registry = new PairedDeviceRegistry(new CredentialStore('t'));
    for (let i = 0; i < 32; i++) {
      expect(await registry.add({})).toBeDefined();
    }

    expect(await registry.add({})).toBeUndefined();
  });
});

describe('describeUserAgent', () => {
  it('labels common browsers and platforms', () => {
    expect(describeUserAgent(ANDROID_CHROME)).toBe('Chrome · Android');
    expect(describeUserAgent(IPHONE_SAFARI)).toBe('Safari · iPhone');
    expect(describeUserAgent(undefined)).toBe('Unknown device');
    expect(describeUserAgent('curl/8.9.1')).toBe('curl/8.9.1');
  });
});

describe('deviceIdOf', () => {
  it('distinguishes device tokens from the shared pairing secret', () => {
    expect(deviceIdOf(`${DEVICE_CREDENTIAL_PREFIX}abc`)).toBe('abc');
    expect(deviceIdOf('8b46ff31-shared-pairing-id')).toBeUndefined();
    expect(deviceIdOf(undefined)).toBeUndefined();
  });
});
