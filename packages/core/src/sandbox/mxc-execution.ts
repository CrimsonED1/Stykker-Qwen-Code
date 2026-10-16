/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { ContainerRequest, MxcProcess } from '@microsoft/mxc-sdk/v1';
import type {
  ProcessLaunch,
  ShellExecutionConfig,
  ShellExecuteOptions,
  ShellOutputEvent,
} from '../services/shellExecutionService.js';
import { createDebugLogger } from '../utils/debugLogger.js';
import { isSubpath } from '../utils/paths.js';
import { isInternalSecretEnvVar } from '../utils/sanitize-child-env.js';
import type {
  ExecutionSandboxPolicy,
  SandboxExecutionHandle,
  SandboxExecutionResult,
} from './sandbox-execution.js';
import { sandboxStatusError, type SandboxStatus } from './sandbox-status.js';

const debugLogger = createDebugLogger('SANDBOX_MXC');

const DEFAULT_MAX_BUFFERED_OUTPUT_BYTES = 64 * 1024 * 1024;

export type MxcPolicy = Pick<
  ExecutionSandboxPolicy,
  'workspace' | 'installation' | 'filesystem' | 'network' | 'maskedPaths'
>;

export function windowsCommandProcessor(): string {
  const systemRoot = process.env['SystemRoot'] || 'C:\\Windows';
  return path.join(systemRoot, 'System32', 'cmd.exe');
}

export function windowsSystemEnv(): Record<string, string> {
  const systemRoot = process.env['SystemRoot'] || 'C:\\Windows';
  return {
    SystemRoot: systemRoot,
    PATH: `${path.join(systemRoot, 'System32')};${systemRoot}`,
    // MXC requires this variable to be present when it does not inherit the
    // default environment; the value is a path, not a secret.
    LOCALAPPDATA:
      process.env['LOCALAPPDATA'] ||
      path.join(os.homedir(), 'AppData', 'Local'),
  };
}

