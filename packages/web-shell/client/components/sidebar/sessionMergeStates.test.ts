/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaemonWorkspaceMergeState } from '@qwen-code/sdk/daemon';
import {
  ensureMergeStates,
  getMergeStates,
  mergeProbeCwd,
  resetMergeStates,
  subscribeMergeStates,
} from './sessionMergeStates';

const state = (
  over: Partial<DaemonWorkspaceMergeState> &
    Pick<DaemonWorkspaceMergeState, 'kind'>,
): DaemonWorkspaceMergeState => ({ ahead: 0, checkedAt: Date.now(), ...over });

function session(over: Record<string, unknown>) {
  return { sessionId: 's1', ...over } as never;
}

beforeEach(() => {
  resetMergeStates();
});

afterEach(() => {
  resetMergeStates();
  vi.useRealTimers();
});

describe('mergeProbeCwd', () => {
  it('probes the worktree path for a worktree session', () => {
    // The workspace HEAD would answer for every row in the list; only the
    // worktree's own checkout says anything about this session's branch.
    expect(
      mergeProbeCwd(
        session({
          workspaceCwd: '/work/main',
          worktree: {
            slug: 'wt',
            path: '/work/main/.qwen/worktrees/wt',
            branch: 'wt',
          },
        }),
        '/fallback',
      ),
    ).toBe('/work/main/.qwen/worktrees/wt');
  });

  it('falls back to the workspace cwd for a plain branch session', () => {
    expect(
      mergeProbeCwd(
        session({ branch: { name: 'feature' }, workspaceCwd: '/work/main' }),
        '/fallback',
      ),
    ).toBe('/work/main');
    expect(
      mergeProbeCwd(session({ branch: { name: 'feature' } }), '/fallback'),
    ).toBe('/fallback');
  });

  it('probes nothing for a session with no git at all', () => {
    expect(
      mergeProbeCwd(session({ workspaceCwd: '/work/main' }), '/fallback'),
    ).toBeUndefined();
  });
});

describe('ensureMergeStates', () => {
  it('fetches each distinct directory once and publishes the result', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(state({ kind: 'merged', baseRef: 'origin/skymain' }));

    ensureMergeStates([
      { cwd: '/work/main', fetch },
      { cwd: '/work/main', fetch },
      { cwd: '/work/other', fetch },
    ]);
    await vi.waitFor(() => expect(getMergeStates().size).toBe(2));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getMergeStates().get('/work/main')).toMatchObject({
      kind: 'merged',
    });
  });

  it('shares one in-flight request between concurrent callers', async () => {
    const fetch = vi.fn().mockResolvedValue(state({ kind: 'merged' }));

    ensureMergeStates([{ cwd: '/work/main', fetch }]);
    ensureMergeStates([{ cwd: '/work/main', fetch }]);

    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(getMergeStates().size).toBe(1));
  });

  it('serves a fresh state from cache without a new request', async () => {
    const fetch = vi.fn().mockResolvedValue(state({ kind: 'merged' }));
    ensureMergeStates([{ cwd: '/work/main', fetch }]);
    await vi.waitFor(() => expect(getMergeStates().size).toBe(1));

    ensureMergeStates([{ cwd: '/work/main', fetch }]);
    await Promise.resolve();

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('re-probes a state older than the client age limit', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        state({ kind: 'unmerged', checkedAt: Date.now() - 60_000 }),
      );

    ensureMergeStates([{ cwd: '/work/main', fetch }]);
    await vi.waitFor(() => expect(getMergeStates().size).toBe(1));

    ensureMergeStates([{ cwd: '/work/main', fetch }]);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });

  it('stores nothing when the probe fails', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('offline'));

    ensureMergeStates([{ cwd: '/work/main', fetch }]);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());

    // An empty slot is the honest answer; a fabricated "merged" is not.
    expect(getMergeStates().get('/work/main')).toBeUndefined();

    // …and the failure must not wedge the row: the next pass retries, once the
    // in-flight marker for the failed request has cleared.
    fetch.mockResolvedValue(state({ kind: 'merged' }));
    await vi.waitFor(() => {
      ensureMergeStates([{ cwd: '/work/main', fetch }]);
      expect(getMergeStates().get('/work/main')).toMatchObject({
        kind: 'merged',
      });
    });
  });

  it('replaces the snapshot so subscribers see a new map identity', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMergeStates(listener);
    const before = getMergeStates();

    ensureMergeStates([
      {
        cwd: '/work/main',
        fetch: vi.fn().mockResolvedValue(state({ kind: 'merged' })),
      },
    ]);
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());

    expect(getMergeStates()).not.toBe(before);
    unsubscribe();
  });

  it('does nothing for an empty probe list', () => {
    const fetch = vi.fn();
    ensureMergeStates([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
