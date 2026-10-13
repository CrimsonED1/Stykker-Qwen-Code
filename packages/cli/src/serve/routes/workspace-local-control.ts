/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Application, Request, Response, RequestHandler } from 'express';
import {
  AmbiguousLanInterfaceError,
  listLanCandidates,
  NoLanInterfaceError,
  UnknownLanInterfaceError,
} from '../local-control/lan-interfaces.js';
import { listenerIdentityOf } from '../local-control/listener-identity.js';
import { isLoopbackBind } from '../loopback-binds.js';
import {
  InvalidLocalControlTargetError,
  type LocalControlService,
  type LocalControlStatus,
} from '../local-control/service.js';
import type { PersistedLocalControlState } from '../local-control/persisted-state.js';
import type { CredentialStore } from '../local-control/credentials.js';
import {
  deviceIdOf,
  type PairedDeviceRegistry,
} from '../local-control/paired-devices.js';
import { requestHasOperatorAuthority } from '../auth.js';
import {
  writeStderrLine,
  writeStdoutLineSafe,
} from '../../utils/stdioHelpers.js';

/**
 * What these routes need from the service. `pairingCredential` is optional so
 * a service double — or an embedder that never persists state — stays valid;
 * the real service always provides it.
 */
type LocalControlRouteService = Pick<
  LocalControlService,
  'enable' | 'disable' | 'status'
> & {
  pairingCredential?(): { id: string; secret: string } | undefined;
};

export interface RegisterWorkspaceLocalControlRoutesDeps {
  service: LocalControlRouteService;
  mutate: (opts?: { strict?: boolean }) => RequestHandler;
  safeBody: (req: Request) => Record<string, unknown>;
  isDaemonDraining?: () => boolean;
  webShellAvailable?: boolean;
  /** The daemon's primary bind hostname (runtime enable precondition). */
  primaryBindHostname?: string;
  /** Whether tokenless primary-listener requests have operator authority. */
  trustedLoopbackMode?: boolean;
  /**
   * Records the operator's on/off choice, the chosen address, and — so the
   * desktop app can reproduce the same link on its next launch — the pinned
   * port and pairing credential. Only the desktop app installs it; daemon
   * shutdown does not call it.
   */
  persistState?: (state: PersistedLocalControlState) => Promise<void>;
  /** Paired-device registry; absent leaves the device routes unregistered. */
  devices?: PairedDeviceRegistry;
  /** Resolves which pairing credential a verified request presented. */
  credentials?: Pick<CredentialStore, 'pairingIdOf'>;
}

