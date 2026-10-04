/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';

vi.mock('node:child_process');
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, default: actual };
});
vi.mock('./debugLogger.js', () => ({
  createDebugLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));
vi.mock('./seen-commits-store.js', () => ({
  getSeenCommitsPath: () => '/home/u/.qwen/stykker-seen-commits.json',
}));
vi.mock('../utils/gitUtils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/gitUtils.js')>();
  return { ...actual, findGitRoot: vi.fn(() => '/repo') };
});

import { findGitRoot } from '../utils/gitUtils.js';
import {
  findUpstreamCommits,
  getUpstreamAnnouncement,
} from './upstream-announcement.js';

const execFileSync = vi.mocked(childProcess.execFileSync);

function gitReplies(replies: Record<string, string | null>) {
  execFileSync.mockImplementation(((_cmd: string, args: string[]) => {
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

/** A repository with commits above the acknowledged marker. */
function withNewCommits(
  log = 'aaa1111\x1ffix(cli): newer\nbbb2222\x1ffix(web-shell): also new',
) {
  gitReplies({
    'rev-parse upstream/main': 'aaa1111',
    'rev-parse --is-shallow-repository': 'false',
    'log --format=%H%x1f%s aaa1000..upstream/main': log,
  });
}

function ackFile(content: string | null) {
  vi.spyOn(fs, 'readFileSync').mockImplementation((p: unknown) => {
    if (String(p).includes('stykker-seen-commits.json')) {
      if (content === null) throw new Error('ENOENT');
      return content;
    }
    return '' as never;
  });
}

describe('findUpstreamCommits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findGitRoot).mockReturnValue('/repo');
    ackFile('{"acknowledged":{"upstream/main":"aaa1000"}}');
  });

  it('lists the commits above the acknowledged marker', () => {
    withNewCommits();
    const a = findUpstreamCommits('/repo', 'upstream/main');
    expect(a.commits).toEqual([
      { sha: 'aaa1111', subject: 'fix(cli): newer' },
      { sha: 'bbb2222', subject: 'fix(web-shell): also new' },
    ]);
    expect(a.acknowledgedSha).toBe('aaa1000');
    expect(a.headSha).toBe('aaa1111');
  });

  it('announces nothing when the marker is at the tip', () => {
    gitReplies({
      'rev-parse upstream/main': 'aaa1000',
      'rev-parse --is-shallow-repository': 'false',
      'log --format=%H%x1f%s aaa1000..upstream/main': '',
    });
    const a = findUpstreamCommits('/repo', 'upstream/main');
    expect(a.commits).toEqual([]);
    expect(a.reason).toBe('up-to-date');
    expect(a.unverified).toBeUndefined();
  });

  it('announces nothing on a first run, even with a long history', () => {
    ackFile(null);
    gitReplies({ 'rev-parse upstream/main': 'aaa1111' });
    const a = findUpstreamCommits('/repo', 'upstream/main');
    // Otherwise every existing checkout would open with hundreds of commits
    // that are not "what is new".
    expect(a.commits).toEqual([]);
    expect(a.reason).toBe('first-run');
  });

  it('reports an unverified state, not up-to-date, when the ref is missing', () => {
    gitReplies({ 'rev-parse upstream/main': null });
    const a = findUpstreamCommits('/repo', 'upstream/main');
    expect(a.reason).toBe('no-remote');
    expect(a.unverified).toBe(true);
  });

  it('refuses to announce across a rewritten history', () => {
    gitReplies({
      'rev-parse upstream/main': 'aaa1111',
      'rev-parse --is-shallow-repository': 'false',
      'log --format=%H%x1f%s aaa1000..upstream/main': null,
    });
    const a = findUpstreamCommits('/repo', 'upstream/main');
    expect(a.commits).toEqual([]);
    expect(a.unverified).toBe(true);
  });

  it('keeps a subject containing the record separator intact', () => {
    withNewCommits('aaa1111\x1ffix: subject with \x1f separator');
    const a = findUpstreamCommits('/repo', 'upstream/main');
    expect(a.commits[0].subject).toBe('fix: subject with \x1f separator');
  });

  it('ignores a marker that is not a commit sha', () => {
    ackFile('{"acknowledged":{"upstream/main":"not-a-sha"}}');
    gitReplies({ 'rev-parse upstream/main': 'aaa1111' });
    expect(findUpstreamCommits('/repo', 'upstream/main').reason).toBe(
      'first-run',
    );
  });
});

describe('getUpstreamAnnouncement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findGitRoot).mockReturnValue('/repo');
    ackFile('{"acknowledged":{"upstream/main":"aaa1000"}}');
  });

  it('returns null outside a repository', () => {
    vi.mocked(findGitRoot).mockReturnValue(null);
    expect(getUpstreamAnnouncement('/tmp/notes', 'upstream/main')).toBeNull();
  });

  it('resolves the repository before comparing', () => {
    withNewCommits();
    expect(
      getUpstreamAnnouncement('/repo/sub', 'upstream/main')?.commits,
    ).toHaveLength(2);
  });
});
