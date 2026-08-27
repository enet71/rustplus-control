import { useState, type FormEvent } from 'react';
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
    <dialog open>
      <form className="stacked-form" onSubmit={submit}>
        <h2>New Rust+ device</h2>
        <p className="hint">Entity ID: {pairing.entityId}</p>
        <label>
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={80}
          />
        </label>
        <label>
          Type
          <select value={type} onChange={(event) => setType(event.target.value as DeviceType)}>
            <option value="switch">Smart Switch</option>
            <option value="alarm">Smart Alarm</option>
            <option value="storage">Storage Monitor</option>
          </select>
        </label>
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary"
            disabled={submitting}
            onClick={() => void reject()}
          >
            Cancel
          </button>
          <button type="submit" disabled={submitting}>
            Add device
          </button>
        </div>
      </form>
    </dialog>
  );
}
