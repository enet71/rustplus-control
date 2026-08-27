import { useState, type FormEvent } from 'react';
import type { Settings } from '../../shared/api-types';
import { useSaveSettings, useSettings } from './use-settings';

type SettingsDialogProps = {
  close: () => void;
  report: (message: string) => void;
};

const FCM_FIELDS = [
  'androidId',
  'securityToken',
  'token',
  'expoPushToken',
  'rustplusAuthToken',
] as const;

/**
 * Rendered only once the saved settings are available, so the editable draft is
 * initialised straight from props instead of being copied in from an effect.
 */
function SettingsForm({
  settings,
  close,
  report,
}: { settings: Settings } & Omit<SettingsDialogProps, never>) {
  const saveSettings = useSaveSettings(report);
  const [draft, setDraft] = useState(settings);
  const [showSecrets, setShowSecrets] = useState(false);

  const updateServer = (field: keyof Settings['server'], value: string | boolean): void =>
    setDraft((current) => ({ ...current, server: { ...current.server, [field]: value } }));

  const updateFcm = (field: (typeof FCM_FIELDS)[number], value: string): void =>
    setDraft((current) => ({ ...current, fcm: { ...current.fcm, [field]: value } }));

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    try {
      await saveSettings.mutateAsync(draft);
      close();
    } catch {
      // The mutation reports the failure; the dialog stays open for another attempt.
    }
  };

  return (
    <form className="stacked-form settings-form" onSubmit={submit}>
      <h2>Server and FCM settings</h2>
      <fieldset>
        <legend>Rust+ server</legend>
        <label>
          Name
          <input
            value={draft.server.name || ''}
            onChange={(event) => updateServer('name', event.target.value)}
            required
          />
        </label>
        <label>
          Host
          <input
            value={draft.server.host || ''}
            onChange={(event) => updateServer('host', event.target.value)}
            required
          />
        </label>
        <label>
          Port
          <input
            value={draft.server.port || ''}
            onChange={(event) => updateServer('port', event.target.value)}
            required
          />
        </label>
        <label>
          Steam64 ID
          <input
            value={draft.server.playerId || ''}
            onChange={(event) => updateServer('playerId', event.target.value)}
            required
          />
        </label>
        <label>
          Player token
          <input
            type={showSecrets ? 'text' : 'password'}
            value={draft.server.playerToken || ''}
            onChange={(event) => updateServer('playerToken', event.target.value)}
            required
          />
        </label>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={Boolean(draft.server.useProxy)}
            onChange={(event) => updateServer('useProxy', event.target.checked)}
          />
          Use Facepunch proxy
        </label>
      </fieldset>
      <fieldset>
        <legend>FCM</legend>
        {FCM_FIELDS.map((field) => (
          <label key={field}>
            {field}
            <input
              type={showSecrets ? 'text' : 'password'}
              value={draft.fcm[field] || ''}
              onChange={(event) => updateFcm(field, event.target.value)}
              required
            />
          </label>
        ))}
      </fieldset>
      <label className="inline-check">
        <input
          type="checkbox"
          checked={showSecrets}
          onChange={(event) => setShowSecrets(event.target.checked)}
        />
        Show secrets
      </label>
      <div className="dialog-actions">
        <button
          type="button"
          className="secondary"
          disabled={saveSettings.isPending}
          onClick={close}
        >
          Cancel
        </button>
        <button type="submit" disabled={saveSettings.isPending}>
          Save
        </button>
      </div>
    </form>
  );
}

export function SettingsDialog({ close, report }: SettingsDialogProps) {
  const { data, error } = useSettings();

  if (error)
    return (
      <dialog open className="settings-dialog">
        <p className="hint" role="alert">
          Settings could not be loaded.
        </p>
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={close}>
            Close
          </button>
        </div>
      </dialog>
    );

  return (
    <dialog open className="settings-dialog">
      {data ? (
        <SettingsForm settings={data} close={close} report={report} />
      ) : (
        <p className="hint">Loading settings...</p>
      )}
    </dialog>
  );
}
