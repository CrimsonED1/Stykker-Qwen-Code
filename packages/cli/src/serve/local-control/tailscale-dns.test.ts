/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { parseTailscaleDnsName } from './tailscale-dns.js';

describe('parseTailscaleDnsName', () => {
  it('returns the MagicDNS name without the trailing dot', () => {
    expect(
      parseTailscaleDnsName(
        JSON.stringify({ Self: { DNSName: 'Crim10.tail85052b.ts.net.' } }),
      ),
    ).toBe('crim10.tail85052b.ts.net');
  });

  it.each([
    ['MagicDNS off', JSON.stringify({ Self: { DNSName: '' } })],
    ['no Self', JSON.stringify({})],
    ['not a host name', JSON.stringify({ Self: { DNSName: 'a b/c' } })],
    ['invalid JSON', '{'],
  ])('falls back for %s', (_label, json) => {
    expect(parseTailscaleDnsName(json)).toBeUndefined();
  });
});
