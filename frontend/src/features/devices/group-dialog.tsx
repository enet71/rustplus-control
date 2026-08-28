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
import type { Device, DeviceGroup } from '../../shared/api-types';
import type { DeviceMutations } from './use-devices';

type GroupDialogProps = {
  group?: DeviceGroup;
  devices: Device[];
  mutations: DeviceMutations;
  close: () => void;
};

export function GroupDialog({ group, devices, mutations, close }: GroupDialogProps) {
  const [name, setName] = useState(group?.name || '');
  const [deviceIds, setDeviceIds] = useState<string[]>(group?.deviceIds || []);
  const { saveGroup } = mutations;

  const toggleMember = (entityId: string, member: boolean): void =>
    setDeviceIds((current) =>
      member ? [...current, entityId] : current.filter((id) => id !== entityId),
    );

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    try {
      await saveGroup.mutateAsync({ id: group?.id, name: name.trim(), deviceIds });
      close();
    } catch {
      // The mutation reports the failure; the dialog stays open for another attempt.
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{group ? 'Edit device group' : 'New device group'}</DialogTitle>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-1.5">
            <Label htmlFor="group-name">Name</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={80}
            />
          </div>
          <fieldset className="grid gap-2 rounded-md border border-input p-3">
            <legend className="px-1 text-sm text-muted-foreground">Devices</legend>
            {devices.map((device) => (
              <Label key={device.entityId} className="font-normal text-foreground">
                <Checkbox
                  checked={deviceIds.includes(device.entityId)}
                  onCheckedChange={(checked) => toggleMember(device.entityId, checked === true)}
                />
                {device.name}
              </Label>
            ))}
          </fieldset>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={saveGroup.isPending}
              onClick={close}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saveGroup.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
