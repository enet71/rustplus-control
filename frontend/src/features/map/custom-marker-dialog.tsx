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
import { Textarea } from '@/components/ui/textarea';

type CustomMarkerDialogProps = {
  title: string;
  initialName?: string;
  initialDescription?: string;
  pending?: boolean;
  onSave: (name: string, description: string) => Promise<void>;
  close: () => void;
};

export function CustomMarkerDialog({
  title,
  initialName = '',
  initialDescription = '',
  pending = false,
  onSave,
  close,
}: CustomMarkerDialogProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    try {
      await onSave(name.trim(), description.trim());
    } catch {
      // The mutation reports the failure; the dialog stays open for another attempt.
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-1.5">
            <Label htmlFor="marker-name">Name</Label>
            <Input
              id="marker-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={80}
              autoFocus
              disabled={pending}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="marker-description">Description</Label>
            <Textarea
              id="marker-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
              disabled={pending}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={pending} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
