import { useCallback, useEffect, useState } from 'react';
import { RefreshCwIcon, SmartphoneIcon, Trash2Icon } from 'lucide-react';
import { useI18n } from '../../i18n';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Spinner } from '../ui/spinner';
import { Switch } from '../ui/switch';
import {
  LocalControlRequestError,
  listPairedDevices,
  removePairedDevice,
  setRememberDevices,
  type PairedDevicesState,
} from '../local-control-api';

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
}

/**
 * The devices that paired with Local Control, and whether they stay signed
 * in. Each device holds a token of its own, so removing one here cuts off
 * that device only.
 */
export function LocalControlPairedDevices({
  baseUrl,
  token,
}: {
  baseUrl: string;
  token: string | undefined;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<PairedDevicesState>();
  const [unsupported, setUnsupported] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setState(await listPairedDevices(baseUrl, token));
      setError('');
    } catch (failure) {
      // A daemon that predates paired devices has no such route.
      if (failure instanceof LocalControlRequestError && failure.status === 404)
        setUnsupported(true);
      else
        setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [baseUrl, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError('');
    try {
      await action();
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy('');
    }
  };

  if (unsupported) return null;

  const devices = state?.devices ?? [];

  return (
    <div
      className="flex flex-col gap-3 border-t pt-4"
      data-testid="local-control-paired-devices"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <label
            htmlFor="local-control-remember-devices"
            className="text-sm font-medium"
          >
            {t('settings.localControl.remember.title')}
          </label>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {t('settings.localControl.remember.description')}
          </p>
        </div>
        <Switch
          id="local-control-remember-devices"
          checked={state?.rememberDevices ?? false}
          disabled={!state || busy !== ''}
          onCheckedChange={(checked) =>
            void run('remember', () =>
              setRememberDevices(baseUrl, token, checked),
            )
          }
        />
      </div>

      <div className="flex items-center gap-2 text-sm font-medium">
        {t('settings.localControl.devices.title')}
        <Badge variant="secondary">{devices.length}</Badge>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto"
          disabled={busy !== ''}
          aria-label={t('settings.localControl.devices.refresh')}
          title={t('settings.localControl.devices.refresh')}
          onClick={() => void run('refresh', async () => {})}
        >
          {busy === 'refresh' ? (
            <Spinner />
          ) : (
            <RefreshCwIcon aria-hidden="true" />
          )}
        </Button>
      </div>

      {state && devices.length === 0 && (
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t('settings.localControl.devices.empty')}
        </p>
      )}

      {devices.length > 0 && (
        <ul className="divide-y rounded-md border">
          {devices.map((device) => (
            <li
              key={device.id}
              className="flex items-center gap-3 px-3 py-2"
              data-testid="local-control-paired-device"
            >
              <SmartphoneIcon
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {device.label}
                  </span>
                  {device.current && (
                    <Badge variant="secondary">
                      {t('settings.localControl.devices.current')}
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  <span>
                    {t('settings.localControl.devices.token')}{' '}
                    <code className="font-mono">{device.fingerprint}…</code>
                  </span>
                  {device.address && (
                    <span className="font-mono">{device.address}</span>
                  )}
                  <span>
                    {t('settings.localControl.devices.paired')}{' '}
                    {formatWhen(device.createdAt)}
                  </span>
                  <span>
                    {t('settings.localControl.devices.lastSeen')}{' '}
                    {formatWhen(device.lastSeenAt)}
                  </span>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== ''}
                onClick={() =>
                  void run(device.id, () =>
                    removePairedDevice(baseUrl, token, device.id),
                  )
                }
              >
                {busy === device.id ? (
                  <Spinner />
                ) : (
                  <Trash2Icon aria-hidden="true" />
                )}
                {t('settings.localControl.devices.remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
