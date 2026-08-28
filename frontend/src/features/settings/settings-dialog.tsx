import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
    <form className="grid gap-4" onSubmit={submit}>
      <fieldset className="grid gap-3 rounded-md border border-input p-3">
        <legend className="px-1 text-sm text-muted-foreground">Rust+ server</legend>
        <div className="grid gap-1.5">
          <Label htmlFor="settings-name">Name</Label>
          <Input
            id="settings-name"
            value={draft.server.name || ''}
            onChange={(event) => updateServer('name', event.target.value)}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="settings-host">Host</Label>
          <Input
            id="settings-host"
            value={draft.server.host || ''}
            onChange={(event) => updateServer('host', event.target.value)}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="settings-port">Port</Label>
          <Input
            id="settings-port"
            value={draft.server.port || ''}
            onChange={(event) => updateServer('port', event.target.value)}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="settings-player-id">Steam64 ID</Label>
          <Input
            id="settings-player-id"
            value={draft.server.playerId || ''}
            onChange={(event) => updateServer('playerId', event.target.value)}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="settings-player-token">Player token</Label>
          <Input
            id="settings-player-token"
            type={showSecrets ? 'text' : 'password'}
            value={draft.server.playerToken || ''}
            onChange={(event) => updateServer('playerToken', event.target.value)}
            required
          />
        </div>
        <Label className="font-normal text-foreground">
          <Checkbox
            checked={Boolean(draft.server.useProxy)}
            onCheckedChange={(checked) => updateServer('useProxy', checked === true)}
          />
          Use Facepunch proxy
        </Label>
      </fieldset>
      <fieldset className="grid gap-3 rounded-md border border-input p-3">
        <legend className="px-1 text-sm text-muted-foreground">FCM</legend>
        {FCM_FIELDS.map((field) => (
          <div key={field} className="grid gap-1.5">
            <Label htmlFor={`settings-fcm-${field}`}>{field}</Label>
            <Input
              id={`settings-fcm-${field}`}
              type={showSecrets ? 'text' : 'password'}
              value={draft.fcm[field] || ''}
              onChange={(event) => updateFcm(field, event.target.value)}
              required
            />
          </div>
        ))}
      </fieldset>
      <Label className="font-normal text-foreground">
        <Checkbox
          checked={showSecrets}
          onCheckedChange={(checked) => setShowSecrets(checked === true)}
        />
        Show secrets
      </Label>
      <DialogFooter>
        <Button type="button" variant="secondary" disabled={saveSettings.isPending} onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={saveSettings.isPending}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

export function SettingsDialog({ close, report }: SettingsDialogProps) {
  const { data, error } = useSettings();

  if (error)
    return (
      <Dialog open onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Server and FCM settings</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-destructive" role="alert">
            Settings could not be loaded.
          </p>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={close}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Server and FCM settings</DialogTitle>
        </DialogHeader>
        {data ? (
          <SettingsForm settings={data} close={close} report={report} />
        ) : (
          <p className="text-sm text-muted-foreground">Loading settings...</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
