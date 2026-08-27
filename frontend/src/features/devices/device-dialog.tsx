import { useState, type FormEvent } from 'react';
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
    <dialog open>
      <form className="stacked-form" onSubmit={submit}>
        <h2>Rename device</h2>
        <label>
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={80}
          />
        </label>
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary"
            disabled={renameDevice.isPending}
            onClick={close}
          >
            Cancel
          </button>
          <button type="submit" disabled={renameDevice.isPending}>
            Save
          </button>
        </div>
      </form>
    </dialog>
  );
}
