import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discord alarms</DialogTitle>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-1.5">
            <Label htmlFor="discord-webhook">Webhook URL</Label>
            <Input
              id="discord-webhook"
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="https://discord.com/api/webhooks/..."
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Leave empty to disable Discord alarm notifications.
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={saveWebhook.isPending}
              onClick={close}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saveWebhook.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
