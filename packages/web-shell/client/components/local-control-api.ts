/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

export interface LanCandidate {
  interfaceName: string;
  address: string;
}

export interface LocalControlStatus {
  active: boolean;
  url?: string;
  /**
   * Set when the daemon withheld the pairing URL from this response because
   * the request carried no credentials (#9106); the URL is printed to the
   * daemon terminal instead.
   */
  urlRedacted?: boolean;
  qrText?: string;
  expiresInMs?: number;
  interfaceName?: string;
  address?: string;
  sleepInhibited?: boolean;
  encrypted?: boolean;
  interfaces?: LanCandidate[];
}

function resolveLocalControlUrl(baseUrl: string, path: string): URL {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\/+/, ''), base);
}

export class LocalControlRequestError extends Error {
  constructor(
    message: string,
    readonly payload?: LocalControlStatus,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LocalControlRequestError';
  }
}

export async function requestLocalControl(
  baseUrl: string,
  token: string | undefined,
  method: 'GET' | 'POST',
  path: string,
  body?: object,
): Promise<LocalControlStatus> {
  const headers = new Headers(
    token ? { Authorization: `Bearer ${token}` } : undefined,
  );
  if (body) headers.set('Content-Type', 'application/json');
  const response = await fetch(resolveLocalControlUrl(baseUrl, path), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    // A silently stalled socket must settle as an error so the caller's retry
    // path engages; 10 s stays under the QR popover's 15 s refresh horizon.
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let payload: (LocalControlStatus & { error?: string }) | undefined;
  try {
    payload = (text ? JSON.parse(text) : {}) as LocalControlStatus & {
      error?: string;
    };
  } catch {
    if (response.ok) throw new Error('Invalid Local Control response');
  }
  if (!response.ok) {
    throw new LocalControlRequestError(
      payload?.error?.trim() ||
        response.statusText ||
        `Local Control request failed (${response.status})`,
      payload,
      response.status,
    );
  }
  return payload!;
}

/**
 * The pairing secret a status URL carries in its fragment, or `undefined` when
 * it carries none.
 *
 * The fragment is deliberate — it keeps the secret out of server logs and
 * access logs — so a caller that needs the credential *on its own* has to pull
 * it back out. The phone's connect form has a bearer-token field of its own,
 * and the browser that opens a scanned QR is the operator's choice, not ours;
 * handing over just the token frees them from the QR without exposing the
 * secret anywhere new.
 */
export function pairingTokenFromUrl(
  url: string | undefined,
): string | undefined {
  if (!url) return undefined;
  let hash: string;
  try {
    hash = new URL(url).hash;
  } catch {
    return undefined;
  }
  const prefix = '#token=';
  if (!hash.startsWith(prefix)) return undefined;
  const raw = hash.slice(prefix.length);
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw) || undefined;
  } catch {
    // A malformed escape is still the secret the daemon minted; hand back the
    // bytes rather than nothing.
    return raw;
  }
}
