/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { persistDaemonToken } from './daemon';

/**
 * Trade a scanned Local Control pairing secret for a token of this device's
 * own, and store it the way the daemon asks ("remember devices" or per-tab).
 *
 * The QR code carries one secret shared by every device that scans it. With a
 * token of its own the device shows up in the daemon's paired-device list and
 * can be revoked there without cutting off the others. Returns the token to
 * use from now on; any failure keeps the scanned one, which is the behavior
 * of a daemon that predates device tokens.
 */
export async function enrollLocalControlDevice(
  baseUrl: string,
  scannedToken: string,
  previousToken?: string,
): Promise<string> {
  if (baseUrl !== window.location.origin) return scannedToken;
  try {
    const response = await fetch(`${baseUrl}/workspace/local-control/devices`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${scannedToken}`,
        'Content-Type': 'application/json',
      },
      // A device that already holds a token re-scans without becoming a
      // second entry in the list.
      body: JSON.stringify(
        previousToken && previousToken !== scannedToken
          ? { previousToken }
          : {},
      ),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return scannedToken;
    const payload = (await response.json()) as {
      token?: unknown;
      reused?: unknown;
      rememberDevices?: unknown;
    };
    const token =
      typeof payload.token === 'string' && payload.token
        ? payload.token
        : payload.reused === true && previousToken
          ? previousToken
          : scannedToken;
    persistDaemonToken(token, baseUrl, {
      remember: payload.rememberDevices === true && token !== scannedToken,
    });
    return token;
  } catch {
    return scannedToken;
  }
}

export async function exchangePairingCode(
  baseUrl: string,
): Promise<{ token?: string; failed?: boolean } | undefined> {
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const code = fragment.get('pairing');
  // An empty `#pairing=` can never match the server's bearer shape, so it is
  // left in the hash and unexchanged rather than POSTed into a certain 401.
  if (!code) return undefined;
  fragment.delete('pairing');
  url.hash = fragment.toString();
  window.history.replaceState(window.history.state, '', url);
  if (baseUrl !== window.location.origin) return { failed: true };
  try {
    const response = await fetch(`${baseUrl}/web-shell/pairing/exchange`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${code}` },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { failed: true };
    const payload = (await response.json()) as { token?: unknown };
    if (typeof payload.token !== 'string' || !payload.token)
      return { failed: true };
    persistDaemonToken(payload.token, baseUrl);
    return { token: payload.token };
  } catch {
    return { failed: true };
  }
}
