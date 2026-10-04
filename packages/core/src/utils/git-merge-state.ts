/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import { NO_EXEC_CONFIG, findGitRoot } from './gitUtils.js';
import { createDebugLogger } from './debugLogger.js';

const debugLogger = createDebugLogger('GIT_MERGE_STATE');

/**
 * How a session's branch stands relative to its remote base branch.
 *
 * - `not-a-repo`: the session's directory is not inside a git repository.
 *   Nothing to compare — the UI shows no glyph at all.
 * - `no-remote`: a repository, but no remote with a resolvable base branch.
 *   Local-only clones land here; reporting "merged" would be a claim we cannot
 *   back up.
 * - `on-main`: the session sits on the base branch itself, so there is nothing
 *   to merge in either direction.
 * - `unmerged`: the session's HEAD carries commits the base branch lacks.
 * - `merged`: the base branch already contains the session's HEAD.
 * - `unknown`: a git invocation failed, most often a base ref that was never
 *   fetched. Rendered as stale — never as a green "merged".
 */
export type MergeStateKind =
  | 'not-a-repo'
  | 'no-remote'
  | 'on-main'
  | 'merged'
  | 'unmerged'
  | 'unknown';

export interface MergeState {
  kind: MergeStateKind;
  /**
   * Commits reachable from HEAD but not from the base ref. Only meaningful for
   * `merged` and `unmerged`; 0 elsewhere.
   */
  ahead: number;
  /** The comparison target, e.g. `origin/main`. Absent when unresolvable. */
  baseRef?: string;
  /** The branch component of {@link baseRef}, e.g. `main`. */
  baseBranch?: string;
  /** SHA of the base ref when the state was computed. */
  baseSha?: string;
  /** SHA of the session branch when the state was computed. */
  headSha?: string;
  /** Epoch milliseconds when the state was computed. */
  checkedAt: number;
}

/** Branch names to try when `<remote>/HEAD` is not set. */
const FALLBACK_BASES = ['main', 'master', 'trunk'] as const;

