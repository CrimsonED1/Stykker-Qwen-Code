/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('@microsoft/mxc-sdk/v1', () => ({ spawn: mocks.spawn }));

import { executeMxc, quoteWindowsArg, toMxcRequest } from './mxc-execution.js';
import type { ExecutionSandboxPolicy } from './sandbox-execution.js';
import type { ShellOutputEvent } from '../services/shellExecutionService.js';

const base = {
  workspace: 'C:\\work\\project',
  installation: 'C:\\qwen\\dist',
  state: 'C:\\state',
  filesystem: 'workspace-write' as const,
  network: 'closed' as const,
};
const payload = {
  executable: 'C:\\Program Files\\nodejs\\node.exe',
  args: ['-e', 'console.log(1)'],
  cwd: 'C:\\work\\project',
  env: { PATH: 'C:\\Windows\\System32' },
};

describe('toMxcRequest', () => {
  it.each([
    [
      'workspace-write',
      'closed',
      {
        readwritePaths: ['C:\\work\\project'],
        readonlyPaths: ['C:\\qwen\\dist'],
      },
      'deny',
    ],
    [
      'workspace-write',
      'open',
      {
        readwritePaths: ['C:\\work\\project'],
        readonlyPaths: ['C:\\qwen\\dist'],
      },
      'allow',
    ],
    [
      'read-only',
      'closed',
      { readonlyPaths: ['C:\\work\\project', 'C:\\qwen\\dist'] },
      'deny',
    ],
    [
      'read-only',
      'open',
      { readonlyPaths: ['C:\\work\\project', 'C:\\qwen\\dist'] },
      'allow',
    ],
  ] as const)(
    'maps %s filesystem with %s network',
    (filesystem, network, expectedFs, egress) => {
      const { request, warnings } = toMxcRequest(
        { ...base, filesystem, network },
        payload,
      );
      expect(request.filesystem).toEqual(expectedFs);
      expect(request.network).toEqual({ egress: { default: egress } });
      expect(request.containment).toEqual({ type: 'processcontainer' });
      expect(request.ui).toEqual({
        disable: false,
        clipboard: 'none',
        allowInputInjection: false,
      });
      expect(request.inheritDefaultEnvironment).toBe(false);
      expect(request.workingDirectory).toBe('C:\\work\\project');
      expect(request.environment).toEqual(payload.env);
      expect(warnings).toEqual([]);
    },
  );

  it('never lists state or the global config directory in path lists', () => {
    const { request } = toMxcRequest(
      { ...base, filesystem: 'workspace-write' },
      payload,
    );
    const listed = [
      ...(request.filesystem?.readwritePaths ?? []),
      ...(request.filesystem?.readonlyPaths ?? []),
    ];
    expect(listed).not.toContain('C:\\state');
    expect(listed.some((value) => value.includes('.qwen'))).toBe(false);
  });

  it('grants read access to the Node binary folder when it launches the file worker', () => {
    const { request } = toMxcRequest(
      { ...base, filesystem: 'workspace-write' },
      {
        executable: process.execPath,
        args: ['worker.js'],
        cwd: 'C:\\work\\project',
        env: {},
      },
    );
    expect(request.filesystem?.readonlyPaths).toContain(
      path.dirname(process.execPath),
    );
    expect(request.filesystem?.readwritePaths).toEqual(['C:\\work\\project']);
  });

  it('warns when masked paths are configured, since Windows cannot enforce them', () => {
    const { warnings } = toMxcRequest(
      { ...base, maskedPaths: ['C:\\work\\project\\secret'] },
      payload,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('masked paths');
  });

  it('quotes the executable and arguments into one Windows command line', () => {
    const { request } = toMxcRequest(base, payload);
    expect(request.command).toBe(
      '"C:\\Program Files\\nodejs\\node.exe" -e console.log(1)',
    );
  });

  it('appends the last argument verbatim when cmd.exe needs it unescaped', () => {
    const { request } = toMxcRequest(base, {
      executable: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'echo "hi there"'],
      cwd: 'C:\\work\\project',
      env: {},
      windowsVerbatimArguments: true,
    });
    expect(request.command).toBe(
      'C:\\Windows\\System32\\cmd.exe /d /s /c echo "hi there"',
    );
  });
});

describe('quoteWindowsArg', () => {
  it.each([
    ['plain', 'plain'],
    ['has space', '"has space"'],
    ['say "hi"', '"say \\"hi\\""'],
    ['C:\\dir with space\\', '"C:\\dir with space\\\\"'],
    ['', '""'],
    ['back\\slash', 'back\\slash'],
  ])('quotes %j as %s', (input, expected) => {
    expect(quoteWindowsArg(input)).toBe(expected);
  });
});

