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
import type { Device } from '../../shared/api-types';
import type { DeviceMutations } from './use-devices';

type DeviceDialogProps = {
  device: Device;
  mutations: DeviceMutations;
  close: () => void;
};

export function DeviceDialog({ device, mutations, close }: DeviceDialogProps) {
  const [name, setName] = useState(device.name);
  const { renameDevice } = mutations;

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    try {
      await renameDevice.mutateAsync({ entityId: device.entityId, name: name.trim() });
      close();
    } catch {
      // The mutation reports the failure; the dialog stays open for another attempt.
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename device</DialogTitle>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-1.5">
            <Label htmlFor="device-name">Name</Label>
            <Input
              id="device-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={80}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={renameDevice.isPending}
              onClick={close}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={renameDevice.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
