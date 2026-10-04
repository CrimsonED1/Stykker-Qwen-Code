/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const { atomicWriteJSONMock, getGlobalQwenDirMock } = vi.hoisted(() => ({
  atomicWriteJSONMock: vi.fn(),
  getGlobalQwenDirMock: vi.fn(() => '/home/u/.qwen'),
}));

vi.mock('node:fs/promises', () => ({
  default: { readFile: vi.fn(), rm: vi.fn() },
  readFile: vi.fn(),
  rm: vi.fn(),
}));
vi.mock('./storage.js', () => ({
  Storage: { getGlobalQwenDir: getGlobalQwenDirMock },
}));
vi.mock('../utils/atomicFileWrite.js', () => ({
  atomicWriteJSON: atomicWriteJSONMock,
}));
vi.mock('../utils/debugLogger.js', () => ({
  createDebugLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import {
  acknowledgeCommit,
  getSeenCommitsPath,
  readSeenCommits,
  resetSeenCommits,
} from './seen-commits-store.js';

const readFile = vi.mocked(fs.readFile);

describe('getSeenCommitsPath', () => {
  it('lives in the Qwen config directory', () => {
    expect(getSeenCommitsPath()).toBe(
      path.join('/home/u/.qwen', 'stykker-seen-commits.json'),
    );
  });
});

describe('readSeenCommits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getGlobalQwenDirMock.mockReturnValue('/home/u/.qwen');
    atomicWriteJSONMock.mockResolvedValue(undefined);
  });

  it('returns an empty record when the file is missing', async () => {
    readFile.mockRejectedValue(new Error('ENOENT'));
    expect(await readSeenCommits()).toEqual({ acknowledged: {} });
  });

  it('reads the acknowledged markers', async () => {
    readFile.mockResolvedValue(
      JSON.stringify({ acknowledged: { 'upstream/main': 'abc1234' } }),
    );
    expect((await readSeenCommits()).acknowledged).toEqual({
      'upstream/main': 'abc1234',
    });
  });

  it('survives invalid JSON instead of throwing on the startup path', async () => {
    readFile.mockResolvedValue('{ not json');
    expect(await readSeenCommits()).toEqual({ acknowledged: {} });
  });

  it('drops markers that are not commit SHAs', async () => {
    readFile.mockResolvedValue(
      JSON.stringify({
        acknowledged: {
          'upstream/main': 'abc1234',
          'upstream/release': 'nope',
          'origin/main': 42,
        },
      }),
    );
    expect((await readSeenCommits()).acknowledged).toEqual({
      'upstream/main': 'abc1234',
    });
  });

  it('tolerates a record with no acknowledged map', async () => {
    readFile.mockResolvedValue(JSON.stringify({ updatedAt: 'x' }));
    expect(await readSeenCommits()).toEqual({ acknowledged: {} });
  });
});

describe('acknowledgeCommit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getGlobalQwenDirMock.mockReturnValue('/home/u/.qwen');
    atomicWriteJSONMock.mockResolvedValue(undefined);
    readFile.mockResolvedValue(JSON.stringify({ acknowledged: {} }));
  });

  it('writes the marker for one ref', async () => {
    const record = await acknowledgeCommit('upstream/main', 'abc1234');
    expect(record.acknowledged).toEqual({ 'upstream/main': 'abc1234' });
    expect(atomicWriteJSONMock).toHaveBeenCalledWith(
      path.join('/home/u/.qwen', 'stykker-seen-commits.json'),
      expect.objectContaining({
        acknowledged: { 'upstream/main': 'abc1234' },
      }),
      expect.objectContaining({ mode: 0o600 }),
    );
  });

  it('preserves the markers of other refs', async () => {
    readFile.mockResolvedValue(
      JSON.stringify({ acknowledged: { 'upstream/release': 'def5678' } }),
    );
    const record = await acknowledgeCommit('upstream/main', 'abc1234');
    // Confirming main must not make the release branch announce itself again.
    expect(record.acknowledged).toEqual({
      'upstream/release': 'def5678',
      'upstream/main': 'abc1234',
    });
  });

  it('stamps a confirmation time', async () => {
    const record = await acknowledgeCommit('upstream/main', 'abc1234');
    expect(record.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('resetSeenCommits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getGlobalQwenDirMock.mockReturnValue('/home/u/.qwen');
    atomicWriteJSONMock.mockResolvedValue(undefined);
  });

  it('removes the file when no ref is given', async () => {
    await resetSeenCommits();
    expect(vi.mocked(fs.rm)).toHaveBeenCalledWith(
      path.join('/home/u/.qwen', 'stykker-seen-commits.json'),
      { force: true },
    );
  });

  it('removes one ref and keeps the others', async () => {
    readFile.mockResolvedValue(
      JSON.stringify({
        acknowledged: { 'upstream/main': 'abc1234', 'upstream/x': 'def5678' },
      }),
    );
    await resetSeenCommits('upstream/main');
    const written = atomicWriteJSONMock.mock.calls[0][1] as {
      acknowledged: Record<string, string>;
    };
    expect(written.acknowledged).toEqual({ 'upstream/x': 'def5678' });
  });

  it('does not write when the ref was never recorded', async () => {
    readFile.mockResolvedValue(JSON.stringify({ acknowledged: {} }));
    await resetSeenCommits('upstream/main');
    expect(atomicWriteJSONMock).not.toHaveBeenCalled();
  });
});
