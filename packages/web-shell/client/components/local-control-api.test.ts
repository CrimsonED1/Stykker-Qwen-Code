/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { pairingTokenFromUrl } from './local-control-api.js';

describe('pairingTokenFromUrl', () => {
  it('returns the fragment secret', () => {
    expect(pairingTokenFromUrl('https://host:4170/#token=abc123')).toBe(
      'abc123',
    );
    expect(pairingTokenFromUrl('http://192.168.1.100:4170/#token=abc123')).toBe(
      'abc123',
    );
  });

  it('decodes what the daemon encoded', () => {
    expect(pairingTokenFromUrl('https://host/#token=a%2Bb%3Dc')).toBe('a+b=c');
  });

  it('ignores a URL with no token fragment', () => {
    expect(pairingTokenFromUrl(undefined)).toBeUndefined();
    expect(pairingTokenFromUrl('')).toBeUndefined();
    expect(pairingTokenFromUrl('https://host:4170/')).toBeUndefined();
    expect(pairingTokenFromUrl('https://host:4170/#')).toBeUndefined();
    expect(pairingTokenFromUrl('https://host:4170/#token=')).toBeUndefined();
    // The other fragment writer on this URL is the pairing invitation, which
    // is an invitation and not a credential.
    expect(
      pairingTokenFromUrl('https://host:4170/#pairing=abc'),
    ).toBeUndefined();
  });

  it('ignores a string that is not a URL', () => {
    expect(pairingTokenFromUrl('/#token=abc')).toBeUndefined();
    expect(pairingTokenFromUrl('not a url')).toBeUndefined();
  });

  it('keeps the bytes when the fragment is not validly encoded', () => {
    expect(pairingTokenFromUrl('https://host/#token=%E0%A4%A')).toBe(
      '%E0%A4%A',
    );
  });
});
