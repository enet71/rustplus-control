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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DeviceType, PendingPairing } from '../../shared/api-types';

type PairingDialogProps = {
  pairing: PendingPairing;
  accept: (name: string, type: DeviceType) => Promise<void>;
  reject: () => Promise<void>;
  submitting: boolean;
};

export function PairingDialog({ pairing, accept, reject, submitting }: PairingDialogProps) {
  const [name, setName] = useState(pairing.name);
  const [type, setType] = useState<DeviceType>(pairing.type);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void accept(name.trim(), type);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && void reject()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Rust+ device</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Entity ID: {pairing.entityId}</p>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-1.5">
            <Label htmlFor="pairing-name">Name</Label>
            <Input
              id="pairing-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={80}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pairing-type">Type</Label>
            <Select value={type} onValueChange={(value) => setType(value as DeviceType)}>
              <SelectTrigger id="pairing-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="switch">Smart Switch</SelectItem>
                <SelectItem value="alarm">Smart Alarm</SelectItem>
                <SelectItem value="storage">Storage Monitor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={submitting}
              onClick={() => void reject()}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              Add device
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