export function quoteWindowsArg(arg: string): string {
  if (arg !== '' && !/[\s"]/.test(arg)) return arg;
  let quoted = '"';
  let backslashes = 0;
  for (const char of arg) {
    if (char === '\\') {
      backslashes += 1;
      continue;
    }
    if (char === '"') quoted += '\\'.repeat(backslashes * 2 + 1) + '"';
    else quoted += '\\'.repeat(backslashes) + char;
    backslashes = 0;
  }
  return `${quoted}${'\\'.repeat(backslashes * 2)}"`;
}

export function toMxcRequest(
  policy: MxcPolicy,
  payload: Pick<
    ProcessLaunch,
    'executable' | 'args' | 'cwd' | 'env' | 'windowsVerbatimArguments'
  >,
): { request: ContainerRequest; warnings: string[] } {
  const quoted = [payload.executable, ...payload.args];
  const verbatimTail = payload.windowsVerbatimArguments && quoted.length > 1;
  const last = quoted.pop() ?? '';
  const commandLine = [
    ...quoted.map(quoteWindowsArg),
    verbatimTail ? last : quoteWindowsArg(last),
  ].join(' ');
  // The sandboxed file worker is started with this process's own Node binary,
  // which lives outside the installation (for example the desktop runtime's
  // node/ folder). Grant read access to that folder so the interpreter can load
  // its own files; nothing else from it is writable.
  const interpreterDir =
    payload.executable.toLowerCase() === process.execPath.toLowerCase()
      ? [path.dirname(process.execPath)]
      : [];
  const filesystem =
    policy.filesystem === 'workspace-write'
      ? {
          readwritePaths: [policy.workspace],
          readonlyPaths: [policy.installation, ...interpreterDir],
        }
      : {
          readonlyPaths: [
            policy.workspace,
            policy.installation,
            ...interpreterDir,
          ],
        };
  const warnings =
    policy.maskedPaths && policy.maskedPaths.length > 0
      ? [
          `MXC on Windows cannot enforce masked paths; they remain accessible: ${policy.maskedPaths.join(', ')}`,
        ]
      : [];
  return {
    request: {
      command: commandLine,
      containment: { type: 'processcontainer' },
      filesystem,
      network: {
        egress: { default: policy.network === 'open' ? 'allow' : 'deny' },
      },
      // `ui.disable: true` turns off Win32k for the process, and node.exe (so
      // the file worker and every npm or node command) then fails to start
      // with STATUS_DLL_INIT_FAILED. Keep Win32k but deny the clipboard and
      // input injection; desktop switching and shutdown stay blocked by MXC's
      // defaults.
      ui: { disable: false, clipboard: 'none', allowInputInjection: false },
      workingDirectory: payload.cwd,
      environment: payload.env,
      inheritDefaultEnvironment: false,
    },
    warnings,
  };
}

export async function executeMxc(
  policy: ExecutionSandboxPolicy,
  payload: ProcessLaunch,
  onOutput: (event: ShellOutputEvent) => void,
  signal: AbortSignal,
  usePty = false,
  config: ShellExecutionConfig = {},
  options: ShellExecuteOptions = {},
): Promise<SandboxExecutionHandle> {
  if (usePty) throw new Error('PTY is not supported by the mxc backend yet.');
  if (payload.inheritStdin)
    throw new Error('Inherited stdin is not supported by the mxc backend yet.');
  if (
    !['read-only', 'workspace-write'].includes(policy.filesystem) ||
    !['open', 'closed'].includes(policy.network)
  ) {
    throw new Error('Unsupported sandbox policy.');
  }
  if (!path.isAbsolute(payload.executable) || !path.isAbsolute(payload.cwd))
    throw new Error('Payload paths must be absolute.');
  const cwd = realpathSync(payload.cwd);
  if (!isSubpath(policy.workspace, cwd))
    throw new Error('Payload cwd must be inside the workspace.');
  const env = Object.fromEntries(
    Object.entries(payload.env).filter(([key]) => !isInternalSecretEnvVar(key)),
  );
  const { request, warnings } = toMxcRequest(policy, {
    ...payload,
    cwd,
    env,
  });
  for (const warning of warnings) debugLogger.warn(warning);

  if (signal.aborted) {
    const interrupted: SandboxStatus = { state: 'interrupted' };
    return {
      pid: undefined,
      result: Promise.resolve({
        rawOutput: Buffer.alloc(0),
        output: '',
        exitCode: null,
        signal: null,
        error: sandboxStatusError(interrupted) ?? null,
        aborted: true,
        pid: undefined,
        executionMethod: 'none',
        sandboxStatus: interrupted,
      }),
      settled: Promise.resolve(interrupted),
    };
  }

  const sdk = await import('@microsoft/mxc-sdk/v1');
  const processHandle: MxcProcess = await sdk.spawn(request);
  const pid = processHandle.id > 0 ? processHandle.id : undefined;

  const maxBytes =
    config.maxBufferedOutputBytes ?? DEFAULT_MAX_BUFFERED_OUTPUT_BYTES;
  const rawChunks: Buffer[] = [];
  let bufferedBytes = 0;
  let output = '';
  const collect = (stream: 'stdout' | 'stderr') => {
    const decoder = new StringDecoder('utf8');
    return (chunk: Buffer | string) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      if (bufferedBytes < maxBytes) {
        const kept = buffer.subarray(0, maxBytes - bufferedBytes);
        rawChunks.push(kept);
        bufferedBytes += kept.length;
      }
      if (options.streamRawOutput) {
        onOutput({ type: 'raw_data', chunk: buffer, stream });
      }
      const text = decoder.write(buffer);
      if (text === '') return;
      output += text;
      if (!options.streamRawOutput) {
        onOutput({ type: 'data', chunk: text, stream });
      }
    };
  };
  processHandle.standardOutput?.on('data', collect('stdout'));
  processHandle.standardError?.on('data', collect('stderr'));
  const input = processHandle.standardInput;
  input?.end(payload.stdin);

  const onAbort = () => {
    try {
      processHandle.kill();
    } catch (error) {
      debugLogger.warn('MXC process kill failed', error);
    }
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });

  const result = (async (): Promise<SandboxExecutionResult> => {
    try {
      const exit = await processHandle.wait();
      const aborted = signal.aborted;
      const sandboxStatus: SandboxStatus = aborted
        ? { state: 'interrupted' }
        : { state: 'confirmed', exitCode: exit.exitCode };
      return {
        rawOutput: Buffer.concat(rawChunks),
        output,
        exitCode: aborted ? null : exit.exitCode,
        signal: null,
        error: sandboxStatusError(sandboxStatus) ?? null,
        aborted,
        pid,
        executionMethod: 'child_process',
        sandboxStatus,
      };
    } finally {
      signal.removeEventListener('abort', onAbort);
      try {
        processHandle.dispose();
      } catch (error) {
        debugLogger.warn('MXC process disposal failed', error);
      }
    }
  })();

  return {
    pid,
    result,
    settled: result.then(
      (value) => value.sandboxStatus,
      (): SandboxStatus => ({ state: 'unconfirmed' }),
    ),
  };
}
