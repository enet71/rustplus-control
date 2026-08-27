import { useState, type FormEvent } from 'react';
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
    <dialog open>
      <form className="stacked-form" onSubmit={submit}>
        <h2>{group ? 'Edit device group' : 'New device group'}</h2>
        <label>
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={80}
          />
        </label>
        <fieldset className="group-members">
          <legend>Devices</legend>
          {devices.map((device) => (
            <label key={device.entityId}>
              <input
                type="checkbox"
                checked={deviceIds.includes(device.entityId)}
                onChange={(event) => toggleMember(device.entityId, event.target.checked)}
              />
              {device.name}
            </label>
          ))}
        </fieldset>
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary"
            disabled={saveGroup.isPending}
            onClick={close}
          >
            Cancel
          </button>
          <button type="submit" disabled={saveGroup.isPending}>
            Save
          </button>
        </div>
      </form>
    </dialog>
  );
}
