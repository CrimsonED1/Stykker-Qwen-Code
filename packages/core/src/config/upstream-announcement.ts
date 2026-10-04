/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { NO_EXEC_CONFIG, findGitRoot } from '../utils/gitUtils.js';
import { getSeenCommitsPath } from './seen-commits-store.js';

export interface UpstreamCommit {
  sha: string;
  subject: string;
}

export interface UpstreamAnnouncement {
  /** Ref the commits are counted against, e.g. `upstream/main`. */
  ref: string;
  /** Newest commit on that ref. */
  headSha: string;
  /** Commits above the acknowledged marker, newest first. */
  commits: UpstreamCommit[];
  /** The marker the comparison used, if one was recorded. */
  acknowledgedSha?: string;
  /** Why there is nothing to announce. */
  reason: 'up-to-date' | 'first-run' | 'no-remote' | 'not-a-repo' | 'shallow';
  /**
   * True when the fetch could not run or the ref is missing. The caller must
   * not present this as "up to date" — it is an unchecked state.
   */
  unverified?: boolean;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', [...NO_EXEC_CONFIG, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function gitOrNull(cwd: string, args: string[]): string | null {
  try {
    const out = git(cwd, args);
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Like {@link gitOrNull}, but keeps an empty result as `''`.
 *
 * `git log A..B` exits 0 with no output when the range is empty, and that
 * empty string is the answer "nothing new" — not a failure. Collapsing it to
 * null would report an unverifiable history where there is simply nothing.
 */
function gitOutputOrFail(cwd: string, args: string[]): string | null {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
}

/** Reads the acknowledged marker for one ref; undefined when unset. */
function readAck(ref: string): string | undefined {
  try {
    const raw = fs.readFileSync(getSeenCommitsPath(), 'utf8');
    const parsed = JSON.parse(raw) as {
      acknowledged?: Record<string, string>;
    };
    const sha = parsed.acknowledged?.[ref];
    return typeof sha === 'string' && /^[0-9a-f]{7,40}$/i.test(sha)
      ? sha
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Commits on `ref` that arrive after the acknowledged marker.
 *
 * The marker is the comparison point, not the branch tip: everything above it
 * is announced, and confirming a commit moves the marker forward so the same
 * commit is never announced twice. With no marker yet, nothing is announced
 * either — on a first run an existing checkout would otherwise produce a wall
 * of hundreds of commits that have nothing to do with "what's new".
 */
export function findUpstreamCommits(
  repoRoot: string,
  ref: string,
): UpstreamAnnouncement {
  const headSha = gitOrNull(repoRoot, ['rev-parse', ref]);
  if (!headSha) {
    return {
      ref,
      headSha: '',
      commits: [],
      reason: 'no-remote',
      unverified: true,
    };
  }

  const acknowledgedSha = readAck(ref);
  if (!acknowledgedSha) {
    return { ref, headSha, commits: [], reason: 'first-run' };
  }

  // A shallow clone cannot answer "what is between these two commits"; it
  // reports the boundary instead. Announcing that gap as new work would be
  // worse than admitting the check did not complete.
  if (
    gitOrNull(repoRoot, ['rev-parse', '--is-shallow-repository']) === 'true'
  ) {
    const reachable = gitOrNull(repoRoot, [
      'merge-base',
      '--is-ancestor',
      acknowledgedSha,
      ref,
    ]);
    if (
      reachable === null &&
      gitOrNull(repoRoot, ['cat-file', '-e', acknowledgedSha]) === null
    ) {
      return {
        ref,
        headSha,
        commits: [],
        acknowledgedSha,
        reason: 'shallow',
        unverified: true,
      };
    }
  }

  const log = gitOutputOrFail(repoRoot, [
    'log',
    '--format=%H%x1f%s',
    `${acknowledgedSha}..${ref}`,
  ]);
  if (log === null) {
    // The recorded commit is gone — history rewritten, or the record names a
    // commit from another repository.
    return {
      ref,
      headSha,
      commits: [],
      acknowledgedSha,
      reason: 'shallow',
      unverified: true,
    };
  }

  const commits = log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha = '', ...rest] = line.split('\x1f');
      return { sha, subject: rest.join('\x1f') };
    });

  return {
    ref,
    headSha,
    commits,
    ...(acknowledgedSha ? { acknowledgedSha } : {}),
    reason: commits.length === 0 ? 'up-to-date' : 'first-run',
  };
}

/**
 * Finds the update state for the repository containing `cwd`: a remote branch
 * the user tracks, resolved from the record file's own refs.
 *
 * Returns null when the directory is not a repository. Never fetches — the
 * caller owns when network access happens, so a render path can read this
 * without touching the network.
 */
export function getUpstreamAnnouncement(
  cwd: string,
  ref: string,
): UpstreamAnnouncement | null {
  const gitRoot = findGitRoot(cwd);
  if (!gitRoot) return null;
  return findUpstreamCommits(gitRoot, ref);
}
