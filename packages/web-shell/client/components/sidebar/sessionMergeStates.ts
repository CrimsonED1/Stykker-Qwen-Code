/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { useSyncExternalStore } from 'react';
import type {
  DaemonSessionSummary,
  DaemonWorkspaceMergeState,
} from '@qwen-code/sdk/daemon';

/**
 * How long a fetched state is trusted without a re-probe.
 *
 * The daemon already revalidates its cache against both SHAs, so this only
 * bounds how often the sidebar hits the route at all. Short enough that a
 * `git push`/merge the user just did shows up while they are still looking at
 * the list, long enough that a render never triggers a request.
 */
const CLIENT_MAX_AGE_MS = 30_000;

/**
 * Merge states shared by every sidebar row, keyed by the directory that was
 * probed — a worktree path for a worktree session, the workspace cwd
 * otherwise. Several sessions of one workspace therefore share one entry, and
 * several rows of one worktree share another: the row glyph is a lookup, not a
 * request.
 *
 * Module-level because the rows are rendered from many places (the flat list,
 * every group section, the archived list) that have no single owner to hang a
 * fetch on. A store keeps the fetch count proportional to the number of
 * distinct repositories on screen instead of the number of rows.
 */
let states: ReadonlyMap<string, DaemonWorkspaceMergeState> = new Map();
const listeners = new Set<() => void>();
const inFlight = new Set<string>();

function publish(next: Map<string, DaemonWorkspaceMergeState>): void {
  states = next;
  for (const listener of listeners) listener();
}

export function subscribeMergeStates(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getMergeStates(): ReadonlyMap<
  string,
  DaemonWorkspaceMergeState
> {
  return states;
}

/** Test seam: drops the cache so a case starts from "nothing fetched". */
export function resetMergeStates(): void {
  states = new Map();
  inFlight.clear();
  listeners.clear();
}

/**
 * The directory whose HEAD decides a row's merge state.
 *
 * A worktree session carries its own checkout, so probing the workspace cwd
 * would report the workspace's branch for every row in the list. Returns
 * undefined when the session cannot produce a glyph at all.
 */
export function mergeProbeCwd(
  session: DaemonSessionSummary,
  fallbackWorkspaceCwd: string | undefined,
): string | undefined {
  const worktreePath = session.worktree?.path;
  if (worktreePath) return worktreePath;
  if (!session.worktree && !session.branch) return undefined;
  const cwd = session.workspaceCwd || fallbackWorkspaceCwd;
  return cwd || undefined;
}

interface MergeProbe {
  cwd: string;
  fetch: () => Promise<DaemonWorkspaceMergeState>;
}

/**
 * Fetch whatever is missing or too old. In-flight requests are shared, so a
 * burst of renders costs one request per distinct directory.
 *
 * A failed probe stores nothing: the row shows no glyph, which is the honest
 * answer, instead of a state that claims a branch is merged.
 */
export function ensureMergeStates(probes: readonly MergeProbe[]): void {
  if (probes.length === 0) return;
  const now = Date.now();
  const pending: MergeProbe[] = [];
  const seen = new Set<string>();
  for (const probe of probes) {
    if (seen.has(probe.cwd)) continue;
    seen.add(probe.cwd);
    if (inFlight.has(probe.cwd)) continue;
    const cached = states.get(probe.cwd);
    if (cached && now - cached.checkedAt < CLIENT_MAX_AGE_MS) continue;
    pending.push(probe);
  }
  if (pending.length === 0) return;

  for (const probe of pending) {
    inFlight.add(probe.cwd);
    void probe
      .fetch()
      .then((merge) => {
        const next = new Map(states);
        next.set(probe.cwd, merge);
        publish(next);
      })
      .catch(() => {})
      .finally(() => {
        inFlight.delete(probe.cwd);
      });
  }
}

/** The merge state for a row, or undefined while it is still unknown. */
export function useMergeStates(): ReadonlyMap<
  string,
  DaemonWorkspaceMergeState
> {
  return useSyncExternalStore(
    subscribeMergeStates,
    getMergeStates,
    getMergeStates,
  );
}