function persist(
  deps: RegisterWorkspaceLocalControlRoutesDeps,
  state: PersistedLocalControlState,
): void {
  void deps.persistState?.(state).catch((error: unknown) => {
    writeStderrLine(
      `qwen serve: could not save the Local Control state: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
}

async function withUiData(status: LocalControlStatus) {
  let qrText: string | undefined;
  if (status.url) {
    // QR rendering is best-effort and must never fail the request. The pairing
    // URL is caller-influenced (`target` deep-links), so an over-capacity URL
    // can exceed the QR encoder's limit; if that threw, enable/status would 500
    // while the LAN listener is already live and stays live — a wedged card
    // with no way to disable. The Web Shell still shows the raw URL text, so
    // pairing remains possible without the QR block.
    try {
      const { default: qrcode } = (await import('qrcode-terminal')) as {
        default: typeof import('qrcode-terminal');
      };
      qrcode.setErrorLevel('Q');
      qrcode.generate(status.url, { small: true }, (code) => {
        qrText = code.trimEnd();
      });
    } catch {
      qrText = undefined;
    }
  }
  return { ...status, qrText, interfaces: listLanCandidates() };
}

/**
 * `url` carries the pairing token in its fragment and `qrText` encodes it.
 * Return that material only to a request with operator authority: either a
 * listener credential was verified or the request arrived on the trusted
 * primary loopback listener. Everyone else gets a redacted status.
 */
function presentStatus(
  req: Request,
  ui: Awaited<ReturnType<typeof withUiData>>,
  trustedLoopbackMode: boolean,
) {
  if (requestHasOperatorAuthority(req, trustedLoopbackMode)) return ui;
  const { url: _url, qrText: _qrText, ...rest } = ui;
  return { ...rest, urlRedacted: ui.url !== undefined };
}

/**
 * Enabling is restricted to the primary (loopback) listener.
 *
 * The asymmetry is the point. A page already reached over the LAN must not be
 * able to widen LAN access — otherwise a paired phone, or anything that got
 * hold of the pairing token, could re-enable Local Control after the operator
 * turned it off, or move it onto a different interface. Only someone at the
 * machine can grant.
 *
 * Disabling stays open to every caller admitted by its listener policy,
 * including the trusted primary listener and a paired phone. Revoking your own
 * access is always safe, and a user who realizes they are on an untrusted
 * network needs to cut the connection from the device in their hand, not from
 * the laptop they walked away from.
 */
function requirePrimaryListener(req: Request, res: Response): boolean {
  if (listenerIdentityOf(req).kind === 'primary') return true;
  res.status(403).json({
    error:
      'Local Control can only be enabled from the machine running the daemon.',
    code: 'local_control_remote_enable_denied',
  });
  return false;
}

export function registerWorkspaceLocalControlRoutes(
  app: Application,
  deps: RegisterWorkspaceLocalControlRoutesDeps,
): void {
  const trustedLoopbackMode = deps.trustedLoopbackMode === true;
  if (deps.devices) {
    registerPairedDeviceRoutes(app, deps, deps.devices, trustedLoopbackMode);
  }
  app.get('/workspace/local-control', async (req, res) => {
    res
      .status(200)
      .json(
        presentStatus(
          req,
          await withUiData(deps.service.status()),
          trustedLoopbackMode,
        ),
      );
  });

  app.post(
    '/workspace/local-control/enable',
    deps.mutate(),
    async (req, res) => {
      if (!requirePrimaryListener(req, res)) return;
      if (deps.webShellAvailable === false) {
        res.status(409).json({
          error: 'Local Control requires the Web Shell.',
          code: 'local_control_web_shell_unavailable',
        });
        return;
      }
      // Same precondition the `--local-control` CLI flag enforces: the LAN
      // listener binds the primary listener's port on the selected LAN
      // address, which a wildcard or LAN primary bind already owns —
      // enabling there would fail with EADDRINUSE and no remediation.
      if (
        deps.primaryBindHostname !== undefined &&
        !isLoopbackBind(deps.primaryBindHostname)
      ) {
        res.status(409).json({
          error:
            'Local Control requires the daemon to be bound to loopback; ' +
            'restart it with --hostname 127.0.0.1.',
          code: 'local_control_non_loopback_bind',
        });
        return;
      }
      if (deps.isDaemonDraining?.()) {
        res.status(503).json({
          error: 'Daemon is shutting down.',
          code: 'daemon_draining',
        });
        return;
      }
      const body = (deps.safeBody(req) ?? {}) as {
        address?: unknown;
        target?: unknown;
      };
      try {
        const ui = await withUiData(
          await deps.service.enable({
            address:
              typeof body.address === 'string' ? body.address : undefined,
            target: typeof body.target === 'string' ? body.target : undefined,
          }),
        );
        // Pin what a restart has to reproduce — the address, the port and the
        // pairing credential — so the desktop app's next launch brings back
        // the same link instead of minting a fresh credential on the daemon's
        // ephemeral port. Only the desktop app installs `persistState`.
        const pairingToken = deps.service.pairingCredential?.();
        persist(deps, {
          enabled: true,
          ...(ui.address ? { address: ui.address } : {}),
          ...(typeof ui.port === 'number' ? { port: ui.port } : {}),
          ...(pairingToken
            ? { pairingId: pairingToken.id, pairingSecret: pairingToken.secret }
            : {}),
        });
        if (!requestHasOperatorAuthority(req, trustedLoopbackMode) && ui.url) {
          // The response below has the secret removed; the operator still
          // needs it to pair. The daemon's own terminal is the one channel a
          // local attacker process cannot read over HTTP, so surface the URL
          // there (#9106).
          writeStdoutLineSafe(
            `qwen serve: Local Control pairing URL: ${ui.url}`,
          );
        }
        res.status(200).json(presentStatus(req, ui, trustedLoopbackMode));
      } catch (error) {
        sendEnableError(res, error);
      }
    },
  );

  app.post(
    '/workspace/local-control/disable',
    deps.mutate(),
    async (req, res) => {
      persist(deps, { enabled: false });
      if (listenerIdentityOf(req).kind === 'local-control') {
        queueMicrotask(() => {
          void deps.service.disable().catch((error) => {
            writeStderrLine(
              `qwen serve: Local Control disable failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        });
        res.status(200).json({ active: false });
        return;
      }
      res
        .status(200)
        .json(
          presentStatus(
            req,
            await withUiData(await deps.service.disable()),
            trustedLoopbackMode,
          ),
        );
    },
  );
}

/** The bearer credential a request presented, already verified upstream. */
function presentedBearer(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const separator = header.indexOf(' ');
  if (separator <= 0) return undefined;
  if (header.slice(0, separator).toLowerCase() !== 'bearer') return undefined;
  return header.slice(separator + 1).trim() || undefined;
}

function remoteAddressOf(req: Request): string | undefined {
  return req.socket.remoteAddress?.replace(/^::ffff:/, '') || undefined;
}

/**
 * Paired-device routes.
 *
 * The QR code carries one shared pairing secret. A device that scanned it
 * trades that secret for a token of its own (`POST …/devices`), which is what
 * lets the operator list devices and revoke one without cutting off the rest.
 */
