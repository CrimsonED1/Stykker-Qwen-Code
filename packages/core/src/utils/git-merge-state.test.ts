/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as childProcess from 'node:child_process';

vi.mock('node:child_process');
vi.mock('./debugLogger.js', () => ({
  createDebugLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));
vi.mock('./gitUtils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./gitUtils.js')>();
  return { ...actual, findGitRoot: vi.fn(() => '/repo') };
});

import { findGitRoot } from './gitUtils.js';
import {
  clearMergeStateCache,
  getMergeState,
  isMergeStateStale,
  resolveBaseRef,
} from './git-merge-state.js';

const execFileSync = vi.mocked(childProcess.execFileSync);

/**
 * Default: every test sits inside a repository. Individual tests override this
 * for the not-a-repo path; `vi.clearAllMocks()` in beforeEach drops the
 * implementation, so it has to be reinstated each time.
 */
function insideRepo(root = '/repo') {
  vi.mocked(findGitRoot).mockReturnValue(root);
}

/** Reply keyed by the git subcommand that is asked for. */
function gitReplies(replies: Record<string, string | null>) {
  execFileSync.mockImplementation(((_cmd: string, args: string[]) => {
    // NO_EXEC_CONFIG contributes `-c <value>` pairs; drop both halves or the
    // lookup keys would carry the config values.
    const argv: string[] = [];
    for (let i = 0; i < (args ?? []).length; i++) {
      if (args[i] === '-c') {
        i++;
        continue;
      }
      argv.push(args[i]);
    }
    const reply = replies[argv.join(' ')];
    if (reply === null) throw new Error(`git ${argv.join(' ')} failed`);
    return reply;
  }) as unknown as typeof childProcess.execFileSync);
}

/** The calls a full `unmerged` computation makes. Values must be strings —
 *  `gitOrNull` trims the result, and a numeric reply throws into `unknown`. */
function unmergedRepo(ahead: number | string = 3, headSha = 'head-sha') {
  gitReplies({
    remote: 'origin',
    'symbolic-ref --quiet refs/remotes/origin/HEAD': 'refs/remotes/origin/main',
    'rev-parse --verify --quiet origin/main': 'base-sha',
    'rev-parse HEAD origin/main': `${headSha} base-sha`,
    'rev-parse --abbrev-ref HEAD': 'feat/gpu-bench',
    'rev-list --count origin/main..HEAD': String(ahead),
  });
}

/** Strips the `-c <value>` pairs NO_EXEC_CONFIG prepends. */
function gitCalls(): string[] {
  return execFileSync.mock.calls.map((c) => {
    const argv: string[] = [];
    const args = c[1] as string[];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-c') {
        i++;
        continue;
      }
      argv.push(args[i]);
    }
    return argv.join(' ');
  });
}

describe('resolveBaseRef', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMergeStateCache();
  });

  it('prefers <remote>/HEAD over the conventional names', () => {
    gitReplies({
      remote: 'origin\nupstream',
      'symbolic-ref --quiet refs/remotes/origin/HEAD':
        'refs/remotes/origin/main',
      'rev-parse --verify --quiet origin/main': 'sha',
    });
    expect(resolveBaseRef('/repo')).toEqual({
      baseRef: 'origin/main',
      baseBranch: 'main',
    });
  });

  it('falls back to main when <remote>/HEAD is unset', () => {
    gitReplies({
      remote: 'origin',
      'rev-parse --verify --quiet origin/main': 'sha',
    });
    expect(resolveBaseRef('/repo')?.baseRef).toBe('origin/main');
  });

  it('resolves a clone whose remote is not named origin', () => {
    // stykker-llm-monitor names its only remote `dev`.
    gitReplies({
      remote: 'dev',
      'symbolic-ref --quiet refs/remotes/dev/HEAD': 'refs/remotes/dev/main',
      'rev-parse --verify --quiet dev/main': 'sha',
    });
    expect(resolveBaseRef('/repo')).toEqual({
      baseRef: 'dev/main',
      baseBranch: 'main',
    });
  });

  it('tries master and trunk before giving up', () => {
    gitReplies({
      remote: 'origin',
      'rev-parse --verify --quiet origin/main': null,
      'rev-parse --verify --quiet origin/master': null,
      'rev-parse --verify --quiet origin/trunk': 'sha',
    });
    expect(resolveBaseRef('/repo')?.baseBranch).toBe('trunk');
  });

  it('returns null for a repository without any remote', () => {
    gitReplies({ remote: '' });
    expect(resolveBaseRef('/repo')).toBeNull();
  });
});