function gitOrNull(cwd: string, args: string[]): string | null {
  try {
    const out = execFileSync('git', [...NO_EXEC_CONFIG, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Resolves the base branch to compare against, e.g. `origin/main`.
 *
 * `<remote>/HEAD` wins when set. Repositories without it fall back to the
 * conventional branch names. The remote is not assumed to be `origin`: a clone
 * may name it anything (the LLM monitor names it `dev`), so `origin` is only
 * preferred, never required.
 */
export function resolveBaseRef(gitRoot: string): {
  baseRef: string;
  baseBranch: string;
} | null {
  const remotes = (gitOrNull(gitRoot, ['remote']) ?? '')
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean);
  if (remotes.length === 0) return null;

  const ordered = [
    ...remotes.filter((r) => r === 'origin'),
    ...remotes.filter((r) => r !== 'origin'),
  ];

  for (const remote of ordered) {
    const prefix = `refs/remotes/${remote}/`;
    const symbolic = gitOrNull(gitRoot, [
      'symbolic-ref',
      '--quiet',
      `${prefix}HEAD`,
    ]);
    if (symbolic?.startsWith(prefix)) {
      const branch = symbolic.slice(prefix.length);
      const ref = `${remote}/${branch}`;
      if (gitOrNull(gitRoot, ['rev-parse', '--verify', '--quiet', ref])) {
        return { baseRef: ref, baseBranch: branch };
      }
    }
    for (const branch of FALLBACK_BASES) {
      const ref = `${remote}/${branch}`;
      if (gitOrNull(gitRoot, ['rev-parse', '--verify', '--quiet', ref])) {
        return { baseRef: ref, baseBranch: branch };
      }
    }
  }
  return null;
}

/**
 * Both SHAs in one invocation. This is the only call a cache hit pays for, so
 * it stays a single subprocess however many sessions share the repository.
 */
function probeShas(
  gitRoot: string,
  baseRef: string,
): { headSha: string; baseSha: string } | null {
  const out = gitOrNull(gitRoot, ['rev-parse', 'HEAD', baseRef]);
  if (!out) return null;
  const [headSha, baseSha] = out.split(/\s+/);
  if (!headSha || !baseSha) return null;
  return { headSha, baseSha };
}

interface CacheEntry {
  state: MergeState;
  headSha: string | undefined;
  baseSha: string | undefined;
}

/**
 * One entry per git root, not per session: clones of one repository share a
 * remote, so a second identical warning is noise rather than information.
 */
const cache = new Map<string, CacheEntry>();

function compute(gitRoot: string): MergeState {
  const checkedAt = Date.now();
  const base = resolveBaseRef(gitRoot);
  if (!base) {
    debugLogger.debug(`no base ref resolvable for ${gitRoot}`);
    return { kind: 'no-remote', ahead: 0, checkedAt };
  }

  const shas = probeShas(gitRoot, base.baseRef);
  if (!shas) {
    debugLogger.debug(`${base.baseRef} not present locally in ${gitRoot}`);
    return {
      kind: 'unknown',
      ahead: 0,
      baseRef: base.baseRef,
      baseBranch: base.baseBranch,
      checkedAt,
    };
  }
  const { headSha, baseSha } = shas;

  const currentBranch = gitOrNull(gitRoot, [
    'rev-parse',
    '--abbrev-ref',
    'HEAD',
  ]);
  if (currentBranch === base.baseBranch) {
    return {
      kind: 'on-main',
      ahead: 0,
      baseRef: base.baseRef,
      baseBranch: base.baseBranch,
      baseSha,
      headSha,
      checkedAt,
    };
  }

  // Only this session's own branch is counted. Enumerating every remote branch
  // (`git branch -r --no-merged`) is unusable in a fork: qwen-code-fork alone
  // answers with 4452 upstream/* topic branches, none of which are this
  // session's business.
  const aheadRaw = gitOrNull(gitRoot, [
    'rev-list',
    '--count',
    `${base.baseRef}..HEAD`,
  ]);
  if (!aheadRaw || !/^\d+$/.test(aheadRaw)) {
    return {
      kind: 'unknown',
      ahead: 0,
      baseRef: base.baseRef,
      baseBranch: base.baseBranch,
      baseSha,
      headSha,
      checkedAt,
    };
  }

  const ahead = Number(aheadRaw);
  return {
    kind: ahead > 0 ? 'unmerged' : 'merged',
    ahead,
    baseRef: base.baseRef,
    baseBranch: base.baseBranch,
    baseSha,
    headSha,
    checkedAt,
  };
}

/**
 * Merge state of the repository containing `cwd`, relative to its remote base
 * branch.
 *
 * Cached per git root and revalidated against both SHAs, so a moved HEAD or a
 * re-fetched base invalidates the entry on its own. `maxAgeMs` additionally
 * expires it by wall clock: a cached "merged" from an hour ago is a claim about
 * the past, and the caller has to be able to say so.
 *
 * Never turns a failed comparison into `merged`.
 */
export function getMergeState(
  cwd: string,
  options: { maxAgeMs?: number; now?: number } = {},
): MergeState {
  const now = options.now ?? Date.now();
  const gitRoot = findGitRoot(cwd);
  if (!gitRoot) {
    return { kind: 'not-a-repo', ahead: 0, checkedAt: now };
  }

  const cached = cache.get(gitRoot);
  if (cached?.state.baseRef) {
    const freshByClock =
      options.maxAgeMs === undefined ||
      now - cached.state.checkedAt < options.maxAgeMs;
    const shas = probeShas(gitRoot, cached.state.baseRef);
    if (
      freshByClock &&
      shas &&
      shas.headSha === cached.headSha &&
      shas.baseSha === cached.baseSha
    ) {
      return cached.state;
    }
  }

  const state = compute(gitRoot);
  cache.set(gitRoot, {
    state,
    headSha: state.headSha,
    baseSha: state.baseSha,
  });
  return state;
}

/**
 * True when the state is too old to present as current. Callers use this to
 * pick the stale glyph instead of the state's own.
 */
export function isMergeStateStale(
  state: MergeState,
  maxAgeMs: number,
  now: number = Date.now(),
): boolean {
  if (state.kind === 'not-a-repo') return false;
  return now - state.checkedAt >= maxAgeMs;
}

/** Test seam: drops every cached entry. */
export function clearMergeStateCache(): void {
  cache.clear();
}
