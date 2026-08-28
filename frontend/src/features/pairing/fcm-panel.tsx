import { Button } from '@/components/ui/button';
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
    <div className="grid gap-2 border-t border-border pt-4">
      <h2 className="text-sm font-semibold">Rust+ pairing</h2>
      <p className="text-sm text-muted-foreground">{status.message}</p>
      <Button
        type="button"
        variant="secondary"
        disabled={status.registered || registering}
        onClick={onRegister}
      >
        Register Rust+
      </Button>
      <Button type="button" variant="destructive" disabled={resetting} onClick={onReset}>
        Reset Rust+ pairing
      </Button>
    </div>
  );
}
