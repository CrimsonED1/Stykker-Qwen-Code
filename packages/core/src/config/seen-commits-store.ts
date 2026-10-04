/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { Storage } from './storage.js';
import { atomicWriteJSON } from '../utils/atomicFileWrite.js';
import { createDebugLogger } from '../utils/debugLogger.js';

const debugLogger = createDebugLogger('UPDATE_SEEN_COMMITS');

/**
 * Per-repository record of which commits the user has already acknowledged.
 *
 * `seenCommits` holds a commit per remote branch: a repository with both
 * `main` and a long-lived release branch advances independently, and collapsing
 * them into one marker would either hide `main`'s new commits or re-announce
 * the release branch's forever.
 *
 * `acknowledged` distinguishes "the user has seen this" from "this is the
 * newest commit": the announcement lists everything above `acknowledged`, so a
 * commit the user confirmed stays acknowledged even as later commits arrive.
 */
export interface SeenCommitsRecord {
  /** SHA the user last confirmed, per `<remote>/<branch>`. */
  acknowledged: Record<string, string>;
  /** ISO timestamp of the confirmation. */
  updatedAt?: string;
}

const FILENAME = 'stykker-seen-commits.json';

export function getSeenCommitsPath(): string {
  return path.join(Storage.getGlobalQwenDir(), FILENAME);
}

function isSha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{7,40}$/i.test(value);
}

/**
 * Reads the record, treating any malformed content as empty.
 *
 * A hand-edited or truncated file must not throw: the failure mode is "the
 * user sees announcements again", which is recoverable, whereas a thrown error
 * on the startup path would take the whole session down. Entries that are not
 * commit SHAs are dropped rather than trusted.
 */
export async function readSeenCommits(): Promise<SeenCommitsRecord> {
  let raw: string;
  try {
    raw = await fs.readFile(getSeenCommitsPath(), 'utf8');
  } catch {
    return { acknowledged: {} };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return { acknowledged: {} };
    }
    const acknowledged = (parsed as SeenCommitsRecord).acknowledged;
    if (typeof acknowledged !== 'object' || acknowledged === null) {
      return { acknowledged: {} };
    }
    const clean: Record<string, string> = {};
    for (const [ref, sha] of Object.entries(acknowledged)) {
      if (isSha(sha)) clean[ref] = sha;
    }
    return { acknowledged: clean };
  } catch {
    debugLogger.debug('seen-commits file is not valid JSON, treating as empty');
    return { acknowledged: {} };
  }
}

/**
 * Records the commit the user confirmed for one ref, and returns the written
 * record. Other refs are preserved — confirming `main` must not reset the
 * marker of a release branch.
 */
export async function acknowledgeCommit(
  ref: string,
  sha: string,
): Promise<SeenCommitsRecord> {
  const current = await readSeenCommits();
  const next: SeenCommitsRecord = {
    acknowledged: { ...current.acknowledged, [ref]: sha },
    updatedAt: new Date().toISOString(),
  };
  await atomicWriteJSON(getSeenCommitsPath(), next, { mode: 0o600 });
  debugLogger.debug(`acknowledged ${ref} at ${sha}`);
  return next;
}

/**
 * Drops the recorded marker for a ref, so its commits are announced again.
 * Missing markers are not an error.
 */
export async function resetSeenCommits(ref?: string): Promise<void> {
  if (!ref) {
    await fs.rm(getSeenCommitsPath(), { force: true });
    return;
  }
  const current = await readSeenCommits();
  if (!(ref in current.acknowledged)) return;
  const { [ref]: _removed, ...rest } = current.acknowledged;
  await atomicWriteJSON(
    getSeenCommitsPath(),
    { acknowledged: rest, updatedAt: new Date().toISOString() },
    { mode: 0o600 },
  );
}