describe('getMergeState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMergeStateCache();
    insideRepo();
  });

  it('reports not-a-repo outside a repository', () => {
    vi.mocked(findGitRoot).mockReturnValue(null);
    expect(getMergeState('/tmp/notes')).toEqual({
      kind: 'not-a-repo',
      ahead: 0,
      checkedAt: expect.any(Number),
    });
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('reports no-remote for a local-only clone', () => {
    gitReplies({ remote: '' });
    expect(getMergeState('/repo').kind).toBe('no-remote');
  });

  it('reports on-main when the session sits on the base branch', () => {
    gitReplies({
      remote: 'origin',
      'symbolic-ref --quiet refs/remotes/origin/HEAD':
        'refs/remotes/origin/main',
      'rev-parse --verify --quiet origin/main': 'sha',
      'rev-parse HEAD origin/main': 'sha sha',
      'rev-parse --abbrev-ref HEAD': 'main',
    });
    const state = getMergeState('/repo');
    expect(state.kind).toBe('on-main');
    expect(state.ahead).toBe(0);
  });

  it('counts only this session branch, never every remote branch', () => {
    unmergedRepo(3);
    const state = getMergeState('/repo');
    expect(state.kind).toBe('unmerged');
    expect(state.ahead).toBe(3);
    const calls = gitCalls();
    expect(calls).toContain('rev-list --count origin/main..HEAD');
    // The unusable form: 4452 upstream/* branches in qwen-code-fork.
    expect(calls.some((c) => c.includes('branch -r'))).toBe(false);
  });

  it('reports merged when the base already contains HEAD', () => {
    unmergedRepo('0');
    expect(getMergeState('/repo').kind).toBe('merged');
  });

  it('reports unknown instead of merged when the base was never fetched', () => {
    gitReplies({
      remote: 'origin',
      'symbolic-ref --quiet refs/remotes/origin/HEAD':
        'refs/remotes/origin/main',
      'rev-parse --verify --quiet origin/main': 'sha',
      'rev-parse HEAD origin/main': null,
    });
    // The failure mode that made the local-only check lie on 2026-10-03.
    expect(getMergeState('/repo').kind).toBe('unknown');
  });

  it('serves a second call from cache while both SHAs are unchanged', () => {
    unmergedRepo(3);
    getMergeState('/repo');
    const afterFirst = execFileSync.mock.calls.length;
    getMergeState('/repo');
    // Only the single rev-parse that validates both SHAs.
    expect(execFileSync.mock.calls.length).toBe(afterFirst + 1);
  });

  it('recomputes once HEAD moves', () => {
    unmergedRepo(3, 'head-sha-1');
    expect(getMergeState('/repo').kind).toBe('unmerged');
    // Same remote base, moved HEAD: the cached entry must not survive it.
    unmergedRepo(0, 'head-sha-2');
    expect(getMergeState('/repo').kind).toBe('merged');
  });

  it('shares one computation between two clones of the same remote', () => {
    unmergedRepo(3);
    getMergeState('/repo/one');
    const afterFirst = execFileSync.mock.calls.length;
    getMergeState('/repo/two');
    // findGitRoot is mocked to a single root, so the second path is a hit.
    expect(execFileSync.mock.calls.length).toBe(afterFirst + 1);
  });

  it('expires the entry by wall clock when maxAgeMs is set', () => {
    unmergedRepo(3);
    getMergeState('/repo');
    const afterFirst = execFileSync.mock.calls.length;
    // Same SHAs, so only the age can force the recomputation.
    getMergeState('/repo', { maxAgeMs: 1000, now: Date.now() + 5000 });
    expect(execFileSync.mock.calls.length).toBeGreaterThan(afterFirst + 1);
  });
});

describe('isMergeStateStale', () => {
  it('is never stale outside a repository', () => {
    expect(
      isMergeStateStale(
        { kind: 'not-a-repo', ahead: 0, checkedAt: 0 },
        1,
        10_000,
      ),
    ).toBe(false);
  });

  it('turns stale once maxAgeMs has elapsed', () => {
    expect(
      isMergeStateStale({ kind: 'merged', ahead: 0, checkedAt: 0 }, 1000, 999),
    ).toBe(false);
    expect(
      isMergeStateStale({ kind: 'merged', ahead: 0, checkedAt: 0 }, 1000, 1000),
    ).toBe(true);
  });
});
