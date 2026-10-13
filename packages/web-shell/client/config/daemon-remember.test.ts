// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'qwen-daemon-token';

describe('remembered daemon token', () => {
  beforeEach(() => {
    vi.resetModules();
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('keeps a remembered token after the tab, and its sessionStorage, is gone', async () => {
    const first = await import('./daemon');
    first.persistDaemonToken('device-token', undefined, { remember: true });
    expect(window.localStorage.getItem(KEY)).toBe('device-token');

    // A discarded mobile tab comes back with empty sessionStorage and a
    // fresh module instance.
    window.sessionStorage.clear();
    vi.resetModules();
    const second = await import('./daemon');

    expect(second.getDaemonToken()).toBe('device-token');
    expect(second.hasReloadSurvivableDaemonToken()).toBe(true);
  });

  it('stores per-tab only unless asked to remember', async () => {
    const mod = await import('./daemon');
    mod.persistDaemonToken('tab-token');

    expect(window.sessionStorage.getItem(KEY)).toBe('tab-token');
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('re-persisting the remembered token does not forget it', async () => {
    const mod = await import('./daemon');
    mod.persistDaemonToken('device-token', undefined, { remember: true });
    mod.persistDaemonToken('device-token');

    expect(window.localStorage.getItem(KEY)).toBe('device-token');
  });

  it('drops a remembered token when a different one replaces it', async () => {
    const mod = await import('./daemon');
    mod.persistDaemonToken('device-token', undefined, { remember: true });
    mod.persistDaemonToken('other-token');

    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBe('other-token');
  });

  it('clears both copies on sign-out and on remember: false', async () => {
    const mod = await import('./daemon');
    mod.persistDaemonToken('device-token', undefined, { remember: true });
    mod.persistDaemonToken('device-token', undefined, { remember: false });
    expect(window.localStorage.getItem(KEY)).toBeNull();

    mod.persistDaemonToken('device-token', undefined, { remember: true });
    mod.persistDaemonToken('');
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it('peeks the stored token without reading the URL', async () => {
    const mod = await import('./daemon');
    expect(mod.peekStoredDaemonToken()).toBeUndefined();
    mod.persistDaemonToken('device-token', undefined, { remember: true });
    window.sessionStorage.clear();

    expect(mod.peekStoredDaemonToken()).toBe('device-token');
  });
});
