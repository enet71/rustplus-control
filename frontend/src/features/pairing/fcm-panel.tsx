import type { FcmStatus } from '../../shared/api-types';

type FcmPanelProps = {
  status: FcmStatus;
  onRegister: () => void;
  onReset: () => void;
  registering: boolean;
  resetting: boolean;
};

export function FcmPanel({ status, onRegister, onReset, registering, resetting }: FcmPanelProps) {
  return (
    <section className="pairing">
      <div className="row-title">
        <h2>Rust+ pairing</h2>
        <span className="hint">{status.message}</span>
      </div>
      <div className="pairing-actions">
        <button
          type="button"
          className="secondary"
          disabled={status.registered || registering}
          onClick={onRegister}
        >
          Register Rust+
        </button>
        <button type="button" className="secondary danger" disabled={resetting} onClick={onReset}>
          Reset Rust+ pairing
        </button>
      </div>
    </section>
  );
}