function registerPairedDeviceRoutes(
  app: Application,
  deps: RegisterWorkspaceLocalControlRoutesDeps,
  devices: PairedDeviceRegistry,
  trustedLoopbackMode: boolean,
): void {
  const callerDeviceId = (req: Request): string | undefined => {
    if (listenerIdentityOf(req).kind !== 'local-control') return undefined;
    const presented = presentedBearer(req);
    return presented
      ? deviceIdOf(deps.credentials?.pairingIdOf(presented))
      : undefined;
  };

  app.get('/workspace/local-control/devices', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!requestHasOperatorAuthority(req, trustedLoopbackMode)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const current = callerDeviceId(req);
    res.status(200).json({
      rememberDevices: devices.rememberDevices,
      devices: devices
        .list()
        .map((device) => ({ ...device, current: device.id === current })),
    });
  });

  app.post(
    '/workspace/local-control/devices',
    deps.mutate(),
    async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      // Only a request that arrived over the LAN listener holds a pairing
      // credential to trade; the operator's own window uses the runtime token.
      const presented = presentedBearer(req);
      if (listenerIdentityOf(req).kind !== 'local-control' || !presented) {
        res.status(409).json({
          error: 'Devices pair over the Local Control listener.',
          code: 'local_control_enroll_not_lan',
        });
        return;
      }
      const existing = callerDeviceId(req);
      if (existing) {
        res.status(200).json({
          id: existing,
          rememberDevices: devices.rememberDevices,
        });
        return;
      }
      // A device that re-scans the QR code while it still holds a valid
      // token keeps that token instead of becoming a second list entry.
      const body = (deps.safeBody(req) ?? {}) as { previousToken?: unknown };
      const previous =
        typeof body.previousToken === 'string'
          ? deviceIdOf(deps.credentials?.pairingIdOf(body.previousToken))
          : undefined;
      if (previous) {
        devices.touch(previous);
        res.status(200).json({
          id: previous,
          reused: true,
          rememberDevices: devices.rememberDevices,
        });
        return;
      }
      const added = await devices.add({
        userAgent: req.headers['user-agent'],
        address: remoteAddressOf(req),
      });
      if (!added) {
        res.status(409).json({
          error:
            'Paired device limit reached. Remove a device in the Local ' +
            'Control settings first.',
          code: 'local_control_device_limit',
        });
        return;
      }
      res.status(200).json({
        id: added.device.id,
        token: added.token,
        rememberDevices: devices.rememberDevices,
      });
    },
  );

  app.delete(
    '/workspace/local-control/devices/:id',
    deps.mutate(),
    async (req, res) => {
      const id = req.params['id'] ?? '';
      // The operator may remove any device; a device may remove only itself.
      if (
        listenerIdentityOf(req).kind !== 'primary' &&
        callerDeviceId(req) !== id
      ) {
        res.status(403).json({
          error:
            'Paired devices can only be removed from the machine running ' +
            'the daemon.',
          code: 'local_control_remote_device_removal_denied',
        });
        return;
      }
      if (!(await devices.remove(id))) {
        res.status(404).json({
          error: 'Unknown paired device.',
          code: 'local_control_device_not_found',
        });
        return;
      }
      res.status(200).json({ removed: true });
    },
  );

  app.post(
    '/workspace/local-control/settings',
    deps.mutate(),
    async (req, res) => {
      if (!requirePrimaryListener(req, res)) return;
      const body = (deps.safeBody(req) ?? {}) as { rememberDevices?: unknown };
      if (typeof body.rememberDevices !== 'boolean') {
        res.status(400).json({
          error: 'rememberDevices must be a boolean.',
          code: 'invalid_local_control_settings',
        });
        return;
      }
      await devices.setRememberDevices(body.rememberDevices);
      res.status(200).json({ rememberDevices: devices.rememberDevices });
    },
  );
}

function sendEnableError(res: Response, error: unknown): void {
  // 409 rather than 400: the request was well-formed and the operator did
  // nothing wrong — the host simply has more than one answer. The candidate
  // list comes back with it so the client can ask and retry with `address`
  // instead of round-tripping through GET.
  if (error instanceof AmbiguousLanInterfaceError) {
    res.status(409).json({
      error: error.message,
      code: error.code,
      interfaces: error.candidates,
    });
    return;
  }
  if (error instanceof NoLanInterfaceError) {
    res.status(409).json({ error: error.message, code: error.code });
    return;
  }
  if (error instanceof UnknownLanInterfaceError) {
    res.status(409).json({
      error: error.message,
      code: error.code,
      interfaces: listLanCandidates(),
    });
    return;
  }
  if (error instanceof InvalidLocalControlTargetError) {
    res.status(400).json({ error: error.message, code: error.code });
    return;
  }
  res.status(500).json({
    error: error instanceof Error ? error.message : String(error),
    code: 'local_control_enable_failed',
  });
}
