import { useState, type FormEvent } from 'react';
import { useSaveDiscordWebhook } from './use-discord-webhook';

type DiscordDialogProps = {
  close: () => void;
  report: (message: string) => void;
};

export function DiscordDialog({ close, report }: DiscordDialogProps) {
  const [url, setUrl] = useState('');
  const saveWebhook = useSaveDiscordWebhook(report);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    try {
      await saveWebhook.mutateAsync(url);
      close();
    } catch {
      // The mutation reports the failure; the dialog stays open for another attempt.
    }
  };

  return (
    <dialog open>
      <form className="stacked-form" onSubmit={submit}>
        <h2>Discord alarms</h2>
        <label>
          Webhook URL
          <input
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://discord.com/api/webhooks/..."
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <p className="hint">Leave empty to disable Discord alarm notifications.</p>
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary"
            disabled={saveWebhook.isPending}
            onClick={close}
          >
            Cancel
          </button>
          <button type="submit" disabled={saveWebhook.isPending}>
            Save
          </button>
        </div>
      </form>
    </dialog>
  );
}