function fakeProcess(exitCode = 0) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });
  const endSpy = vi.spyOn(stdin, 'end');
  const proc = {
    id: 4242,
    standardOutput: stdout,
    standardError: stderr,
    standardInput: stdin,
    warnings: [],
    kill: vi.fn(),
    dispose: vi.fn(),
    wait: vi.fn(async () => {
      await new Promise((resolve) => setImmediate(resolve));
      stdout.end();
      stderr.end();
      return { exitCode, timedOut: false };
    }),
  };
  return { proc, stdout, stderr, endSpy };
}

describe('executeMxc', () => {
  let workspace: string;
  let policy: ExecutionSandboxPolicy;

  beforeEach(() => {
    mocks.spawn.mockReset();
    workspace = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'mxc-test-')));
    policy = {
      ...base,
      workspace,
      installation: workspace,
      state: workspace,
      effectiveBackend: 'mxc',
      enforcement: 'full',
    };
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  const launch = (overrides: Record<string, unknown> = {}) => ({
    executable: path.join(workspace, 'node.exe'),
    args: ['-e', 'x'],
    cwd: workspace,
    env: { PATH: 'C:\\Windows', QWEN_SERVER_TOKEN: 'x' },
    ...overrides,
  });

  it('rejects PTY execution before spawning anything', async () => {
    await expect(
      executeMxc(
        policy,
        launch(),
        () => {},
        new AbortController().signal,
        true,
      ),
    ).rejects.toThrow('PTY is not supported by the mxc backend yet');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('streams stdout and stderr, reports the exit code, and feeds stdin', async () => {
    const { proc, stdout, stderr, endSpy } = fakeProcess(7);
    mocks.spawn.mockResolvedValue(proc);
    const events: ShellOutputEvent[] = [];
    const handle = await executeMxc(
      policy,
      launch({ stdin: 'input-data' }),
      (event) => events.push(event),
      new AbortController().signal,
    );
    stdout.write('out-1');
    stderr.write('err-1');
    const result = await handle.result;

    expect(endSpy).toHaveBeenCalledWith('input-data');
    expect(events).toEqual([
      { type: 'data', chunk: 'out-1', stream: 'stdout' },
      { type: 'data', chunk: 'err-1', stream: 'stderr' },
    ]);
    expect(result.output).toBe('out-1err-1');
    expect(result.exitCode).toBe(7);
    expect(result.aborted).toBe(false);
    expect(result.error).toBeNull();
    expect(result.sandboxStatus).toEqual({ state: 'confirmed', exitCode: 7 });
    expect(await handle.settled).toEqual({ state: 'confirmed', exitCode: 7 });
    expect(result.pid).toBe(4242);
    expect(proc.dispose).toHaveBeenCalledOnce();
  });

  it('drops Qwen-internal secret variables before the SDK call', async () => {
    const { proc } = fakeProcess();
    mocks.spawn.mockResolvedValue(proc);
    await executeMxc(policy, launch(), () => {}, new AbortController().signal);
    const request = mocks.spawn.mock.calls[0]?.[0];
    expect(request.environment).toEqual({ PATH: 'C:\\Windows' });
    expect(request.inheritDefaultEnvironment).toBe(false);
  });

  it('emits raw_data events when raw output is requested', async () => {
    const { proc, stdout } = fakeProcess();
    mocks.spawn.mockResolvedValue(proc);
    const events: ShellOutputEvent[] = [];
    const handle = await executeMxc(
      policy,
      launch(),
      (event) => events.push(event),
      new AbortController().signal,
      false,
      {},
      { streamRawOutput: true },
    );
    stdout.write(Buffer.from('raw'));
    await handle.result;
    expect(events).toEqual([
      { type: 'raw_data', chunk: Buffer.from('raw'), stream: 'stdout' },
    ]);
  });

  it('kills the process on abort and reports an interrupted status', async () => {
    const { proc } = fakeProcess(1);
    proc.wait.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { exitCode: 1, timedOut: false };
    });
    mocks.spawn.mockResolvedValue(proc);
    const controller = new AbortController();
    const handle = await executeMxc(
      policy,
      launch(),
      () => {},
      controller.signal,
    );
    controller.abort();
    const result = await handle.result;
    expect(proc.kill).toHaveBeenCalledOnce();
    expect(result.aborted).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.sandboxStatus).toEqual({ state: 'interrupted' });
    expect(result.error?.message).toContain('interrupted');
  });

  it('rejects payload paths that are not absolute or leave the workspace', async () => {
    const signal = new AbortController().signal;
    await expect(
      executeMxc(policy, launch({ cwd: 'relative' }), () => {}, signal),
    ).rejects.toThrow('Payload paths must be absolute.');
    await expect(
      executeMxc(policy, launch({ cwd: os.tmpdir() }), () => {}, signal),
    ).rejects.toThrow('Payload cwd must be inside the workspace.');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('does not spawn when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const handle = await executeMxc(
      policy,
      launch(),
      () => {},
      controller.signal,
    );
    const result = await handle.result;
    expect(result.aborted).toBe(true);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
