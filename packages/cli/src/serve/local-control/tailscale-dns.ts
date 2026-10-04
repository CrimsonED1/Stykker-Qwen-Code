/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

const CLI_TIMEOUT_MS = 3000;
const HOSTNAME =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function tailscaleBinaries(): string[] {
  const candidates = ['tailscale'];
  if (process.platform === 'win32') {
    candidates.push('C:\\Program Files\\Tailscale\\tailscale.exe');
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Tailscale.app/Contents/MacOS/Tailscale');
  }
  return candidates.filter(
    (binary) => binary === 'tailscale' || existsSync(binary),
  );
}

function runStatus(binary: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      binary,
      ['status', '--json', '--peers=false'],
      { timeout: CLI_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => resolve(error ? undefined : stdout),
    );
  });
}

/** Extracts this node's MagicDNS name from `tailscale status --json`. */
export function parseTailscaleDnsName(statusJson: string): string | undefined {
  try {
    const status = JSON.parse(statusJson) as { Self?: { DNSName?: unknown } };
    const name = status.Self?.DNSName;
    if (typeof name !== 'string') return undefined;
    const host = name.trim().replace(/\.$/, '').toLowerCase();
    return HOSTNAME.test(host) ? host : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The host's MagicDNS name (e.g. `host.tailnet.ts.net`), or `undefined` when
 * the Tailscale CLI is missing, slow, or MagicDNS is off. Callers fall back to
 * the tailnet IP, which works without MagicDNS.
 */
export async function resolveTailscaleDnsName(): Promise<string | undefined> {
  for (const binary of tailscaleBinaries()) {
    const stdout = await runStatus(binary);
    const name = stdout ? parseTailscaleDnsName(stdout) : undefined;
    if (name) return name;
  }
  return undefined;
}
